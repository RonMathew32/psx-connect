import net from "net";
import { SequenceManager } from "../utils/sequence-manager";
import { logger } from "../utils/logger";
import { EventEmitter } from "events";
import {
  createHeartbeatMessageBuilder,
  createIndexMarketDataRequestBuilder,
  createLogonMessageBuilder,
  createLogoutMessageBuilder,
  createMarketDataRequestBuilder,
  createSecurityListRequestForEquityBuilder,
  createSecurityListRequestForFutBuilder,
  createSecurityListRequestForIndexBuilder,
  createSymbolMarketDataSubscriptionBuilder,
  createTradingSessionStatusRequestBuilder,
  getMessageTypeName
} from "./message-builder";
import { parseFixMessage, ParsedFixMessage } from "./message-parser";
import { SOH, MessageType, FieldTag } from "../constants";
import { Socket } from "net";
import { v4 as uuidv4 } from "uuid";
import {
  FixClientOptions,
  MarketDataItem,
  SecurityInfo,
  TradingSessionInfo,
} from "../types";
import {
  handleLogon,
  handleLogout,
  handleMarketDataIncremental,
  handleMarketDataSnapshot,
  handleSecurityList,
  handleTradingSessionStatus,
  handleTradingStatus,
} from "./message-handler";
import { ConnectionState } from "../utils/connection-state";

