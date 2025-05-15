import net from 'net';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';
import { SequenceManager } from './sequence-manager';
import { 
  createLogonMessage, 
  createLogoutMessage, 
  createHeartbeatMessage,
  createTestRequestMessage,
  createTradingSessionStatusRequest,
  createEquitySecurityListRequest,
  createIndexSecurityListRequest,
  createMarketDataRequest,
  createIndexMarketDataRequest,
  getMessageTypeName
} from './message-helpers';
import {
  handleMarketDataSnapshot,
  handleMarketDataIncremental,
  handleSecurityList,
  handleTradingSessionStatus,
  handleReject,
  handleLogout,
  handleLogon,
  handleMarketDataRequestReject,
  handleTradingStatus
} from './message-handlers';

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
  let msgSeqNum = 1;
  let serverSeqNum = 1;
  
  // Create sequence manager
  const sequenceManager = new SequenceManager();
  
  // Track if we've made certain requests to avoid duplicates
  let requestedEquitySecurities = false;
  let requestedIndexSecurities = false;
  let indexMarketDataInterval: NodeJS.Timeout | null = null;
  
  // Store received securities
  const securityCache = {
    EQUITY: [] as SecurityInfo[],
    INDEX: [] as SecurityInfo[]
  };
  
  // Track current index values
  const indexValues: Record<string, { price?: number, timestamp?: string }> = {};

  /**
   * Reset sequence numbers to a specific value
   * Used when the server expects a specific sequence number
   */
  const forceResetSequenceNumber = (newSeq: number = 2): void => {
    sequenceManager.forceReset(newSeq);
  };

  /**
   * Start the FIX client and connect to the server
   */
  const start = (): void => {
    connect();
  };

  /**
   * Stop the FIX client and disconnect from the server
   */
  const stop = (): void => {
    sendLogout(); // Ensure this is correctly called
    disconnect();
  };

  /**
   * Connect to the FIX server
   */
  const connect = async (): Promise<void> => {

    if (socket && connected) {
      logger.warn('Already connected');
      return;
    }

    try {
      // Create socket with specific configuration - matching fn-psx
      socket = new Socket();

      // Apply socket settings exactly like fn-psx
      socket.setKeepAlive(true);
      socket.setNoDelay(true);

      // Set connection timeout 
      socket.setTimeout(options.connectTimeoutMs || 30000);

      // Setup event handlers
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

        // Clear any existing timeout to prevent duplicate logon attempts
        if (logonTimer) {
          clearTimeout(logonTimer);
        }

        // Send logon message after a short delay - exactly like fn-psx
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
        handleData(data);
      });

      // Connect to the server
      logger.info(`Establishing TCP connection to ${options.host}:${options.port}...`);
      socket.connect(options.port, options.host);
    } catch (error) {
      logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  /**
   * Disconnect from the FIX server
   */
  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      clearTimers();
      if (connected && loggedIn) {
        sendLogout();
      }
      if (socket) {
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;
      resolve();
    });
  };

  /**
   * Schedule a reconnection attempt
   */
  const scheduleReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    logger.info('Scheduling reconnect in 5 seconds');
    reconnectTimer = setTimeout(() => {
      logger.info('Attempting to reconnect');
      connect();
    }, 5000);
  };

  /**
   * Clear all timers
   */
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

  /**
   * Handle incoming data from the socket
   */
  const handleData = (data: Buffer): void => {
    try {
      lastActivityTime = Date.now();
      const dataStr = data.toString();

      logger.debug(`Received data: ${dataStr.length} bytes`);
      const messages = dataStr.split(SOH);
      let currentMessage = '';

      for (const segment of messages) {
        if (segment.startsWith('8=FIX')) {
          // If we have a previous message, process it
          if (currentMessage) {
            processMessage(currentMessage);
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
        // logger.info(`Processing message: ${currentMessage}`);
        processMessage(currentMessage);
      }
    } catch (error) {
      logger.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Process a FIX message
   */
  const processMessage = (message: string): void => {
    try {
      const segments = message.split(SOH);

      // FIX message should start with "8=FIX"
      const fixVersion = segments.find(s => s.startsWith('8=FIX'));
      if (!fixVersion) {
        logger.warn('Received non-FIX message');
        return;
      }

      // Log the raw message in FIX format (replacing SOH with pipe for readability)
      logger.info(`Received FIX message: ${message}`);
      logger.info(`------------------------------------------------------------------------------------------------------------`);
      
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

      // Log message type for debugging
      const messageType = parsedMessage[FieldTag.MSG_TYPE];
      const messageTypeName = getMessageTypeName(messageType);
      logger.info(`Message type: ${messageType} (${messageTypeName})`);

      // Process specific message types
      switch (messageType) {
        case MessageType.LOGON:
          logger.info(`[LOGON] Processing logon message from server`);
          handleLogon(parsedMessage, sequenceManager, emitter);
          loggedIn = true;
          break;
        case MessageType.LOGOUT:
          logger.info(`[LOGOUT] Handling logout message`);
          const logoutResult = handleLogout(parsedMessage, emitter);
          
          if (logoutResult.isSequenceError) {
            handleSequenceError(logoutResult.expectedSeqNum);
          } else {
            loggedIn = false;
            
            // Clear the heartbeat timer as we're logged out
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
          break;
        case MessageType.HEARTBEAT:
          logger.debug(`[HEARTBEAT] Received heartbeat`);
          // Just log and reset the test request counter
          testRequestCount = 0;
          break;
        case MessageType.TEST_REQUEST:
          logger.info(`[TEST_REQUEST] Responding to test request`);
          // Respond with heartbeat
          sendHeartbeat(parsedMessage[FieldTag.TEST_REQ_ID]);
          break;
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          logger.info(`[MARKET_DATA] Handling market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          // Update market data sequence number
          if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
            sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10));
          }
          handleMarketDataSnapshot(parsedMessage, emitter);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          logger.info(`[MARKET_DATA] Handling market data incremental refresh for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          // Update market data sequence number
          if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
            sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10));
          }
          handleMarketDataIncremental(parsedMessage, emitter);
          break;
        case MessageType.SECURITY_LIST:
          logger.info(`[SECURITY_LIST] Handling security list response`);
          handleSecurityList(parsedMessage, emitter, securityCache);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          logger.info(`[TRADING_STATUS] Handling trading session status update`);
          handleTradingSessionStatus(parsedMessage, emitter);
          break;
        case 'f': // Trading Status - specific PSX format
          logger.info(`[TRADING_STATUS] Handling trading status for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleTradingStatus(parsedMessage, emitter);
          break;
        case MessageType.REJECT:
          logger.error(`[REJECT] Handling reject message`);
          const rejectResult = handleReject(parsedMessage, emitter);
          
          if (rejectResult.isSequenceError) {
            handleSequenceError(rejectResult.expectedSeqNum);
          }
          break;
        case 'Y': // Market Data Request Reject
          logger.error(`[MARKET_DATA_REJECT] Handling market data request reject`);
          handleMarketDataRequestReject(parsedMessage, emitter);
          break;
        default:
          logger.info(`[UNKNOWN] Received unhandled message type: ${messageType} (${messageTypeName})`);
          if (parsedMessage[FieldTag.SYMBOL]) {
            logger.info(`[UNKNOWN] Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          }
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Handle sequence number errors by resetting or adjusting sequence numbers
   */
  const handleSequenceError = (expectedSeqNum?: number): void => {
    if (expectedSeqNum !== undefined) {
      logger.info(`Server expects sequence number: ${expectedSeqNum}`);
      
      // Perform a full disconnect and reconnect with sequence reset
      if (socket) {
        logger.info('Disconnecting due to sequence number error');
        socket.destroy();
        socket = null;
      }
      
      // Wait a moment before reconnecting
      setTimeout(() => {
        // Reset sequence numbers to what the server expects
        sequenceManager.forceReset(expectedSeqNum);
        
        logger.info(`Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
        connect();
      }, 2000);
    } else {
      // If we can't parse the expected sequence number, do a full reset
      logger.info('Cannot determine expected sequence number, performing full reset');
      
      if (socket) {
        socket.destroy();
        socket = null;
      }
      
      setTimeout(() => {
        // Reset sequence numbers
        sequenceManager.resetAll();
        
        logger.info('Reconnecting with fully reset sequence numbers');
        connect();
      }, 2000);
    }
  };

  /**
   * Send a heartbeat message
   */
  const sendHeartbeat = (testReqId: string): void => {
    if (!connected) return;

    try {
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
      logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a security status request to check if a symbol is valid
   */
  const sendSecurityStatusRequest = (symbol: string): string | null => {
    // Implementation as needed
    return null;
  };

  /**
   * Send a FIX message to the server
   */
  const sendMessage = (message: string): void => {
    if (!socket || !connected) {
      logger.warn('Cannot send message, not connected');
      return;
    }

    try {
      // Log the raw message with SOH delimiters replaced with pipes for readability
      logger.debug(`Sending FIX message with sequence number ${sequenceManager.getMainSeqNum()}: ${message}`);
      logger.debug(`Current server sequence: ${sequenceManager.getServerSeqNum()}`);

      // Send the message
      socket.write(message);
    } catch (error) {
      logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
      // On send error, try to reconnect
      socket?.destroy();
      connected = false;
    }
  };

  /**
   * Handle a logon message from the server
   */
  const handleLogon = (message: ParsedFixMessage, sequenceManager: SequenceManager, emitter: EventEmitter): void => {
    loggedIn = true;

    // Get server's sequence number
    const serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);
    // Update using forceReset which sets both main and server sequence numbers
    sequenceManager.forceReset(serverSeqNum);

    // If reset sequence number flag is Y, we should reset our sequence counter to 2
    // (1 for the server's logon acknowledgment, and our next message will be 2)
    if (message[FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
      // Use forceReset which handles both main sequence number and server sequence number
      sequenceManager.forceReset(2);
      sequenceManager.setMarketDataSeqNum(2); // Reset market data sequence
      logger.info(`Reset sequence flag is Y, setting our sequence numbers to 2`);
    } else {
      // Otherwise, set our next sequence to be one more than the server's
      sequenceManager.forceReset(sequenceManager.getServerSeqNum() + 1);
      // Ensure market data sequence number is also aligned
      sequenceManager.setMarketDataSeqNum(sequenceManager.getMainSeqNum());
      logger.info(`Using server's sequence, setting sequence numbers to: ${sequenceManager.getMainSeqNum()}`);
    }

    logger.info(`Successfully logged in to FIX server. Server sequence: ${sequenceManager.getServerSeqNum()}, Next sequence: ${sequenceManager.getMainSeqNum()}`);

    // Start heartbeat monitoring
    startHeartbeatMonitoring();

    // Emit event so client can handle login success
    emitter.emit('logon', message);

    // Note: We're removing automatic security list requests after login
    // because we need to control sequence numbers manually
    logger.info('[SECURITY_LIST] Login successful. Use explicit security list requests after logon.');

    // Add a timer to schedule security list requests after a short delay
    setTimeout(() => {
      if (connected && loggedIn) {
        logger.info('[SECURITY_LIST] Requesting equity security list after login');
        sendSecurityListRequestForEquity();
        
        // Request index securities after a delay to prevent sequence issues
        setTimeout(() => {
          if (connected && loggedIn) {
            logger.info('[SECURITY_LIST] Requesting index security list after login');
            sendSecurityListRequestForIndex();
          }
        }, 3000);
      }
    }, 2000);
  };

  /**
   * Check server features to understand its capabilities
   */
  const checkServerFeatures = (): void => {
    try {
      if (!socket || !connected) {
        return;
      }

      logger.info('Checking server features and capabilities...');

      // 1. First try a simple test request to see if basic message flow works
      const testMessage = createTestRequestMessage(
        {
          senderCompId: options.senderCompId,
          targetCompId: options.targetCompId,
          username: options.username,
          password: options.password,
          heartbeatIntervalSecs: options.heartbeatIntervalSecs
        }, 
        sequenceManager
      );

      socket.write(testMessage);
      logger.info(`Sent test request`);

      // 2. Check if the server supports security status request
      // This can help identify what endpoint types are available
      setTimeout(() => {
        sendSecurityStatusRequest('KSE100');
      }, 2000);
    } catch (error) {
      logger.error('Error checking server features:', error);
    }
  };

  /**
   * Send a market data request
   */
  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType: string = '1'     // Default: 1 = Snapshot + Updates
  ): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const builder = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add PartyID group (required by PSX)
      builder
        .addField('453', '1') // NoPartyIDs = 1
        .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
        .addField('447', 'D') // PartyIDSource = D (custom)
        .addField('452', '3'); // PartyRole = 3 (instead of 2)

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
      logger.info(`Sent market data request with ID: ${requestId}`);
      logger.info(`Market data request message: ${rawMessage}`);
      socket.write(rawMessage);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data request:', error);
      return null;
    }
  };

  /**
   * Send a security list request
   */
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
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol

      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent security list request with sequence number: ${sequenceManager.getMainSeqNum()}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending security list request:', error);
      return null;
    }
  };

  /**
   * Send a trading session status request for REG market
   */
  const sendTradingSessionStatusRequest = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('Cannot send trading session status request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent trading session status request for REG market with ID: ${requestId}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending trading session status request:', error);
      return null;
    }
  };

  /**
   * Send a security list request for REG and FUT markets (EQUITY)
   */
  const sendSecurityListRequestForEquity = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST] Cannot send equity security list request: not connected or not logged in');
        return null;
      }

      if (requestedEquitySecurities) {
        logger.info('[SECURITY_LIST] Equity securities already requested, skipping duplicate request');
        return null;
      }

      const { message, requestId } = createEquitySecurityListRequest(
        {
          senderCompId: options.senderCompId,
          targetCompId: options.targetCompId,
          username: options.username,
          password: options.password,
          heartbeatIntervalSecs: options.heartbeatIntervalSecs
        },
        sequenceManager
      );

      if (socket) {
        socket.write(message);
        requestedEquitySecurities = true;
        logger.info(`[SECURITY_LIST] Equity security list request sent successfully.`);
        return requestId;
      } else {
        logger.error(`[SECURITY_LIST] Failed to send equity security list request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  
  /**
   * Send a security list request for REG market (INDEX)
   */
  const sendSecurityListRequestForIndex = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST] Cannot send index security list request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);

      // Create message in the format used by fn-psx project
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement());

      // Add required fields in same order as fn-psx
      message.addField(FieldTag.SECURITY_REQ_ID, requestId);
      message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
      message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
      message.addField('460', '5'); // Product = INDEX (5)
      message.addField('336', 'REG'); // TradingSessionID = REG

      const rawMessage = message.buildMessage();
      logger.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);

      if (socket) {
        socket.write(rawMessage);
        logger.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${sequenceManager.getNextAndIncrement()}`);
        return requestId;
      } else {
        logger.error(`[SECURITY_LIST] Failed to send index security list request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * Send a market data request for index values
   */
  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const builder = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        builder.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types (3 = Index Value)
      builder.addField(FieldTag.NO_MD_ENTRY_TYPES, '1');
      builder.addField(FieldTag.MD_ENTRY_TYPE, '3');

      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent market data request for indices: ${symbols.join(', ')}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data request:', error);
      return null;
    }
  };

  /**
   * Send a market data subscription request for symbol data
   */
  const sendSymbolMarketDataSubscription = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data subscription: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
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
      logger.info(`Sent market data subscription for symbols: ${symbols.join(', ')}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data subscription:', error);
      return null;
    }
  };

  // Start index data updates every 20 seconds
  const startIndexUpdates = () => {
    const indexSymbols = ['KSE100', 'KMI30'];
    indexMarketDataInterval = setInterval(() => {
      sendIndexMarketDataRequest(indexSymbols);
    }, 20000);
  };

  /**
   * Handle a logout message from the server
   */
  const handleLogout = (message: ParsedFixMessage, emitter: EventEmitter): { isSequenceError: boolean, expectedSeqNum?: number } => {
    loggedIn = false;

    // Get any provided text reason for the logout
    const text = message[FieldTag.TEXT];

    // Check if this is a sequence number related logout
    if (text && (text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'))) {
      logger.warn(`Received logout due to sequence number issue: ${text}`);

      // Try to parse the expected sequence number from the message
      const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
      if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
        const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
        if (!isNaN(expectedSeqNum)) {
          logger.info(`Server expects sequence number: ${expectedSeqNum}`);

          // Perform a full disconnect and reconnect with sequence reset
          if (socket) {
            logger.info('Disconnecting due to sequence number error');
            socket.destroy();
            socket = null;
          }

          // Wait a moment before reconnecting
          setTimeout(() => {
            // Reset sequence numbers to what the server expects
            sequenceManager.forceReset(expectedSeqNum);
            
            logger.info(`Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
            connect();
          }, 2000);

          return { isSequenceError: true, expectedSeqNum };
        } else {
          // If we can't parse the expected sequence number, do a full reset
          logger.info('Cannot parse expected sequence number, performing full reset');

          if (socket) {
            socket.destroy();
            socket = null;
          }

          setTimeout(() => {
            // Reset sequence numbers
            sequenceManager.resetAll();
            
            logger.info('Reconnecting with fully reset sequence numbers');
            connect();
          }, 2000);

          return { isSequenceError: true };
        }
      } else {
        // No match found, do a full reset
        logger.info('No expected sequence number found in message, performing full reset');

        if (socket) {
          socket.destroy();
          socket = null;
        }

        setTimeout(() => {
          // Reset sequence numbers
          sequenceManager.resetAll();
          
          logger.info('Reconnecting with fully reset sequence numbers');
          connect();
        }, 2000);

        return { isSequenceError: true };
      }
    } else {
      // Emit logout event for normal logouts
      emitter.emit('logout', message);
      return { isSequenceError: false };
    }
  };

  /**
   * Start the heartbeat monitoring process
   */
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

        // Send test request
        try {
          const message = createTestRequestMessage(
            {
              senderCompId: options.senderCompId,
              targetCompId: options.targetCompId,
              username: options.username,
              password: options.password,
              heartbeatIntervalSecs: options.heartbeatIntervalSecs
            }, 
            sequenceManager
          );
          sendMessage(message);
        } catch (error) {
          logger.error(`Error sending test request: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // If we've received activity, just send a regular heartbeat
        sendHeartbeat('');
      }
    }, heartbeatInterval);
  };

  /**
   * Send a logout message to the server
   */
  const sendLogout = (text?: string): void => {
    if (!connected) {
      logger.warn('Cannot send logout, not connected');
      emitter.emit('logout', {
        message: 'Logged out from FIX server',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const builder = createMessageBuilder();

      builder
        .setMsgType(MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement());

      if (text) {
        builder.addField(FieldTag.TEXT, text);
      }

      const message = builder.buildMessage();
      sendMessage(message);
      logger.info('Sent logout message to server');
    } catch (error) {
      logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a logon message to the server
   */
  const sendLogon = (): void => {
    logger.info('Sending logon message...');
    if (!connected) {
      logger.warn('Cannot send logon, not connected');
      return;
    }

    try {
      // Always reset sequence number on logon
      msgSeqNum = 1; // Start with 1 for the logon message
      serverSeqNum = 1;
      logger.info('Resetting sequence numbers to 1 for new logon');

      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement()); // Use sequence number 1

      // Then add body fields in the order used by fn-psx
      builder.addField(FieldTag.ENCRYPT_METHOD, '0');
      builder.addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
      builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
      builder.addField(FieldTag.USERNAME, options.username);
      builder.addField(FieldTag.PASSWORD, options.password);
      builder.addField(FieldTag.DEFAULT_APPL_VER_ID, '9');
      builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID

      const message = builder.buildMessage();
      logger.info(`Sending Logon Message`);
      sendMessage(message);
      
      // Now increment sequence number for next message
      msgSeqNum++;
      logger.info(`Incremented sequence number to ${msgSeqNum} for next message after logon`);
    } catch (error) {
      logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Return the public API
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
    getSequenceNumbers: () => {
      return sequenceManager.getAll();
    },
    reset: () => {
      // Disconnect completely
      logger.info('[RESET] Performing complete reset with disconnection and reconnection');
      if (socket) {
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;

      // Clear any timers
      clearTimers();

      // Reset sequence numbers
      sequenceManager.resetAll();

      logger.info('[RESET] Connection and sequence numbers reset to initial state');

      // Wait a moment and reconnect
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
  getSequenceNumbers(): { main: number; server: number; marketData: number; securityList: number };
  reset(): this;
  requestAllSecurities(): this;
  setupComplete(): this;
}