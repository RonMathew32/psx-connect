import net from 'net';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag, DEFAULT_CONNECTION } from './constants';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';
import { SequenceManager } from './sequence-manager';
import {
  createHeartbeatMessage,
  getMessageTypeName
} from './message-helpers';

/** 
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions) {
  const emitter = new EventEmitter();
  let socket: net.Socket | null = null;
  let connected = false;
  let loggedIn = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastActivityTime = 0;
  let testRequestCount = 0;
  let logonTimer: NodeJS.Timeout | null = null;

  const sequenceManager = new SequenceManager();

  let requestedEquitySecurities = false;

  const securityCache = {
    EQUITY: [] as SecurityInfo[],
    INDEX: [] as SecurityInfo[]
  };

  const forceResetSequenceNumber = (newSeq: number = 2): void => {
    sequenceManager.forceReset(newSeq);
  };

  const start = (): void => {
    connect();
  };

  const stop = (): void => {
    sendLogout();
    disconnect();
  };

  const connect = async (): Promise<void> => {
    if (socket && connected) {
      logger.warn('Already connected');
      return;
    }

    try {
      socket = new Socket();
      socket.setKeepAlive(true);
      socket.setNoDelay(true);

      socket.setTimeout(options.connectTimeoutMs || 30000);

      socket.on('timeout', () => {
        logger.error('Connection timed out');
        socket?.destroy();
        connected = false;
        emitter.emit('error', new Error('Connection timed out'));
      });

      socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        emitter.emit('error', error);
      });

      socket.on('close', () => {
        logger.info('Socket disconnected');
        connected = false;
        emitter.emit('disconnected');
        scheduleReconnect();
      });

      socket.on('connect', () => {
        logger.info(`Connected to ${options.host}:${options.port}`);
        connected = true;
        if (logonTimer) {
          clearTimeout(logonTimer);
        }
        logonTimer = setTimeout(() => {
          try {
            logger.info('Sending logon message...');
            sendLogon();

          } catch (error) {
            logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
            disconnect();
          }
        }, 500);
        emitter.emit('connected');
      });

      // Handle received data
      socket.on('data', (data) => {
        logger.info("--------------------------------");
        // Extract message types from data for better identification
        try {
          const dataStr = data.toString();
          const messageTypes = [];
          const symbolsFound = [];

          // Quick scan for message types in the data
          const msgTypeMatches = dataStr.match(/35=([A-Za-z0-9])/g) || [];
          for (const match of msgTypeMatches) {
            const msgType = match.substring(3);
            messageTypes.push(msgType);
          }

          // Quick scan for symbols in the data
          const symbolMatches = dataStr.match(/55=([^\x01]+)/g) || [];
          for (const match of symbolMatches) {
            const symbol = match.substring(3);
            if (symbol) symbolsFound.push(symbol);
          }

          // Identify message categories
          const categorizedMessages = messageTypes.map(type => {
            let category = 'UNKNOWN';
            if (type === MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
              type === MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
              type === 'Y') {
              category = 'MARKET_DATA';
            } else if (type === MessageType.SECURITY_LIST || type === MessageType.SECURITY_LIST_REQUEST) {
              logger.info(`[SECURITY_LIST] Received security list message`);
              category = 'SECURITY_LIST';
            } else if (type === MessageType.TRADING_SESSION_STATUS || type === 'f') {
              category = 'TRADING_STATUS';
            } else if (type === MessageType.LOGON || type === MessageType.LOGOUT) {
              category = 'SESSION';
            } else if (type === MessageType.HEARTBEAT || type === MessageType.TEST_REQUEST) {
              category = 'HEARTBEAT';
            } else if (type === MessageType.REJECT) {
              category = 'REJECT';
            }
            return `${category}:${type}`;
          });

          // Log the data summary before detailed processing
          if (messageTypes.length > 0) {
            logger.info(`[DATA:RECEIVED] Message types: ${categorizedMessages.join(', ')}${symbolsFound.length > 0 ? ' | Symbols: ' + symbolsFound.join(', ') : ''}`);
          } else {
            logger.warn(`[DATA:RECEIVED] No recognizable message types found in data`);
          }

        } catch (err) {
          logger.error(`Error pre-parsing data: ${err}`);
        }

        logger.info(data);

        // Ensure data is processed properly
        logger.info(`[DATA:PROCESSING] Starting message processing...`);
        let processingResult = false;
        try {
          handleData(data);
          processingResult = true;
        } catch (error: any) {
          logger.error(`[DATA:ERROR] Failed to process data: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            logger.error(error.stack);
          }
          processingResult = false;
        }
        logger.info(`[DATA:COMPLETE] Message processing ${processingResult ? 'succeeded' : 'failed'}`);
      });

      socket.on('securityList', (securities) => {
        logger.info('Received security list:', securities);
      });

      // Connect to the server
      logger.info(`Establishing TCP connection to ${options.host}:${options.port}...`);
      socket.connect(options.port, options.host);
    } catch (error) {
      logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      clearTimers();
      if (connected && loggedIn) {
        sendLogout();
      }

      // Reset all sequence numbers on disconnect
      logger.info('[CONNECTION] Resetting all sequence numbers due to disconnect');
      sequenceManager.resetAll();

      if (socket) {
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;

      // Reset the requestedEquitySecurities flag so we'll request them again on next connect
      requestedEquitySecurities = false;

      resolve();
    });
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    // Reset all sequence numbers when scheduling a reconnect
    logger.info('[CONNECTION] Resetting all sequence numbers before reconnect');
    sequenceManager.resetAll();

    // Log the specific sequence numbers after reset
    const seqNumbers = sequenceManager.getAll();
    logger.info(`[CONNECTION] Sequence numbers after reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);

    // Reset the requestedEquitySecurities flag so we'll request them again
    requestedEquitySecurities = false;

    logger.info('[CONNECTION] Scheduling reconnect in 5 seconds');
    reconnectTimer = setTimeout(() => {
      logger.info('[CONNECTION] Attempting to reconnect');
      connect();
    }, 5000);
  };

  const clearTimers = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const handleData = (data: Buffer): void => {
    try {
      // Remove automatic delayed security list request
      // setTimeout(() => {
      //   logger.info('[SECURITY_LIST] Requesting equity security list');
      //   sendSecurityListRequestForEquity();
      // }, 5000);

      lastActivityTime = Date.now();
      const dataStr = data.toString();

      logger.debug(`[DATA:HANDLING] Received data: ${dataStr.length} bytes`);
      const messages = dataStr.split(SOH);
      let currentMessage = '';
      let messageCount = 0;

      for (const segment of messages) {
        if (segment.startsWith('8=FIX')) {
          // If we have a previous message, process it
          if (currentMessage) {
            try {
              processMessage(currentMessage);
              logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
              messageCount++;
            } catch (err: any) {
              logger.error(`[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          // Start a new message
          currentMessage = segment;
        } else if (currentMessage) {
          // Add to current message
          currentMessage += SOH + segment;
        }
      }
      // Process the last message if exists
      if (currentMessage) {
        try {
          processMessage(currentMessage);
          logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
          messageCount++;
        } catch (err: any) {
          logger.error(`[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      logger.debug(`[DATA:HANDLING] Processed ${messageCount} FIX messages`);
    } catch (error: any) {
      logger.error(`[DATA:ERROR] Error handling data buffer: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.error(error.stack);
      }
      throw error;
    }
  };

  const processMessage = (message: string): void => {
    try {
      const segments = message.split(SOH);

      // FIX message should start with "8=FIX"
      const fixVersion = segments.find(s => s.startsWith('8=FIX'));
      if (!fixVersion) {
        logger.warn('Received non-FIX message');
        return;
      }

      // Get message type for classification before full parsing
      const msgTypeField = segments.find(s => s.startsWith('35='));
      const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
      const msgTypeName = getMessageTypeName(msgType);

      // Get symbol if it exists for better logging
      const symbolField = segments.find(s => s.startsWith('55='));
      const symbol = symbolField ? symbolField.substring(3) : '';

      // Classify message
      let messageCategory = 'UNKNOWN';
      if (msgType === MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
        msgType === MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
        msgType === 'Y') {
        messageCategory = 'MARKET_DATA';
      } else if (msgType === MessageType.SECURITY_LIST) {
        messageCategory = 'SECURITY_LIST';
      } else if (msgType === MessageType.TRADING_SESSION_STATUS || msgType === 'f') {
        messageCategory = 'TRADING_STATUS';
      } else if (msgType === MessageType.LOGON || msgType === MessageType.LOGOUT) {
        messageCategory = 'SESSION';
      } else if (msgType === MessageType.HEARTBEAT || msgType === MessageType.TEST_REQUEST) {
        messageCategory = 'HEARTBEAT';
      } else if (msgType === MessageType.REJECT) {
        messageCategory = 'REJECT';
      }

      // Log with category and type for clear identification
      logger.info(`[${messageCategory}] Received FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
      logger.info(`------------------------------------------------------------------------------------------------------------`);
      logger.info(message);

      // Parse the raw message
      const parsedMessage = parseFixMessage(message);

      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }

      // Track server's sequence number if available
      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        const incomingSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);

        // Special handling for logout and reject messages with sequence errors
        const msgType = parsedMessage[FieldTag.MSG_TYPE];
        const text = parsedMessage[FieldTag.TEXT] || '';

        // Check if this is a sequence error message
        const isSequenceError = Boolean(text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'));

        if ((msgType === MessageType.LOGOUT || msgType === MessageType.REJECT) && isSequenceError) {
          // For sequence errors, don't update our sequence counter
          // This will be handled in the handleLogout or handleReject methods
          logger.warn(`Received ${msgType} with sequence error: ${text}`);
        } else {
          // For normal messages, update sequence numbers using the manager
          sequenceManager.updateServerSequence(incomingSeqNum);
        }
      }

      // Process specific message types
      switch (msgType) {
        case MessageType.LOGON:
          logger.info(`[SESSION:LOGON] Processing logon message from server`);
          handleLogon(parsedMessage, sequenceManager, emitter);
          loggedIn = true;
          logger.info(`[SESSION:LOGON] Processing complete`);
          break;
        case MessageType.LOGOUT:
          logger.info(`[SESSION:LOGOUT] Handling logout message`);
          const logoutResult = handleLogout(parsedMessage, emitter);

          if (logoutResult.isSequenceError) {
            logger.info(`[SESSION:LOGOUT] Detected sequence error, handling...`);
            handleSequenceError(logoutResult.expectedSeqNum);
          } else {
            loggedIn = false;

            // Clear the heartbeat timer as we're logged out
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
              logger.info(`[SESSION:LOGOUT] Cleared heartbeat timer`);
            }
          }
          logger.info(`[SESSION:LOGOUT] Processing complete`);
          break;
        case MessageType.HEARTBEAT:
          logger.debug(`[HEARTBEAT] Received heartbeat`);
          // Just log and reset the test request counter
          testRequestCount = 0;

          // Emit an additional categorized event
          emitter.emit('categorizedData', {
            category: 'HEARTBEAT',
            type: 'HEARTBEAT',
            data: parsedMessage,
            timestamp: new Date().toISOString()
          });
          logger.debug(`[HEARTBEAT] Processing complete`);
          break;
        case MessageType.TEST_REQUEST:
          logger.info(`[HEARTBEAT:TEST_REQUEST] Responding to test request`);
          // Respond with heartbeat
          sendHeartbeat(parsedMessage[FieldTag.TEST_REQ_ID]);

          // Emit an additional categorized event
          emitter.emit('categorizedData', {
            category: 'HEARTBEAT',
            type: 'TEST_REQUEST',
            data: parsedMessage,
            timestamp: new Date().toISOString()
          });
          logger.info(`[HEARTBEAT:TEST_REQUEST] Processing complete`);
          break;
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          logger.info(`[MARKET_DATA:SNAPSHOT] Handling market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          // Update market data sequence number
          if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
            sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10));
          }

          // Use our custom enhanced handler
          handleMarketDataSnapshot(parsedMessage, emitter);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          logger.info(`[MARKET_DATA:INCREMENTAL] Handling market data incremental refresh for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          // Update market data sequence number
          if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
            sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10));
          }

          // Use our custom enhanced handler
          handleMarketDataIncremental(parsedMessage, emitter);
          break;
        case MessageType.SECURITY_LIST:
          logger.info(`[SECURITY_LIST] Handling security list response`);

          // Use our custom enhanced handler
          handleSecurityList(parsedMessage, emitter, securityCache);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          logger.info(`[TRADING_STATUS:SESSION] Handling trading session status update`);

          // Use our custom enhanced handler
          handleTradingSessionStatus(parsedMessage, emitter);
          break;
        case 'f': // Trading Status - specific PSX format
          logger.info(`[TRADING_STATUS:SYMBOL] Handling trading status for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);

          // Use our custom enhanced handler
          handleTradingStatus(parsedMessage, emitter);
          break;
        case MessageType.REJECT:
          logger.error(`[REJECT] Handling reject message`);

          try {
            // Process the reject message
            const importedRejectHandler = require('./message-handlers').handleReject;
            const rejectResult = importedRejectHandler(parsedMessage, emitter);

            // Emit an additional categorized event
            emitter.emit('categorizedData', {
              category: 'REJECT',
              type: 'REJECT',
              refMsgType: parsedMessage['45'] || '', // RefMsgType field
              text: parsedMessage[FieldTag.TEXT] || '',
              data: parsedMessage,
              timestamp: new Date().toISOString()
            });

            logger.error(`[REJECT] Message rejected: ${parsedMessage[FieldTag.TEXT] || 'No reason provided'}`);

            if (rejectResult && rejectResult.isSequenceError) {
              logger.info(`[REJECT] Handling sequence error with expected sequence: ${rejectResult.expectedSeqNum || 'unknown'}`);
              handleSequenceError(rejectResult.expectedSeqNum);
            }

            logger.info('[REJECT] Processing complete');
          } catch (error) {
            logger.error(`[REJECT] Error processing reject message: ${error instanceof Error ? error.message : String(error)}`);
          }
          break;

        case 'Y': // Market Data Request Reject
          logger.error(`[MARKET_DATA:REJECT] Handling market data request reject`);

          try {
            // Process the market data reject message
            const importedMDRejectHandler = require('./message-handlers').handleMarketDataRequestReject;
            importedMDRejectHandler(parsedMessage, emitter);

            // Emit an additional categorized event
            emitter.emit('categorizedData', {
              category: 'MARKET_DATA',
              type: 'REJECT',
              requestID: parsedMessage[FieldTag.MD_REQ_ID] || '',
              text: parsedMessage[FieldTag.TEXT] || '',
              data: parsedMessage,
              timestamp: new Date().toISOString()
            });

            logger.error(`[MARKET_DATA:REJECT] Market data request rejected: ${parsedMessage[FieldTag.TEXT] || 'No reason provided'}`);
            logger.info('[MARKET_DATA:REJECT] Processing complete');
          } catch (error) {
            logger.error(`[MARKET_DATA:REJECT] Error processing market data reject: ${error instanceof Error ? error.message : String(error)}`);
          }
          break;
        default:
          logger.info(`[UNKNOWN:${msgType}] Received unhandled message type: ${msgType} (${msgTypeName})`);
          if (parsedMessage[FieldTag.SYMBOL]) {
            logger.info(`[UNKNOWN:${msgType}] Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          }

          // Emit an additional categorized event for unknown messages
          emitter.emit('categorizedData', {
            category: 'UNKNOWN',
            type: msgType,
            symbol: parsedMessage[FieldTag.SYMBOL] || '',
            data: parsedMessage,
            timestamp: new Date().toISOString()
          });
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSequenceError = (expectedSeqNum?: number): void => {
    if (expectedSeqNum !== undefined) {
      logger.info(`[SEQUENCE:ERROR] Server expects sequence number: ${expectedSeqNum}`);

      // Perform a full disconnect and reconnect with sequence reset
      if (socket) {
        logger.info('[SEQUENCE:ERROR] Disconnecting due to sequence number error');
        socket.destroy();
        socket = null;
      }

      // Wait a moment before reconnecting
      setTimeout(() => {
        // Reset sequence numbers to what the server expects for PKF-50 compliance
        logger.info(`[SEQUENCE:ERROR] Setting sequence numbers for reconnect:`);

        // For PKF-50, maintain the specialized sequence numbers
        sequenceManager.forceReset(expectedSeqNum);

        // Log all sequence numbers after reset for verification
        const seqNumbers = sequenceManager.getAll();
        logger.info(`[SEQUENCE:ERROR] After reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);

        logger.info(`[SEQUENCE:ERROR] Reconnecting with adjusted sequence numbers`);
        connect();
      }, 2000);
    } else {
      // If we can't parse the expected sequence number, do a full reset
      logger.info('[SEQUENCE:ERROR] Cannot determine expected sequence number, performing full reset');

      if (socket) {
        socket.destroy();
        socket = null;
      }

      setTimeout(() => {
        // Reset all sequence numbers to defaults per PKF-50
        sequenceManager.resetAll();

        // Log all sequence numbers after reset for verification
        const seqNumbers = sequenceManager.getAll();
        logger.info(`[SEQUENCE:ERROR] After full reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);

        logger.info('[SEQUENCE:ERROR] Reconnecting with fully reset sequence numbers');
        connect();
      }, 2000);
    }
  };

  const sendLogon = (): void => {
    logger.info('[SESSION:LOGON] Creating logon message');
    if (!connected) {
      logger.warn('[SESSION:LOGON] Cannot send logon, not connected');
      return;
    }

    try {
      // Always reset all sequence numbers before a new logon
      sequenceManager.resetAll();
      logger.info('[SESSION:LOGON] Reset all sequence numbers before logon');
      logger.info(`[SESSION:LOGON] Sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);

      // Sequence number 1 will be used for the logon message
      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(1); // Always use sequence number 1 for initial logon

      // Add body fields in the order specified by PKF-50
      builder.addField(FieldTag.ENCRYPT_METHOD, DEFAULT_CONNECTION.ENCRYPT_METHOD);
      builder.addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
      builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
      builder.addField(FieldTag.USERNAME, options.username);
      builder.addField(FieldTag.PASSWORD, options.password);
      builder.addField(FieldTag.DEFAULT_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID);
      builder.addField(FieldTag.DEFAULT_CSTM_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_CSTM_APPL_VER_ID);

      const message = builder.buildMessage();
      logger.info(`[SESSION:LOGON] Sending logon message with username: ${options.username}`);
      logger.info(`[SESSION:LOGON] Using sequence number: 1 with reset flag Y`);
      sendMessage(message);

      setTimeout(() => {
        sequenceManager.setSecurityListSeqNum(2);
        sendSecurityListRequestForEquity();
        sendSecurityListRequestForIndex();
      }, 5000);

      logger.info(`[SESSION:LOGON] Logon message sent, sequence numbers now: ${JSON.stringify(sequenceManager.getAll())}`);
    } catch (error) {
      logger.error(`[SESSION:LOGON] Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendLogout = (text?: string): void => {
    if (!connected) {
      logger.warn('[SESSION:LOGOUT] Cannot send logout, not connected');
      emitter.emit('logout', {
        message: 'Logged out from FIX server',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      logger.info('[SESSION:LOGOUT] Creating logout message');

      const builder = createMessageBuilder();

      builder
        .setMsgType(MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement());

      if (text) {
        builder.addField(FieldTag.TEXT, text);
        logger.info(`[SESSION:LOGOUT] Reason: ${text}`);
      }

      const message = builder.buildMessage();
      sendMessage(message);
      logger.info('[SESSION:LOGOUT] Sent logout message to server');
    } catch (error) {
      logger.error(`[SESSION:LOGOUT] Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendHeartbeat = (testReqId: string): void => {
    if (!connected) return;

    try {
      logger.debug(`[HEARTBEAT:SEND] Creating heartbeat message${testReqId ? ' with test request ID: ' + testReqId : ''}`);

      const message = createHeartbeatMessage(
        {
          senderCompId: options.senderCompId,
          targetCompId: options.targetCompId,
          username: options.username,
          password: options.password,
          heartbeatIntervalSecs: options.heartbeatIntervalSecs
        },
        sequenceManager,
        testReqId
      );
      sendMessage(message);
    } catch (error) {
      logger.error(`[HEARTBEAT:SEND] Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendSecurityStatusRequest = (symbol: string): string | null => {
    return null;
  };

  const sendMessage = (message: string): void => {
    if (!socket || !connected) {
      logger.warn('Cannot send message, not connected');
      return;
    }

    try {
      // Extract message type for categorization
      // const segments = message.split(SOH);
      // const msgTypeField = segments.find(s => s.startsWith('35='));
      // const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
      // const msgTypeName = getMessageTypeName(msgType);

      // // Get symbol if it exists for better logging
      // const symbolField = segments.find(s => s.startsWith('55='));
      // const symbol = symbolField ? symbolField.substring(3) : '';

      // // Classify message
      // let messageCategory = 'UNKNOWN';
      // if (msgType === MessageType.MARKET_DATA_REQUEST) {
      //   messageCategory = 'MARKET_DATA';
      // } else if (msgType === MessageType.SECURITY_LIST_REQUEST) {
      //   messageCategory = 'SECURITY_LIST';
      // } else if (msgType === MessageType.TRADING_SESSION_STATUS_REQUEST) {
      //   messageCategory = 'TRADING_STATUS';
      // } else if (msgType === MessageType.LOGON || msgType === MessageType.LOGOUT) {
      //   messageCategory = 'SESSION';
      // } else if (msgType === MessageType.HEARTBEAT || msgType === MessageType.TEST_REQUEST) {
      //   messageCategory = 'HEARTBEAT';
      // }

      // // Log with category and type for clear identification
      // logger.info(`[${messageCategory}:OUTGOING] Sending FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
      // logger.info(`----------------------------OUTGOING MESSAGE-----------------------------`);
      logger.info(message);
      logger.debug(`Current sequence numbers: main=${sequenceManager.getMainSeqNum()}, server=${sequenceManager.getServerSeqNum()}`);

      // Send the message
      socket.write(message);
    } catch (error) {
      logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
      // On send error, try to reconnect
      socket?.destroy();
      connected = false;
    }
  };

  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType: string = '1'     // Default: 1 = Snapshot + Updates
  ): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('[MARKET_DATA:REQUEST] Cannot send market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[MARKET_DATA:REQUEST] Creating market data request for symbols: ${symbols.join(', ')}`);

      // Use market data sequence number instead of main sequence number - starts at 1 per PKF-50
      const marketDataSeqNum = sequenceManager.getNextMarketDataAndIncrement();
      logger.info(`[SEQUENCE] Using market data sequence number: ${marketDataSeqNum}`);

      const builder = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(marketDataSeqNum)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add PartyID group (required by PKF-50)
      builder
        .addField(FieldTag.NO_PARTY_IDS, '1') // NoPartyIDs = 1
        .addField(FieldTag.PARTY_ID, options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
        .addField(FieldTag.PARTY_ID_SOURCE, 'D') // PartyIDSource = D (proprietary/custom)
        .addField(FieldTag.PARTY_ROLE, '3'); // PartyRole = 3 (client ID)

      // Add symbols
      builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        builder.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types
      builder.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        builder.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);

      // Log with clear categorization
      const subTypes: Record<string, string> = {
        '0': 'SNAPSHOT',
        '1': 'SNAPSHOT+UPDATES',
        '2': 'DISABLE_UPDATES'
      };
      const entryTypeNames: Record<string, string> = {
        '0': 'BID',
        '1': 'OFFER',
        '2': 'TRADE',
        '3': 'INDEX_VALUE',
        '4': 'OPENING_PRICE',
        '7': 'HIGH_PRICE',
        '8': 'LOW_PRICE'
      };

      const entryTypeLabels = entryTypes.map(t => entryTypeNames[t] || t).join(', ');
      const subTypeLabel = subTypes[subscriptionType] || subscriptionType;

      logger.info(`[MARKET_DATA:REQUEST] Sent ${subTypeLabel} request with ID: ${requestId}`);
      logger.info(`[MARKET_DATA:REQUEST] Symbols: ${symbols.join(', ')} | Entry types: ${entryTypeLabels} | Using sequence: ${marketDataSeqNum}`);

      return requestId;
    } catch (error) {
      logger.error('[MARKET_DATA:REQUEST] Error sending market data request:', error);
      return null;
    }
  };

  const sendTradingSessionStatusRequest = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.info(`Connection state - Socket: ${socket ? 'present' : 'null'}, Connected: ${connected}, LoggedIn: ${loggedIn}`);
        logger.error('[TRADING_STATUS:REQUEST] Cannot send trading session status request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[TRADING_STATUS:REQUEST] Creating trading session status request`);

      // Use trading status sequence number for trading session status requests - starts at 2 per PKF-50
      const tradingStatusSeqNum = sequenceManager.getNextTradingStatusAndIncrement();
      logger.info(`[SEQUENCE] Using trading status sequence number: ${tradingStatusSeqNum}`);

      const message = createMessageBuilder()
        .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(tradingStatusSeqNum)
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot per PKF-50
        .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`[TRADING_STATUS:REQUEST] Sent request for REG market with ID: ${requestId} | Using sequence: ${tradingStatusSeqNum}`);
      return requestId;
    } catch (error) {
      logger.error('[TRADING_STATUS:REQUEST] Error sending trading session status request:', error);
      return null;
    }
  };

  const sendSecurityListRequest = (): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send security list request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const builder = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(2)
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol

      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent security list request with sequence`);
      return requestId;
    } catch (error) {
      logger.error('Error sending security list request:', error);
      return null;
    }
  };

  const sendSecurityListRequestForEquity = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.info(`Connection state - Socket: ${socket ? 'present' : 'null'}, Connected: ${connected}, LoggedIn: ${loggedIn}`);
        logger.error('[SECURITY_LIST:EQUITY] Cannot send equity security list request: not connected or not logged in');
        return null;
      }

      if (requestedEquitySecurities) {
        logger.info('[SECURITY_LIST:EQUITY] Equity securities already requested, skipping duplicate request');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST:EQUITY] Creating request with ID: ${requestId}`);

      // Use security list sequence number which starts at 2 for PKF-50
      const securityListSeqNum = sequenceManager.getNextSecurityListAndIncrement();
      logger.info(`[SEQUENCE] Using security list sequence number: ${securityListSeqNum}`);

      // Create message with the correct fields for PKF-50
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(securityListSeqNum);

      // Add required fields for equity security list request according to PKF-50
      message.addField(FieldTag.SECURITY_REQ_ID, requestId);
      message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
      message.addField(FieldTag.PRODUCT, '4'); // 4 = EQUITY per PKF-50
      message.addField(FieldTag.TRADING_SESSION_ID, 'REG'); // REG = Regular market session

      const rawMessage = message.buildMessage();

      logger.info('[SECURITY_LIST:EQUITY] Sending equity security list request');
      if (socket) {
        socket.write(rawMessage);
        requestedEquitySecurities = true;
        logger.info(`[SECURITY_LIST:EQUITY] Request sent successfully with ID: ${requestId}`);
        logger.info(`[SECURITY_LIST:EQUITY] Product: EQUITY | Market: REG | Using sequence: ${securityListSeqNum}`);
        return requestId;
      } else {
        logger.error(`[SECURITY_LIST:EQUITY] Failed to send request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST:EQUITY] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const sendSecurityListRequestForIndex = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST:INDEX] Cannot send index security list request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST:INDEX] Creating request with ID: ${requestId}`);

      // Get the next security list sequence number after it's been incremented for equity
      const securityListSeqNum = sequenceManager.getNextSecurityListAndIncrement();
      logger.info(`[SEQUENCE] Using security list sequence number: ${securityListSeqNum}`);

      // Create message in the format specified by PKF-50
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(securityListSeqNum);

      // Add required fields in the order specified by PKF-50
      message.addField(FieldTag.SECURITY_REQ_ID, requestId);
      message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
      message.addField(FieldTag.SYMBOL, 'NA'); // Symbol = NA for all indices
      message.addField(FieldTag.PRODUCT, '5'); // 5 = INDEX per PKF-50
      message.addField(FieldTag.TRADING_SESSION_ID, 'REG'); // REG = Regular market session

      const rawMessage = message.buildMessage();

      if (socket) {
        socket.write(rawMessage);
        logger.info(`[SECURITY_LIST:INDEX] Request sent successfully with ID: ${requestId}`);
        logger.info(`[SECURITY_LIST:INDEX] Product: INDEX | Market: REG | Using sequence: ${securityListSeqNum}`);
        return requestId;
      } else {
        logger.error(`[SECURITY_LIST:INDEX] Failed to send request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST:INDEX] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('[MARKET_DATA:INDEX] Cannot send index data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[MARKET_DATA:INDEX] Creating request for indices: ${symbols.join(', ')}`);

      // Use market data sequence number instead of main sequence number
      const marketDataSeqNum = sequenceManager.getNextMarketDataAndIncrement();
      logger.info(`[SEQUENCE] Using market data sequence number: ${marketDataSeqNum}`);

      const builder = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(marketDataSeqNum)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        builder.addField(FieldTag.SYMBOL, symbol);
      }

      builder.addField(FieldTag.NO_MD_ENTRY_TYPES, '1');
      builder.addField(FieldTag.MD_ENTRY_TYPE, '3'); // Index value

      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);

      logger.info(`[MARKET_DATA:INDEX] Sent SNAPSHOT request with ID: ${requestId}`);
      logger.info(`[MARKET_DATA:INDEX] Indices: ${symbols.join(', ')} | Entry type: INDEX_VALUE | Using sequence: ${marketDataSeqNum}`);

      return requestId;
    } catch (error) {
      logger.error('[MARKET_DATA:INDEX] Error sending index data request:', error);
      return null;
    }
  };

  const sendSymbolMarketDataSubscription = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('[MARKET_DATA:SYMBOL] Cannot send market data subscription: not connected');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[MARKET_DATA:SYMBOL] Creating subscription for symbols: ${symbols.join(', ')}`);

      // Use market data sequence number instead of main sequence number
      const marketDataSeqNum = sequenceManager.getNextMarketDataAndIncrement();
      logger.info(`[SEQUENCE] Using market data sequence number: ${marketDataSeqNum}`);

      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(marketDataSeqNum)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, '3');
      message.addField(FieldTag.MD_ENTRY_TYPE, '0'); // Bid
      message.addField(FieldTag.MD_ENTRY_TYPE, '1'); // Offer
      message.addField(FieldTag.MD_ENTRY_TYPE, '2'); // Trade

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);

      logger.info(`[MARKET_DATA:SYMBOL] Sent SNAPSHOT+UPDATES subscription with ID: ${requestId}`);
      logger.info(`[MARKET_DATA:SYMBOL] Symbols: ${symbols.join(', ')} | Entry types: BID, OFFER, TRADE | Using sequence: ${marketDataSeqNum}`);

      return requestId;
    } catch (error) {
      logger.error('[MARKET_DATA:SYMBOL] Error sending market data subscription:', error);
      return null;
    }
  };

  const handleLogon = (message: ParsedFixMessage, sequenceManager: SequenceManager, emitter: EventEmitter): void => {
    loggedIn = true;

    // Reset requestedEquitySecurities flag upon new logon
    requestedEquitySecurities = true;

    // Get server's sequence number
    const serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);
    logger.info(`[SESSION:LOGON] Server's sequence number: ${serverSeqNum}`);

    // Check if a sequence reset is requested
    const resetFlag = message[FieldTag.RESET_SEQ_NUM_FLAG] === 'Y';

    // Process the logon using the sequence manager to ensure correct sequence numbers
    sequenceManager.processLogon(serverSeqNum, resetFlag);

    logger.info(`[SESSION:LOGON] Successfully logged in to FIX server with sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);

    // Start heartbeat monitoring
    startHeartbeatMonitoring();

    // Emit event so client can handle login success
    emitter.emit('logon', message);

    // Schedule trading session status request after a short delay
    setTimeout(() => {
      if (connected && loggedIn) {
        logger.info('[SESSION:LOGON] Requesting trading session status after login');
        sendTradingSessionStatusRequest();
      }
    }, 1000);
  };

  const handleLogout = (message: ParsedFixMessage, emitter: EventEmitter): { isSequenceError: boolean, expectedSeqNum?: number } => {
    loggedIn = false;

    // Get any provided text reason for the logout
    const text = message[FieldTag.TEXT];

    // Reset sequence numbers on any logout
    logger.info('[SESSION:LOGOUT] Resetting all sequence numbers due to logout');
    sequenceManager.resetAll();
    logger.info(`[SESSION:LOGOUT] After reset, sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);

    // Also reset the requestedEquitySecurities flag so we can request them again after reconnect
    requestedEquitySecurities = false;
    logger.info('[SESSION:LOGOUT] Reset requestedEquitySecurities flag');

    // Check if this is a sequence number related logout
    if (text && (text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'))) {
      logger.warn(`[SESSION:LOGOUT] Received logout due to sequence number issue: ${text}`);

      // Try to parse the expected sequence number from the message
      const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
      if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
        const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
        if (!isNaN(expectedSeqNum)) {
          logger.info(`[SESSION:LOGOUT] Server expects sequence number: ${expectedSeqNum}`);

          // Perform a full disconnect and reconnect with sequence reset
          if (socket) {
            logger.info('[SESSION:LOGOUT] Disconnecting due to sequence number error');
            socket.destroy();
            socket = null;
          }

          // Wait a moment before reconnecting
          setTimeout(() => {
            // Reset sequence numbers to what the server expects
            sequenceManager.forceReset(expectedSeqNum);

            logger.info(`[SESSION:LOGOUT] Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
            connect();
          }, 2000);

          return { isSequenceError: true, expectedSeqNum };
        } else {
          // If we can't parse the expected sequence number, do a full reset
          logger.info('[SESSION:LOGOUT] Cannot parse expected sequence number, performing full reset');

          if (socket) {
            socket.destroy();
            socket = null;
          }

          setTimeout(() => {
            // Reset sequence numbers
            sequenceManager.resetAll();

            logger.info('[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers');
            connect();
          }, 2000);

          return { isSequenceError: true };
        }
      } else {
        // No match found, do a full reset
        logger.info('[SESSION:LOGOUT] No expected sequence number found in message, performing full reset');

        if (socket) {
          socket.destroy();
          socket = null;
        }

        setTimeout(() => {
          // Reset sequence numbers
          sequenceManager.resetAll();

          logger.info('[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers');
          connect();
        }, 2000);

        return { isSequenceError: true };
      }
    } else {
      // For normal logout (not sequence error), also reset the sequence numbers
      logger.info('[SESSION:LOGOUT] Normal logout, sequence numbers reset');

      emitter.emit('logout', message);
      return { isSequenceError: false };
    }
  };

  const startHeartbeatMonitoring = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    // Send heartbeat every N seconds (from options)
    const heartbeatInterval = options.heartbeatIntervalSecs * 1000;
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityTime;

      // If we haven't received anything for 2x the heartbeat interval,
      // send a test request
      if (timeSinceLastActivity > heartbeatInterval * 2) {
        testRequestCount++;

        // If we've sent 3 test requests with no response, disconnect
        if (testRequestCount > 3) {
          logger.warn('No response to test requests, disconnecting');
          disconnect();
          return;
        }
      } else {
        // If we've received activity, just send a regular heartbeat
        sendHeartbeat('');
      }
    }, heartbeatInterval);
  };

  const handleMarketDataSnapshot = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    try {
      logger.info('[MARKET_DATA:SNAPSHOT] Processing market data snapshot...');

      // Call the imported message handler
      const importedHandler = require('./message-handlers').handleMarketDataSnapshot;
      importedHandler(parsedMessage, emitter);

      // Emit an additional categorized event that includes message type information
      emitter.emit('categorizedData', {
        category: 'MARKET_DATA',
        type: 'SNAPSHOT',
        symbol: parsedMessage[FieldTag.SYMBOL] || '',
        data: parsedMessage,
        timestamp: new Date().toISOString()
      });

      logger.info('[MARKET_DATA:SNAPSHOT] Processing complete for symbol: ' + (parsedMessage[FieldTag.SYMBOL] || 'unknown'));
    } catch (error) {
      logger.error(`[MARKET_DATA:SNAPSHOT] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMarketDataIncremental = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    try {
      logger.info('[MARKET_DATA:INCREMENTAL] Processing incremental update...');

      // Call the imported message handler
      const importedHandler = require('./message-handlers').handleMarketDataIncremental;
      importedHandler(parsedMessage, emitter);

      // Emit an additional categorized event that includes message type information
      emitter.emit('categorizedData', {
        category: 'MARKET_DATA',
        type: 'INCREMENTAL',
        symbol: parsedMessage[FieldTag.SYMBOL] || '',
        data: parsedMessage,
        timestamp: new Date().toISOString()
      });

      logger.info('[MARKET_DATA:INCREMENTAL] Processing complete for symbol: ' + (parsedMessage[FieldTag.SYMBOL] || 'unknown'));
    } catch (error) {
      logger.error(`[MARKET_DATA:INCREMENTAL] Error handling incremental refresh: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSecurityList = (parsedMessage: ParsedFixMessage, emitter: EventEmitter, securityCache: any): void => {
    try {
      logger.info('[SECURITY_LIST] Processing security list...');

      // Call the imported message handler
      const importedHandler = require('./message-handlers').handleSecurityList;
      importedHandler(parsedMessage, emitter, securityCache);

      // Determine if this is an EQUITY or INDEX security list
      let securityType = 'UNKNOWN';
      const product = parsedMessage['460']; // Product type field
      if (product === '5') {
        securityType = 'INDEX';
      } else {
        securityType = 'EQUITY';
      }

      const noRelatedSym = parseInt(parsedMessage[FieldTag.NO_RELATED_SYM] || '0', 10);

      // Emit an additional categorized event that includes message type information
      emitter.emit('categorizedData', {
        category: 'SECURITY_LIST',
        type: securityType,
        count: noRelatedSym,
        data: parsedMessage,
        timestamp: new Date().toISOString()
      });

      logger.info(`[SECURITY_LIST:${securityType}] Processing complete for ${noRelatedSym} securities`);
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleTradingSessionStatus = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    try {
      logger.info('[TRADING_STATUS:SESSION] Processing trading session status...');

      // Call the imported message handler
      const importedHandler = require('./message-handlers').handleTradingSessionStatus;
      importedHandler(parsedMessage, emitter);

      // Emit an additional categorized event that includes message type information
      emitter.emit('categorizedData', {
        category: 'TRADING_STATUS',
        type: 'SESSION',
        session: parsedMessage[FieldTag.TRADING_SESSION_ID] || '',
        data: parsedMessage,
        timestamp: new Date().toISOString()
      });

      logger.info('[TRADING_STATUS:SESSION] Processing complete for session: ' +
        (parsedMessage[FieldTag.TRADING_SESSION_ID] || 'unknown'));
    } catch (error) {
      logger.error(`[TRADING_STATUS:SESSION] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleTradingStatus = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    try {
      logger.info('[TRADING_STATUS:SYMBOL] Processing trading status...');

      // Call the imported message handler
      const importedHandler = require('./message-handlers').handleTradingStatus;
      importedHandler(parsedMessage, emitter);

      // Emit an additional categorized event that includes message type information
      emitter.emit('categorizedData', {
        category: 'TRADING_STATUS',
        type: 'SYMBOL',
        symbol: parsedMessage[FieldTag.SYMBOL] || '',
        status: parsedMessage['326'] || '', // Trading Status field
        data: parsedMessage,
        timestamp: new Date().toISOString()
      });

      logger.info('[TRADING_STATUS:SYMBOL] Processing complete for symbol: ' +
        (parsedMessage[FieldTag.SYMBOL] || 'unknown'));
    } catch (error) {
      logger.error(`[TRADING_STATUS:SYMBOL] Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const client = {
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return client;
    },
    connect,
    disconnect,
    sendMarketDataRequest,
    sendSecurityListRequest,
    sendTradingSessionStatusRequest,
    sendSecurityListRequestForEquity,
    sendSecurityListRequestForIndex,
    sendIndexMarketDataRequest,
    sendSymbolMarketDataSubscription,
    sendSecurityStatusRequest,
    sendLogon,
    sendLogout,
    start,
    stop,
    setSequenceNumber: (newSeq: number) => {
      forceResetSequenceNumber(newSeq);
      return client;
    },
    setMarketDataSequenceNumber: (seqNum: number) => {
      sequenceManager.setMarketDataSeqNum(seqNum);
      return client;
    },
    setSecurityListSequenceNumber: (seqNum: number) => {
      sequenceManager.setSecurityListSeqNum(seqNum);
      return client;
    },
    setTradingStatusSequenceNumber: (seqNum: number) => {
      sequenceManager.setTradingStatusSeqNum(seqNum);
      return client;
    },
    getSequenceNumbers: () => {
      return sequenceManager.getAll();
    },
    reset: () => {
      logger.info('[RESET] Performing complete reset with disconnection and reconnection');

      // Reset sequence manager to initial state
      sequenceManager.resetAll();
      logger.info(`[RESET] All sequence numbers reset to initial values: ${JSON.stringify(sequenceManager.getAll())}`);
      logger.info(`[RESET] Verifying SecurityList sequence number is set to 2: ${sequenceManager.getSecurityListSeqNum()}`);

      // Reset flag for requested securities
      requestedEquitySecurities = false;
      logger.info('[RESET] Reset securities request flag');

      // Disconnect and clean up
      if (socket) {
        logger.info('[RESET] Destroying socket connection');
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;
      clearTimers();

      logger.info('[RESET] Connection and sequence numbers reset to initial state');

      // Wait a moment before reconnecting
      setTimeout(() => {
        logger.info('[RESET] Reconnecting after reset');
        connect();
      }, 3000);

      return client;
    },
    requestAllSecurities: () => {
      // Implementation
      return client;
    },
    setupComplete: () => {
      // Implementation  
      return client;
    }
  };

  return client;
}

// Type definition for the returned FixClient API
export interface FixClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'logon', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'logout', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'marketData', listener: (data: any) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'equitySecurityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'indexSecurityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'kseTradingStatus', listener: (status: { symbol: string; status: string; timestamp: string; origTime?: string }) => void): this;
  on(event: 'marketDataReject', listener: (reject: { requestId: string; reason: string; text: string | undefined }) => void): this;
  on(event: 'reject', listener: (reject: { refSeqNum: string; refTagId: string; text: string | undefined; msgType: string }) => void): this;
  on(event: 'categorizedData', listener: (data: {
    category: string;
    type: string;
    symbol?: string;
    session?: string;
    count?: number;
    status?: string;
    requestID?: string;
    refMsgType?: string;
    text?: string;
    data: ParsedFixMessage;
    timestamp: string
  }) => void): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(
    symbols: string[],
    entryTypes?: string[],
    subscriptionType?: string
  ): string | null;
  sendSecurityListRequest(): string | null;
  sendTradingSessionStatusRequest(tradingSessionID?: string): string | null;
  sendSecurityListRequestForEquity(): string | null;
  sendSecurityListRequestForIndex(): string | null;
  sendIndexMarketDataRequest(symbols: string[]): string | null;
  sendSymbolMarketDataSubscription(symbols: string[]): string | null;
  sendSecurityStatusRequest(symbol: string): string | null;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
  setSequenceNumber(newSeq: number): this;
  setMarketDataSequenceNumber(seqNum: number): this;
  setSecurityListSequenceNumber(seqNum: number): this;
  setTradingStatusSequenceNumber(seqNum: number): this;
  getSequenceNumbers(): { main: number; server: number; marketData: number; securityList: number; tradingStatus: number };
  reset(): this;
  requestAllSecurities(): this;
  setupComplete(): this;
}