/**
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions): FixClient {
  const emitter = new EventEmitter();
  let socket: net.Socket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastActivityTime = 0;
  let testRequestCount = 0;
  let logonTimer: NodeJS.Timeout | null = null;
  let lastSecurityListRefresh: number | null = null;

  const sequenceManager = new SequenceManager();
  const state = new ConnectionState(); // Initialize ConnectionState

  const forceResetSequenceNumber = (newSeq: number = 2): void => {
    sequenceManager.forceReset(newSeq);
  };

  const start = (): void => {
    connect();
  };

  const stop = (): void => {
    state.setShuttingDown(true);
    sendLogout();
    disconnect();
  };

  const connect = async (): Promise<void> => {
    // Update to use state.isConnected()
    if (socket && state.isConnected()) {
      logger.warn('Already connected');
      return;
    }

    // Ensure environment variables are defined and valid
    const fixPort = parseInt(process.env.FIX_PORT || '7001', 10);
    const fixHost = process.env.FIX_HOST || '127.0.0.1';


    if (isNaN(fixPort) || !fixHost) {
      logger.error('Invalid FIX_PORT or FIX_HOST environment variable. Please ensure they are set correctly.');
      emitter.emit('error', new Error('Invalid FIX_PORT or FIX_HOST environment variable.'));
      return;
    }

    try {
      logger.info(`Establishing TCP connection to ${fixHost}:${fixPort}...`);
      socket = new Socket();
      socket.setKeepAlive(true, 10000);
      socket.setNoDelay(true);
      socket.setTimeout(options.connectTimeoutMs || 60000);
      socket.connect(fixPort, fixHost);

      // Add error handling for socket errors
      socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        // Save sequence numbers in case of socket errors
        logger.info(`[CONNECTION:ERROR] Saving sequence numbers before potential disconnect: ${JSON.stringify(sequenceManager.getAll())}`);

        if (error.message.includes('ECONNRESET') || error.message.includes('EPIPE')) {
          logger.warn('Connection reset by peer or broken pipe. Will attempt to reconnect...');
        }
        // emitter.emit('error', error);
      });

      socket.on('timeout', () => {
        logger.error('Connection timed out');
        if (socket) {
          socket.destroy();
          socket = null;
        }
        state.setConnected(false); // Update state
        // emitter.emit('error', new Error('Connection timed out'));
      });

      socket.on('close', (hadError) => {
        logger.info(`Socket disconnected${hadError ? ' due to error' : ''}`);

        // Save sequence numbers on any disconnection
        // This ensures we remember our sequence even if we didn't logout properly
        logger.info(`[CONNECTION:CLOSE] Saving current sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);

        state.reset(); // Reset all states on disconnect
        // emitter.emit('disconnected');

        // Only schedule reconnect if not during normal shutdown
        if (!state.isShuttingDown()) {
          scheduleReconnect();
        }
      });

      socket.on('connect', () => {
        logger.info('--------------------------------', fixHost);
        logger.info('--------------------------------', fixPort);
        logger.info(`Connected to ${fixHost}:${fixPort}`);
        state.setConnected(true); // Update state
        if (logonTimer) {
          clearTimeout(logonTimer);
        }
        logonTimer = setTimeout(() => {
          try {
            logger.info('Sending logon message...');
            // Always use ResetSeqNumFlag=Y in logon, which will reset both sides to 1
            // The FIX protocol handles the sequence number reset
            sendLogon();
          } catch (error) {
            logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
            disconnect();
          }
        }, 500);
        // emitter.emit('connected');
      });

      socket.on('drain', () => {
        logger.info('Drained');
      });

      socket.on('data', (data) => {
        logger.info('--------------------------------');
        try {
          // Update last activity time to reset heartbeat timer
          lastActivityTime = Date.now();
          let category = 'UNKNOWN';

          const dataStr = data.toString();
          const messageTypes = [];
          const symbolsFound = [];

          const msgTypeMatches = dataStr.match(/35=([A-Za-z0-9])/g) || [];
          for (const match of msgTypeMatches) {
            const msgType = match.substring(3);
            messageTypes.push(msgType);
          }

          const symbolMatches = dataStr.match(/55=([^\x01]+)/g) || [];
          for (const match of symbolMatches) {
            const symbol = match.substring(3);
            if (symbol) symbolsFound.push(symbol);
          }

          const categorizedMessages = messageTypes.map((type) => {
            if (
              type === MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
              type === MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
              type === 'Y'
            ) {
              category = 'MARKET_DATA';
            } else if (
              type === MessageType.SECURITY_LIST ||
              type === MessageType.SECURITY_LIST_REQUEST
            ) {
              logger.info(`[SECURITY_LIST] Received security list message`);
              category = 'SECURITY_LIST';
            } else if (
              type === MessageType.TRADING_SESSION_STATUS ||
              type === 'f'
            ) {
              category = 'TRADING_STATUS';
            } else if (
              type === MessageType.LOGON ||
              type === MessageType.LOGOUT
            ) {
              category = 'SESSION';
            } else if (
              type === MessageType.HEARTBEAT ||
              type === MessageType.TEST_REQUEST
            ) {
              category = 'HEARTBEAT';
            } else if (type === MessageType.REJECT) {
              category = 'REJECT';
            }
            return `${category}:${type}`;
          });

          if (messageTypes.length > 0) {
            logger.info(
              `[DATA:RECEIVED] Message types: ${categorizedMessages.join(', ')}${symbolsFound.length > 0 ? ' | Symbols: ' + symbolsFound.join(', ') : ''
              }`
            );
          } else {
            logger.warn(`[DATA:RECEIVED] No recognizable message types found in data`);
          }

          // If we received test request, respond immediately with heartbeat
          if (dataStr.includes('35=1')) { // Test request
            const testReqIdMatch = dataStr.match(/112=([^\x01]+)/);
            if (testReqIdMatch && testReqIdMatch[1]) {
              const testReqId = testReqIdMatch[1];
              logger.info(`[TEST_REQUEST] Received test request with ID: ${testReqId}, responding immediately`);
              sendHeartbeat(testReqId);
            }
          }

          logger.info(data);

          logger.info(`[DATA:PROCESSING] Starting message processing...`);
          let processingResult = false;
          try {
            handleData(data);
            processingResult = true;
          } catch (error: any) {
            logger.error(
              `[DATA:ERROR] Failed to process data: ${error instanceof Error ? error.message : String(error)}`
            );
            if (error instanceof Error && error.stack) {
              logger.error(error.stack);
            }
            processingResult = false;
          }
          logger.info(`[DATA:COMPLETE] Message processing ${processingResult ? 'succeeded' : 'failed'}`);
        } catch (err) {
          logger.error(`Error pre-parsing data: ${err}`);
        }
      });

    } catch (error) {
      logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      clearTimers();
      if (state.isConnected() && state.isLoggedIn()) {
        logger.info("[SESSION:LOGOUT] Sending logout message");
        sendLogout();

        // Give some time for the logout message to be sent before destroying the socket
        setTimeout(() => {
          if (socket) {
            socket.destroy();
            socket = null;
          }
          resolve();
        }, 500);
      } else {
        if (socket) {
          socket.destroy();
          socket = null;
        }
        resolve();
      }
    });
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    // Don't reset sequences on reconnect - we'll use the stored numbers
    // If we have a clean start (with ResetSeqNumFlag=Y) the sequences will be reset anyway
    logger.info('[CONNECTION] Scheduling reconnect in 5 seconds');
    logger.info(`[CONNECTION] Will use stored sequence numbers when reconnecting: ${JSON.stringify(sequenceManager.getAll())}`);

    // Reset request states
    state.setRequestSent('equitySecurities', false);
    state.setRequestSent('indexSecurities', false);
    state.setRequestSent('futSecurities', false);

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
      lastActivityTime = Date.now();
      const dataStr = data.toString();

      logger.debug(`[DATA:HANDLING] Received data: ${dataStr.length} bytes`);
      const messages = dataStr.split(SOH);
      let currentMessage = '';
      let messageCount = 0;

      for (const segment of messages) {
        if (segment.startsWith('8=FIX')) {
          if (currentMessage) {
            try {
              processMessage(currentMessage);
              logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
              messageCount++;
            } catch (err: any) {
              logger.error(
                `[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
          currentMessage = segment;
        } else if (currentMessage) {
          currentMessage += SOH + segment;
        }
      }

      if (currentMessage) {
        try {
          processMessage(currentMessage);
          logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
          messageCount++;
        } catch (err: any) {
          logger.error(
            `[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      logger.debug(`[DATA:HANDLING] Processed ${messageCount} FIX messages`);
    } catch (error: any) {
      logger.error(
        `[DATA:ERROR] Error handling data buffer: ${error instanceof Error ? error.message : String(error)}`
      );
      if (error instanceof Error && error.stack) {
        logger.error(error.stack);
      }
      throw error;
    }
  };

  const processMessage = (message: string): void => {
    try {
      const segments = message.split(SOH);

      const fixVersion = segments.find((s) => s.startsWith('8=FIX'));
      if (!fixVersion) {
        logger.warn('Received non-FIX message');
        return;
      }

      const msgTypeField = segments.find((s) => s.startsWith('35='));
      const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
      const msgTypeName = getMessageTypeName(msgType);

      const symbolField = segments.find((s) => s.startsWith('55='));
      const symbol = symbolField ? symbolField.substring(3) : '';

      let messageCategory = 'UNKNOWN';
      if (
        msgType === MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
        msgType === MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
        msgType === 'Y'
      ) {
        messageCategory = 'MARKET_DATA';
      } else if (msgType === MessageType.SECURITY_LIST) {
        messageCategory = 'SECURITY_LIST';
      } else if (
        msgType === MessageType.TRADING_SESSION_STATUS ||
        msgType === 'f'
      ) {
        messageCategory = 'TRADING_STATUS';
      } else if (
        msgType === MessageType.LOGON ||
        msgType === MessageType.LOGOUT
      ) {
        messageCategory = 'SESSION';
      } else if (
        msgType === MessageType.HEARTBEAT ||
        msgType === MessageType.TEST_REQUEST
      ) {
        messageCategory = 'HEARTBEAT';
      } else if (msgType === MessageType.REJECT) {
        messageCategory = 'REJECT';
      }

      logger.info(
        `[${messageCategory}] Received FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`
      );
      logger.info(`------------------------------------------------------------------------------------------------------------`);
      logger.info(message);

      const parsedMessage = parseFixMessage(message);

      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }

      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        const incomingSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
        const msgType = parsedMessage[FieldTag.MSG_TYPE];
        const text = parsedMessage[FieldTag.TEXT] || '';
        const isSequenceError = Boolean(
          text.includes('MsgSeqNum') ||
          text.includes('too large') ||
          text.includes('sequence')
        );

        if (
          (msgType === MessageType.LOGOUT || msgType === MessageType.REJECT) &&
          isSequenceError
        ) {
          logger.warn(`Received ${msgType} with sequence error: ${text}`);
        } else {
          sequenceManager.updateServerSequence(incomingSeqNum);
        }
      }

      switch (msgType) {
        case MessageType.LOGON:
          logger.info(`[SESSION:LOGON] Processing logon message from server`);
          handleLogon(parsedMessage, sequenceManager, emitter, { value: false });
          state.setLoggedIn(true); // Update state
          logger.info(`[SESSION:LOGON] Processing complete`);
          break;
        case MessageType.REJECT:
          // Enhanced logging for reject messages to identify missing fields
          const refTagId = parsedMessage[FieldTag.REF_TAG_ID];
          const refSeqNum = parsedMessage[FieldTag.REF_SEQ_NUM];
          const rejectText = parsedMessage[FieldTag.TEXT];
          const rejectReason = parsedMessage['373']; // SessionRejectReason
          
          logger.error(`[REJECT] Detailed reject information:`);
          logger.error(`[REJECT] Reason code: ${rejectReason}`);
          logger.error(`[REJECT] Referenced tag ID: ${refTagId || 'Not specified'}`);
          logger.error(`[REJECT] Referenced sequence number: ${refSeqNum || 'Not specified'}`);
          logger.error(`[REJECT] Text: ${rejectText || 'No text provided'}`);
          
          if (refTagId) {
            logger.error(`[REJECT] Missing or invalid field tag: ${refTagId}`);
          }
          break;
        case MessageType.LOGOUT:
          logger.info(`[SESSION:LOGOUT] Handling logout message`);
          const logoutResult = handleLogout(
            parsedMessage,
            emitter,
            sequenceManager,
            { value: false },
            socket,
            connect
          );

          if (logoutResult.isSequenceError) {
            logger.info(`[SESSION:LOGOUT] Detected sequence error, handling...`);
            handleSequenceError(logoutResult.expectedSeqNum);
          } else {
            state.setLoggedIn(false); // Update state
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
              logger.info(`[SESSION:LOGOUT] Cleared heartbeat timer`);
            }
          }
          logger.info(`[SESSION:LOGOUT] Processing complete`);
          break;
        // ... other cases remain unchanged ...
        default:
          logger.info(
            `[UNKNOWN:${msgType}] Received unhandled message type: ${msgType} (${msgTypeName})`
          );
          if (parsedMessage[FieldTag.SYMBOL]) {
            logger.info(`[UNKNOWN:${msgType}] Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          }

          emitter.emit('categorizedData', {
            category: 'UNKNOWN',
            type: msgType,
            symbol: parsedMessage[FieldTag.SYMBOL] || '',
            data: parsedMessage,
            timestamp: new Date().toISOString(),
          });
      }
    } catch (error) {
      logger.error(
        `Error processing message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleSequenceError = (expectedSeqNum?: number): void => {
    if (expectedSeqNum !== undefined) {
      logger.info(`[SEQUENCE:ERROR] Server expects sequence number: ${expectedSeqNum}`);
      if (socket) {
        logger.info('[SEQUENCE:ERROR] Disconnecting due to sequence number error');
        socket.destroy();
        socket = null;
      }

      setTimeout(() => {
        sequenceManager.forceReset(expectedSeqNum);
        const seqNumbers = sequenceManager.getAll();
        logger.info(
          `[SEQUENCE:ERROR] After reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`
        );

        logger.info(`[SEQUENCE:ERROR] Reconnecting with adjusted sequence numbers`);
        connect();
      }, 2000);
    } else {
      logger.info('[SEQUENCE:ERROR] Cannot determine expected sequence number, performing full reset');
      if (socket) {
        socket.destroy();
        socket = null;
      }

      setTimeout(() => {
        sequenceManager.resetAll();
        const seqNumbers = sequenceManager.getAll();
        logger.info(
          `[SEQUENCE:ERROR] After full reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`
        );

        logger.info('[SEQUENCE:ERROR] Reconnecting with fully reset sequence numbers');
        connect();
      }, 2000);
    }
  };


  const sendLogon = (): void => {
    logger.info("[SESSION:LOGON] Creating logon message");
    if (!state.isConnected()) {
      logger.warn('[SESSION:LOGON] Cannot send logon: not connected or already logged in');
      return;
    }

    try {
      // Always reset all sequence numbers before a new logon
      sequenceManager.resetAll();
      logger.info("[SESSION:LOGON] Reset all sequence numbers before logon");
      logger.info(
        `[SESSION:LOGON] Sequence numbers: ${JSON.stringify(
          sequenceManager.getAll()
        )}`
      );

      const builder = createLogonMessageBuilder(options, sequenceManager);
      const message = builder.buildMessage();
      logger.info(
        `[SESSION:LOGON] Sending logon message with username: ${options.username}`
      );
      logger.info(`[SESSION:LOGON] Using sequence number: 1 with reset flag Y`);
      sendMessage(message);
      logger.info(
        `[SESSION:LOGON] Logon message sent, sequence numbers now: ${JSON.stringify(
          sequenceManager.getAll()
        )}`
      );
    } catch (error) {
      logger.error(
        `[SESSION:LOGON] Error sending logon: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const sendLogout = (text?: string): void => {
    if (!state.isConnected()) {
      logger.warn("[SESSION:LOGOUT] Cannot send logout, not connected");
      emitter.emit("logout", {
        message: "Logged out from FIX server",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      // We do NOT reset sequence numbers before sending logout
      // This ensures the server receives our logout message with the correct sequence number
      // The sequence reset happens on the next logon with ResetSeqNumFlag=Y
      logger.info("[SESSION:LOGOUT] Creating logout message with reset flag");

      const builder = createLogoutMessageBuilder(
        options,
        sequenceManager,
        text
      );
      const message = builder.buildMessage();
      sendMessage(message);
      logger.info("[SESSION:LOGOUT] Sent logout message to server");

      // Save current sequence numbers to file for possible reconnection on the same day
      logger.info(`[SESSION:LOGOUT] Persisting sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
    } catch (error) {
      logger.error(
        `[SESSION:LOGOUT] Error sending logout: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const sendHeartbeat = (testReqId?: string): void => {
    if (!state.isConnected()) return;

    try {
      logger.debug(
        `[HEARTBEAT:SEND] Creating heartbeat message${testReqId ? " with test request ID: " + testReqId : ""
        }`
      );
      const builder = createHeartbeatMessageBuilder(
        options,
        sequenceManager,
        testReqId
      );
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(
        `[HEARTBEAT:SEND] Error sending heartbeat: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const sendMessage = (message: string): void => {
    if (!state.isConnected()) {
      logger.warn("Cannot send message, not connected");
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
      logger.debug(
        `Current sequence numbers: main=${sequenceManager.getMainSeqNum()}, server=${sequenceManager.getServerSeqNum()}`
      );

      // Send the message
      socket?.write(message);
    } catch (error) {
      logger.error(
        `Error sending message: ${error instanceof Error ? error.message : String(error)
        }`
      );
      // On send error, try to reconnect
      socket?.destroy();
      state.setConnected(false);
    }
  };

  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ["0", "1"],
    subscriptionType: string = "1"
  ): string | null => {
    try {
      if (!state.isConnected()) {
        logger.error(
          "[MARKET_DATA:REQUEST] Cannot send market data request: not connected"
        );
        return null;
      }

      const requestId = uuidv4();
      logger.info(
        `[MARKET_DATA:REQUEST] Creating market data request for symbols: ${symbols.join(
          ", "
        )}`
      );

      const builder = createMarketDataRequestBuilder(
        options,
        sequenceManager,
        symbols,
        entryTypes,
        subscriptionType,
        requestId
      );
      const rawMessage = builder.buildMessage();
      socket?.write(rawMessage);

      const subTypes: Record<string, string> = {
        "0": "SNAPSHOT",
        "1": "SNAPSHOT+UPDATES",
        "2": "DISABLE_UPDATES",
      };
      const entryTypeNames: Record<string, string> = {
        "0": "BID",
        "1": "OFFER",
        "2": "TRADE",
        "3": "INDEX_VALUE",
        "4": "OPENING_PRICE",
        "7": "HIGH_PRICE",
        "8": "LOW_PRICE",
      };

      const entryTypeLabels = entryTypes
        .map((t) => entryTypeNames[t] || t)
        .join(", ");
      const subTypeLabel = subTypes[subscriptionType] || subscriptionType;

      logger.info(
        `[MARKET_DATA:REQUEST] Sent ${subTypeLabel} request with ID: ${requestId}`
      );
      logger.info(
        `[MARKET_DATA:REQUEST] Symbols: ${symbols.join(
          ", "
        )} | Entry types: ${entryTypeLabels} | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`
      );

      return requestId;
    } catch (error) {
      logger.error(
        "[MARKET_DATA:REQUEST] Error sending market data request:",
        error
      );
      return null;
    }
  };

  const sendTradingSessionStatusRequest = (
    tradingSessionID: string = "REG"
  ): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.info(
          `Connection state - Socket: ${socket ? "present" : "null"
          }, Connected: ${state.isConnected()}`
        );
        logger.error(
          "[TRADING_STATUS:REQUEST] Cannot send trading session status request: not connected or not logged in"
        );
        return null;
      }

      const requestId = uuidv4();
      logger.info(
        `[TRADING_STATUS:REQUEST] Creating trading session status request`
      );

      const builder = createTradingSessionStatusRequestBuilder(
        options,
        sequenceManager,
        requestId,
        tradingSessionID
      );
      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);
      logger.info(
        `[TRADING_STATUS:REQUEST] Sent request for ${tradingSessionID} market with ID: ${requestId} | Using sequence: ${sequenceManager.getTradingStatusSeqNum()}`
      );
      return requestId;
    } catch (error) {
      logger.error(
        "[TRADING_STATUS:REQUEST] Error sending trading session status request:",
        error
      );
      return null;
    }
  };

  const sendSecurityListRequestForEquity = (): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.info(
          `Connection state - Socket: ${socket ? "present" : "null"
          }, Connected: ${state.isConnected()}`
        );
        logger.error(
          "[SECURITY_LIST:EQUITY] Cannot send equity security list request: not connected or not logged in"
        );
        return null;
      }

      if (state.hasRequestBeenSent("equitySecurities")) {
        logger.info("[SECURITY_LIST:EQUITY] Equity securities already requested, skipping duplicate request");
        return null;
      }
      
      // Reset the security list sequence number to 2 before sending the request
      sequenceManager.setSecurityListSeqNum(3);
      logger.info("[SECURITY_LIST:EQUITY] Reset security list sequence number to 3");

      const requestId = uuidv4();
      logger.info(
        `[SECURITY_LIST:EQUITY] Creating request with ID: ${requestId}`
      );

      const builder = createSecurityListRequestForEquityBuilder(
        options,
        sequenceManager,
        requestId
      );
      const rawMessage = builder.buildMessage();

      if (socket) {
        logger.info(rawMessage, 'CHECKING MESSAGE FOR EQUITY SECURITY LIST');
        socket.write(rawMessage);
        state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", true);
        logger.info(
          `[SECURITY_LIST:EQUITY] Request sent successfully with ID: ${requestId}`
        );
        logger.info(
          `[SECURITY_LIST:EQUITY] Product: EQUITY | Market: REG | Using sequence: ${sequenceManager.getSecurityListSeqNum()}`
        );
        return requestId;
      } else {
        logger.error(
          `[SECURITY_LIST:EQUITY] Failed to send request - socket not available`
        );
        return null;
      }
    } catch (error) {
      logger.error(
        `[SECURITY_LIST:EQUITY] Error sending request: ${error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  };

  const sendSecurityListRequestForIndex = (): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.error(
          "[SECURITY_LIST:INDEX] Cannot send index security list request: not connected or not logged in"
        );
        return null;
      }
      
      // Reset the security list sequence number to 2 before sending the request
      sequenceManager.setSecurityListSeqNum(3);
      logger.info("[SECURITY_LIST:INDEX] Reset security list sequence number to 2");

      const requestId = uuidv4();
      logger.info(
        `[SECURITY_LIST:INDEX] Creating request with ID: ${requestId}`
      );

      const builder = createSecurityListRequestForIndexBuilder(
        options,
        sequenceManager,
        requestId
      );
      const rawMessage = builder.buildMessage();

      if (socket) {
        socket.write(rawMessage);
        state.setRequestSent("indexSecurities", true);
        logger.info(
          `[SECURITY_LIST:INDEX] Request sent successfully with ID: ${requestId}`
        );
        logger.info(
          `[SECURITY_LIST:INDEX] Product: INDEX | Market: REG | Using sequence: ${sequenceManager.getSecurityListSeqNum()}`
        );
        return requestId;
      } else {
        logger.error(
          `[SECURITY_LIST:INDEX] Failed to send request - socket not available`
        );
        return null;
      }
    } catch (error) {
      logger.error(
        `[SECURITY_LIST:INDEX] Error sending request: ${error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  };

  const sendSecurityListRequestForFut = (): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.info(
          `Connection state - Socket: ${socket ? "present" : "null"
          }, Connected: ${state.isConnected()}`
        );
        logger.error(
          "[SECURITY_LIST:FUT] Cannot send FUT market security list request: not connected or not logged in"
        );
        return null;
      }

      if (state.hasRequestBeenSent("futSecurities")) {
        logger.info("[SECURITY_LIST:FUT] FUT securities already requested, skipping duplicate request");
        return null;
      }

      // Reset the security list sequence number to 3 (don't use 2 to avoid possible collision)
      sequenceManager.setSecurityListSeqNum(3);
      logger.info("[SECURITY_LIST:FUT] Reset security list sequence number to 3");

      const requestId = uuidv4();
      logger.info(
        `[SECURITY_LIST:FUT] Creating request with ID: ${requestId}`
      );

      const builder = createSecurityListRequestForFutBuilder(
        options,
        sequenceManager,
        requestId
      );
      const rawMessage = builder.buildMessage();
      logger.info(rawMessage, 'CHECKING MESSAGE FOR FUT SECURITY LIST');

      if (socket) {
        socket.write(rawMessage);
        state.setRequestSent("futSecurities", true);
        logger.info(
          `[SECURITY_LIST:FUT] Request sent successfully with ID: ${requestId}`
        );
        logger.info(
          `[SECURITY_LIST:FUT] Product: EQUITY | Market: FUT | Using sequence: ${sequenceManager.getSecurityListSeqNum()}`
        );
        return requestId;
      } else {
        logger.error(
          `[SECURITY_LIST:FUT] Failed to send request - socket not available`
        );
        return null;
      }
    } catch (error) {
      logger.error(
        `[SECURITY_LIST:FUT] Error sending request: ${error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  };

  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.error(
          "[MARKET_DATA:INDEX] Cannot send index data request: not connected"
        );
        return null;
      }

      const requestId = uuidv4();
      logger.info(
        `[MARKET_DATA:INDEX] Creating request for indices: ${symbols.join(
          ", "
        )}`
      );

      const builder = createIndexMarketDataRequestBuilder(
        options,
        sequenceManager,
        symbols,
        requestId
      );
      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);

      logger.info(
        `[MARKET_DATA:INDEX] Sent SNAPSHOT request with ID: ${requestId}`
      );
      logger.info(
        `[MARKET_DATA:INDEX] Indices: ${symbols.join(
          ", "
        )} | Entry type: INDEX_VALUE | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`
      );

      return requestId;
    } catch (error) {
      logger.error(
        "[MARKET_DATA:INDEX] Error sending index data request:",
        error
      );
      return null;
    }
  };

  const sendSymbolMarketDataSubscription = (
    symbols: string[]
  ): string | null => {
    try {
      if (!socket || !state.isConnected()) {
        logger.error(
          "[MARKET_DATA:SYMBOL] Cannot send market data subscription: not connected"
        );
        return null;
      }

      const requestId = uuidv4();
      logger.info(
        `[MARKET_DATA:SYMBOL] Creating subscription for symbols: ${symbols.join(
          ", "
        )}`
      );

      const builder = createSymbolMarketDataSubscriptionBuilder(
        options,
        sequenceManager,
        symbols,
        requestId
      );
      const rawMessage = builder.buildMessage();
      socket.write(rawMessage);

      logger.info(
        `[MARKET_DATA:SYMBOL] Sent SNAPSHOT+UPDATES subscription with ID: ${requestId}`
      );
      logger.info(
        `[MARKET_DATA:SYMBOL] Symbols: ${symbols.join(
          ", "
        )} | Entry types: BID, OFFER, TRADE | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`
      );

      return requestId;
    } catch (error) {
      logger.error(
        "[MARKET_DATA:SYMBOL] Error sending market data subscription:",
        error
      );
      return null;
    }
  };

  emitter.on('logon', () => {
    logger.info('[TRADING_STATUS] Received request for trading session status');
    sendTradingSessionStatusRequest();
    // sendSecurityListRequestForEquity();
    
    // Request FUT market security list with a slight delay to avoid overwhelming the server
    setTimeout(() => {
      sendSecurityListRequestForFut();
    }, 500);
  });

  const client = {
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return client;
    },
    connect,
    disconnect,
    sendMarketDataRequest,
    sendTradingSessionStatusRequest,
    sendSecurityListRequestForEquity,
    sendSecurityListRequestForIndex,
    sendSecurityListRequestForFut,
    sendIndexMarketDataRequest,
    sendSymbolMarketDataSubscription,
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
      logger.info(
        "[RESET] Performing complete reset with disconnection and reconnection"
      );

      // Reset sequence manager to initial state
      sequenceManager.resetAll();
      logger.info(
        `[RESET] All sequence numbers reset to initial values: ${JSON.stringify(
          sequenceManager.getAll()
        )}`
      );
      logger.info(
        `[RESET] Verifying SecurityList sequence number is set to 2: ${sequenceManager.getSecurityListSeqNum()}`
      );

      // Reset flag for requested securities
      state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", false);
      state.setRequestSent("indexSecurities", false);
      state.setRequestSent("futSecurities", false);
      logger.info("[RESET] Reset securities request flags");

      // Disconnect and clean up
      if (socket) {
        logger.info("[RESET] Destroying socket connection");
        socket.destroy();
        socket = null;
      }
      state.setConnected(false);
      state.setLoggedIn(false);
      clearTimers();

      logger.info(
        "[RESET] Connection and sequence numbers reset to initial state"
      );

      // Wait a moment before reconnecting
      setTimeout(() => {
        logger.info("[RESET] Reconnecting after reset");
        connect();
      }, 3000);

      return client;
    },
    requestAllSecurities: () => {
      logger.info('[SECURITY_LIST] Requesting all securities data');

      // Reset request flags to allow refreshing
      state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", false);
      state.setRequestSent("indexSecurities", false);
      state.setRequestSent("futSecurities", false);

      // Request security lists with staggered timing to avoid overwhelming the server
      sendSecurityListRequestForEquity();
      
      setTimeout(() => {
        sendSecurityListRequestForFut();
      }, 500);
      
      setTimeout(() => {
        sendSecurityListRequestForIndex();
      }, 1000);

      lastSecurityListRefresh = Date.now();
      return client;
    },
    setupComplete: () => {
      // Implementation
      return client;
    },
  };

  return client;
}

// Type definition for the returned FixClient API
export interface FixClient {
  on(event: "connected", listener: () => void): this;
  on(event: "disconnected", listener: () => void): this;
  on(event: "logon", listener: (message: ParsedFixMessage) => void): this;
  on(event: "logout", listener: (message: ParsedFixMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "message", listener: (message: ParsedFixMessage) => void): this;
  on(event: "marketData", listener: (data: any) => void): this;
  on(
    event: "securityList",
    listener: (securities: SecurityInfo[]) => void
  ): this;
  on(
    event: "equitySecurityList",
    listener: (securities: SecurityInfo[]) => void
  ): this;
  on(
    event: "indexSecurityList",
    listener: (securities: SecurityInfo[]) => void
  ): this;
  on(
    event: "tradingSessionStatus",
    listener: (sessionInfo: TradingSessionInfo) => void
  ): this;
  on(event: "kseData", listener: (data: MarketDataItem[]) => void): this;
  on(
    event: "kseTradingStatus",
    listener: (status: {
      symbol: string;
      status: string;
      timestamp: string;
      origTime?: string;
    }) => void
  ): this;
  on(
    event: "marketDataReject",
    listener: (reject: {
      requestId: string;
      reason: string;
      text: string | undefined;
    }) => void
  ): this;
  on(
    event: "reject",
    listener: (reject: {
      refSeqNum: string;
      refTagId: string;
      text: string | undefined;
      msgType: string;
    }) => void
  ): this;
  on(
    event: "categorizedData",
    listener: (data: {
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
      timestamp: string;
    }) => void
  ): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(
    symbols: string[],
    entryTypes?: string[],
    subscriptionType?: string
  ): string | null;
  sendTradingSessionStatusRequest(tradingSessionID?: string): string | null;
  sendSecurityListRequestForEquity(): string | null;
  sendSecurityListRequestForIndex(): string | null;
  sendSecurityListRequestForFut(): string | null;
  sendIndexMarketDataRequest(symbols: string[]): string | null;
  sendSymbolMarketDataSubscription(symbols: string[]): string | null;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
  setSequenceNumber(newSeq: number): this;
  setMarketDataSequenceNumber(seqNum: number): this;
  setSecurityListSequenceNumber(seqNum: number): this;
  setTradingStatusSequenceNumber(seqNum: number): this;
  getSequenceNumbers(): {
    main: number;
    server: number;
    marketData: number;
    securityList: number;
    tradingStatus: number;
  };
  reset(): this;
  requestAllSecurities(): this;
  setupComplete(): this;
}
