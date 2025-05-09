import net from 'net';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';


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
  let messageSequenceNumber = 1;
  let receivedData = '';
  let lastActivityTime = 0;
  let testRequestCount = 0;
  let lastSentTime = new Date();
  let msgSeqNum = 1;
  let serverSeqNum = 1; // Add tracking of server sequence number
  let logonTimer: NodeJS.Timeout | null = null;
  let messageBuilder = createMessageBuilder();

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

      // Handle received data
      socket.on('data', (data) => {
        handleData(data);
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

      // // Handle complete messages
      // receivedData += dataStr;
      // processMessage(receivedData);
      // // parseMarketDataSnapshotToJson(receivedData);
      // receivedData = '';

      // Split the data into individual FIX messages
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
      emitter.emit('rawMessage', parseFixMessage(message));
      const parsedMessage = parseFixMessage(message);

      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }

      // Track server's sequence number if available
      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        serverSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
        logger.info(`Server sequence number: ${serverSeqNum}`);
        // Update our sequence number to be one more than server's
        msgSeqNum = serverSeqNum + 1;
      }

      // Log message type for debugging
      const messageType = parsedMessage[FieldTag.MSG_TYPE];
      const messageTypeName = getMessageTypeName(messageType);
      logger.info(`Message type: ${messageType} (${messageTypeName})`);

      // Add message type specific logging
      switch (messageType) {
        case MessageType.LOGON:
          logger.info(`[LOGON] Processing logon message from server`);
          break;
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          logger.info(`[MARKET_DATA] Processing market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          logger.info(`[MARKET_DATA] Processing market data incremental update for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          break;
        case MessageType.SECURITY_LIST:
          logger.info(`[SECURITY_LIST] Processing security list response`);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          logger.info(`[TRADING_STATUS] Processing trading session status update`);
          break;
      }

      // Emit the raw message
      emitter.emit('message', parsedMessage);

      // Process specific message types
      switch (messageType) {
        case MessageType.LOGON:
          logger.info(`[LOGON] Handling logon response`);
          handleLogon(parsedMessage);
          break;
        case MessageType.LOGOUT:
          logger.info(`[LOGOUT] Handling logout message`);
          handleLogout(parsedMessage);
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
          handleMarketDataSnapshot(parsedMessage);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          logger.info(`[MARKET_DATA] Handling market data incremental refresh for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleMarketDataIncremental(parsedMessage);
          break;
        case MessageType.SECURITY_LIST:
          logger.info(`[SECURITY_LIST] Handling security list response`);
          handleSecurityList(parsedMessage);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          logger.info(`[TRADING_STATUS] Handling trading session status update`);
          handleTradingSessionStatus(parsedMessage);
          break;
        case 'f': // Trading Status - specific PSX format
          logger.info(`[TRADING_STATUS] Handling trading status for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleTradingStatus(parsedMessage);
          break;
        case MessageType.REJECT:
          logger.error(`[REJECT] Handling reject message`);
          handleReject(parsedMessage);
          break;
        case 'Y': // Market Data Request Reject
          logger.error(`[MARKET_DATA_REJECT] Handling market data request reject`);
          handleMarketDataRequestReject(parsedMessage);
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
   * Get human-readable name for a message type
   */
  const getMessageTypeName = (msgType: string): string => {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(MessageType)) {
      if (value === msgType) {
        return name;
      }
    }
    return 'UNKNOWN';
  };

  /**
   * Handle a market data snapshot message
   */
  const handleMarketDataSnapshot = (message: ParsedFixMessage): void => {
    try {
      // Extract the request ID to identify which request this is responding to
      const mdReqId = message[FieldTag.MD_REQ_ID];
      const symbol = message[FieldTag.SYMBOL];

      logger.info(`[MARKET_DATA] Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);

      // Process market data entries
      const marketDataItems: MarketDataItem[] = [];

      // Check if we have entries
      const noEntries = parseInt(message[FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);

      if (noEntries > 0) {
        // Extract entries - in a real implementation, this would be more robust
        // and handle multiple entries properly by parsing groups
        for (let i = 0; i < 100; i++) {  // Safe upper limit
          const entryType = message[`${FieldTag.MD_ENTRY_TYPE}.${i}`] || message[FieldTag.MD_ENTRY_TYPE];
          const price = message[`${FieldTag.MD_ENTRY_PX}.${i}`] || message[FieldTag.MD_ENTRY_PX];
          const size = message[`${FieldTag.MD_ENTRY_SIZE}.${i}`] || message[FieldTag.MD_ENTRY_SIZE];

          if (!entryType) break;  // No more entries

          marketDataItems.push({
            symbol: symbol || '',
            entryType,
            price: price ? parseFloat(price) : undefined,
            size: size ? parseFloat(size) : undefined,
            timestamp: message[FieldTag.SENDING_TIME]
          });
        }
      }
      emitter.emit('marketData', marketDataItems);

      if (marketDataItems.length > 0) {
        logger.info(`[MARKET_DATA] Extracted ${marketDataItems.length} market data items for ${symbol}`);

        // Check if this is KSE data
        const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');

        if (isKseData) {
          logger.info(`[MARKET_DATA] Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
          emitter.emit('kseData', marketDataItems);
        }
      }
    } catch (error) {
      logger.error(`[MARKET_DATA] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a market data incremental refresh message
   */
  const handleMarketDataIncremental = (message: ParsedFixMessage): void => {
    // Similar implementation to handleMarketDataSnapshot, but for incremental updates
    try {
      const mdReqId = message[FieldTag.MD_REQ_ID];
      logger.info(`Received market data incremental refresh for request: ${mdReqId}`);

      // Process incremental updates - simplified version
      const marketDataItems: MarketDataItem[] = [];

      // Parse the incremental updates and emit an event
      // Real implementation would be more robust

      if (marketDataItems.length > 0) {
        emitter.emit('marketData', marketDataItems);
      }
    } catch (error) {
      logger.error(`Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a security list message
   */
  const handleSecurityList = (message: ParsedFixMessage): void => {
    try {
      const reqId = message[FieldTag.SECURITY_REQ_ID];
      const securityReqType = message[FieldTag.SECURITY_LIST_REQUEST_TYPE];
      const securityType = message[FieldTag.SECURITY_TYPE];
      const marketId = message[FieldTag.MARKET_ID];
      
      logger.info(`[SECURITY_LIST] Received security list response:`);
      logger.info(`[SECURITY_LIST] - Request ID: ${reqId}`);
      logger.info(`[SECURITY_LIST] - Security Request Type: ${securityReqType}`);
      logger.info(`[SECURITY_LIST] - Security Type: ${securityType}`);
      logger.info(`[SECURITY_LIST] - Market ID: ${marketId}`);

      // Extract securities
      const securities: SecurityInfo[] = [];
      const noSecurities = parseInt(message[FieldTag.NO_RELATED_SYM] || '0', 10);
      logger.info(`[SECURITY_LIST] Number of securities in response: ${noSecurities}`);

      if (noSecurities > 0) {
        // Log all fields in the message for debugging
        logger.info(`[SECURITY_LIST] Message fields: ${JSON.stringify(message)}`);
        
        // Parse security list entries
        for (let i = 0; i < 100; i++) {  // Safe upper limit
          const symbol = message[`${FieldTag.SYMBOL}.${i}`] || message[FieldTag.SYMBOL];
          const securityType = message[`${FieldTag.SECURITY_TYPE}.${i}`] || message[FieldTag.SECURITY_TYPE];
          const securityDesc = message[`${FieldTag.SECURITY_DESC}.${i}`] || message[FieldTag.SECURITY_DESC];
          const marketId = message[`${FieldTag.MARKET_ID}.${i}`] || message[FieldTag.MARKET_ID];

          if (!symbol) {
            logger.info(`[SECURITY_LIST] No more securities found at index ${i}`);
            break;
          }

          logger.info(`[SECURITY_LIST] Processing security ${i + 1}:`);
          logger.info(`[SECURITY_LIST] - Symbol: ${symbol}`);
          logger.info(`[SECURITY_LIST] - Security Type: ${securityType}`);
          logger.info(`[SECURITY_LIST] - Description: ${securityDesc}`);
          logger.info(`[SECURITY_LIST] - Market ID: ${marketId}`);

          securities.push({
            symbol,
            securityType: securityType || '',
            securityDesc: securityDesc || '',
            marketId: marketId || ''
          } as SecurityInfo);
        }
      } else {
        logger.warn(`[SECURITY_LIST] No securities found in response`);
      }

      if (securities.length > 0) {
        logger.info(`[SECURITY_LIST] Successfully extracted ${securities.length} securities`);
        emitter.emit('securityList', securities);
      } else {
        logger.warn(`[SECURITY_LIST] No securities were extracted from the response`);
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a trading session status message
   */
  const handleTradingSessionStatus = (message: ParsedFixMessage): void => {
    try {
      const reqId = message[FieldTag.TRAD_SES_REQ_ID];
      const sessionId = message[FieldTag.TRADING_SESSION_ID];
      const status = message[FieldTag.TRAD_SES_STATUS];

      logger.info(`[TRADING_STATUS] Received trading session status for request: ${reqId}, session: ${sessionId}, status: ${status}`);

      const sessionInfo: TradingSessionInfo = {
        sessionId: sessionId || '',
        status: status || '',
        startTime: message[FieldTag.START_TIME],
        endTime: message[FieldTag.END_TIME]
      };

      emitter.emit('tradingSessionStatus', sessionInfo);
    } catch (error) {
      logger.error(`[TRADING_STATUS] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a heartbeat message
   */
  const sendHeartbeat = (testReqId: string): void => {
    if (!connected) return;

    try {
      const builder = createMessageBuilder();

      builder
        .setMsgType(MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++);

      if (testReqId) {
        builder.addField(FieldTag.TEST_REQ_ID, testReqId);
      }

      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      logger.debug(`Sending FIX message with sequence number ${msgSeqNum}: ${message}`);
      logger.debug(`Current server sequence: ${serverSeqNum}`);

      // Send the message
      socket.write(message);
      lastSentTime = new Date();
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
  const handleLogon = (message: ParsedFixMessage): void => {
    loggedIn = true;

    // Get server's sequence number
    serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);
    msgSeqNum = serverSeqNum + 1; // Set our next sequence number to be one more than server's
    logger.info(`Successfully logged in to FIX server. Server sequence: ${serverSeqNum}, Next sequence: ${msgSeqNum}`);
    
    // Start heartbeat monitoring
    startHeartbeatMonitoring();
    
    // Send initial requests sequentially with delays
    setTimeout(() => {
      if (loggedIn) {
        // First request
        sendTradingSessionStatusRequest();
        
        // Second request after 500ms
        setTimeout(() => {
          if (loggedIn) {
            sendSecurityListRequestForEquity();
            
            // Third request after another 500ms
            setTimeout(() => {
              if (loggedIn) {
                sendSecurityListRequestForIndex();
                
                // Start index updates after all initial requests
                setTimeout(() => {
                  if (loggedIn) {
                    startIndexUpdates();
                  }
                }, 1000);
              }
            }, 1000);
          }
        }, 1000);
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

      // Try to determine what message types and fields are supported

      // 1. First try a simple test request to see if basic message flow works
      const testReqId = `TEST${Date.now()}`;
      const testMessage = createMessageBuilder()
        .setMsgType(MessageType.TEST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.TEST_REQ_ID, testReqId)
        .buildMessage();

      socket.write(testMessage);
      logger.info(`Sent test request with ID: ${testReqId}`);

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
   * Send a security status request to check if a symbol is valid
   */
  const sendSecurityStatusRequest = (symbol: string): string | null => {
    try {
      if (!socket || !connected) {
        return null;
      }

      const requestId = uuidv4();

      // Security status request is type 'e' in FIX 4.4+
      const message = createMessageBuilder()
        .setMsgType('e') // Security Status Request
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SECURITY_STATUS_REQ_ID, requestId)
        .addField(FieldTag.SYMBOL, symbol)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .buildMessage();

      socket.write(message);
      logger.info(`Sent security status request for: ${symbol}`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending security status request for ${symbol}:`, error);
      return null;
    }
  };

  /**
   * Handle market data request reject
   */
  const handleMarketDataRequestReject = (message: ParsedFixMessage): void => {
    try {
      const mdReqId = message[FieldTag.MD_REQ_ID];
      const rejectReason = message[FieldTag.MD_REJECT_REASON];
      const text = message[FieldTag.TEXT];

      logger.error(`Market data request rejected for ID: ${mdReqId}`);
      logger.error(`Reject reason: ${rejectReason}`);
      if (text) {
        logger.error(`Text: ${text}`);
      }

      // Emit an event so client can handle this
      emitter.emit('marketDataReject', {
        requestId: mdReqId,
        reason: rejectReason,
        text: text
      });
    } catch (error) {
      logger.error(`Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Try alternative approaches to request KSE data
   */
  const tryAlternativeKseRequest = (): void => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send alternative KSE request: not connected');
        return;
      }

      logger.info('Sending alternative KSE data request...');

      // Try with snapshot only instead of snapshot+updates
      const requestId = uuidv4();
      const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];

      // Try different entry types in case index value is not supported
      const entryTypes = ['3', '0', '1']; // Index value, Bid, Offer

      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
        .addField(FieldTag.MARKET_DEPTH, '0'); // 0 = Full Book

      // Skip MD_UPDATE_TYPE to see if that helps

      // Add symbols one by one with separate requests
      message.addField(FieldTag.NO_RELATED_SYM, '1'); // Just one symbol at a time
      message.addField(FieldTag.SYMBOL, 'KSE100'); // Try just KSE100

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      // Try without the raw data fields

      const rawMessage = message.buildMessage();
      logger.info(`Alternative KSE request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write("8=FIXT.1.19=25435=W49=realtime56=NMDUFISQ000134=5952=20230104-09:40:37.62442=20230104-09:40:37.00010201=30211500=08055=ASCR8538=T1140=2.57008503=0387=0.008504=0.0000268=2269=xe270=4.570000271=0.001023=0346=0269=xf270=0.570000271=0.001023=0346=010=250");

      // Also try individual symbol requests
      setTimeout(() => {
        for (const symbol of kseSymbols) {
          logger.info(`Sending individual request for symbol: ${symbol}`);
          sendIndividualSymbolRequest(symbol);
        }
      }, 2000);

    } catch (error) {
      logger.error('Error sending alternative KSE request:', error);
    }
  };

  /**
   * Send a request for an individual symbol
   */
  const sendIndividualSymbolRequest = (symbol: string): string | null => {
    try {
      if (!socket || !connected) {
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.NO_RELATED_SYM, '1')
        .addField(FieldTag.SYMBOL, symbol)
        .addField(FieldTag.NO_MD_ENTRY_TYPES, '1')
        .addField(FieldTag.MD_ENTRY_TYPE, '3'); // 3 = Index value

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent individual symbol request for: ${symbol}`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending individual symbol request for ${symbol}:`, error);
      return null;
    }
  };

  /**
   * Handle a logout message from the server
   */
  const handleLogout = (message: ParsedFixMessage): void => {
    loggedIn = false;

    // Emit logout event
    emitter.emit('logout', message);

    // Clear the heartbeat timer as we're logged out
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    logger.info('Logged out from FIX server');
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
          const builder = createMessageBuilder();
          const testReqId = `TEST${Date.now()}`;

          builder
            .setMsgType(MessageType.TEST_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(msgSeqNum++);

          builder.addField(FieldTag.TEST_REQ_ID, testReqId);

          const message = builder.buildMessage();
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
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID('realtime')
        .setTargetCompID('NMDUFISQ0001')
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add PartyID group (required by PSX)
      message
        .addField('453', '1') // NoPartyIDs = 1
        .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
        .addField('447', 'D') // PartyIDSource = D (custom)
        .addField('452', '3'); // PartyRole = 3 (instead of 2)

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      const rawMessage = message.buildMessage();
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
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info('Sent security list request');
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
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent trading session status request for REG market (seq: ${msgSeqNum - 1})`);
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
        logger.error('[SECURITY_LIST] Cannot send security list request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST] Sending security list request for REG and FUT markets (EQUITY) with ID: ${requestId}`);
      
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
        .addField(FieldTag.SECURITY_TYPE, 'EQUITY') // Product type EQUITY
        .addField(FieldTag.MARKET_ID, 'REG') // Regular market
        .addField(FieldTag.MARKET_ID, 'FUT'); // Futures market

      const rawMessage = message.buildMessage();
      logger.info(`[SECURITY_LIST] Sending security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write(rawMessage);
      logger.info(`[SECURITY_LIST] Sent security list request for REG and FUT markets (EQUITY) (seq: ${msgSeqNum - 1})`);
      return requestId;
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending security list request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * Send a security list request for REG market (INDEX)
   */
  const sendSecurityListRequestForIndex = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST] Cannot send security list request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST] Sending security list request for REG market (INDEX) with ID: ${requestId}`);
      
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
        .addField(FieldTag.SECURITY_TYPE, 'INDEX') // Product type INDEX
        .addField(FieldTag.MARKET_ID, 'REG'); // Regular market

      const rawMessage = message.buildMessage();
      logger.info(`[SECURITY_LIST] Sending security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write(rawMessage);
      logger.info(`[SECURITY_LIST] Sent security list request for REG market (INDEX) (seq: ${msgSeqNum - 1})`);
      return requestId;
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending security list request: ${error instanceof Error ? error.message : String(error)}`);
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
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types (3 = Index Value)
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, '1');
      message.addField(FieldTag.MD_ENTRY_TYPE, '3');

      const rawMessage = message.buildMessage();
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
        .setMsgSeqNum(msgSeqNum++)
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
    setInterval(() => {
      sendIndexMarketDataRequest(indexSymbols);
    }, 20000);
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
      msgSeqNum = 1;
      logger.info('Resetting sequence number to 1 for new logon');

      const sendingTime = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
      logger.debug(`Generated SendingTime: ${sendingTime}`);

      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(FieldTag.SENDING_TIME, sendingTime)
        .addField(FieldTag.ENCRYPT_METHOD, '0')
        .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
        .addField(FieldTag.DEFAULT_APPL_VER_ID, '9')
        .addField('1408', 'FIX5.00_PSX_1.00')
        .addField(FieldTag.USERNAME, options.username)
        .addField(FieldTag.PASSWORD, options.password)
        .addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always request sequence number reset

      const message = builder.buildMessage();
      logger.info(`Sending Logon Message with sequence number ${msgSeqNum}: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      sendMessage(message);

      // Don't increment sequence number here - wait for server's response
    } catch (error) {
      logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a logout message to the server
   */
  const sendLogout = (text?: string): void => {
    if (!connected) {
      logger.warn('Cannot send logout, not connected');
      emitter.emit('logout', {
        message: 'Logged out in to FIX server',
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
        .setMsgSeqNum(msgSeqNum++);

      if (text) {
        builder.addField(FieldTag.TEXT, text);
      }

      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle trading status message - specific format for PSX
   */
  const handleTradingStatus = (message: ParsedFixMessage): void => {
    try {
      const symbol = message[FieldTag.SYMBOL];
      const sendingTime = message[FieldTag.SENDING_TIME];
      const origTime = message['42']; // OrigTime
      const tradingStatus = message['102']; // Trading Status

      logger.info(`Received TRADING STATUS for ${symbol}:`);
      logger.info(`  Status: ${tradingStatus}`);
      logger.info(`  Time: ${sendingTime} (Orig: ${origTime})`);

      // Check if this is KSE data
      const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');

      if (isKseData) {
        // Emit a KSE trading status event
        emitter.emit('kseTradingStatus', {
          symbol,
          status: tradingStatus,
          timestamp: sendingTime,
          origTime
        });

        // Convert to a market data item format for compatibility
        const marketDataItems: MarketDataItem[] = [{
          symbol: symbol || '',
          entryType: 'f', // Trading status as entry type
          price: tradingStatus ? parseFloat(tradingStatus) : undefined,
          timestamp: sendingTime
        }];

        // Also emit as KSE data for backward compatibility
        emitter.emit('kseData', marketDataItems);
      }

    } catch (error) {
      logger.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a reject message from the server
   */
  const handleReject = (message: ParsedFixMessage): void => {
    try {
      const refSeqNum = message[FieldTag.REF_SEQ_NUM];
      const refTagId = message[FieldTag.REF_TAG_ID];
      const text = message[FieldTag.TEXT];

      logger.error(`Received REJECT message for sequence number ${refSeqNum}`);
      logger.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);

      // If it's a sequence number issue, try to resync
      if (refTagId === '34' || text?.includes('MsgSeqNum')) {
        logger.info('Sequence number mismatch detected, attempting to resync...');
        // Get server's current sequence number
        serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);
        msgSeqNum = serverSeqNum + 1; // Set our next sequence number to be one more than server's
        logger.info(`Resynced sequence numbers. Server sequence: ${serverSeqNum}, Next sequence: ${msgSeqNum}`);
        
        // Re-send the last message with correct sequence number
        if (loggedIn) {
          logger.info('Re-sending last message with corrected sequence number...');
          // Re-send the security list request
          sendSecurityListRequestForIndex();
        }
      }

      // Emit reject event
      emitter.emit('reject', {
        refSeqNum,
        refTagId,
        text
      });
    } catch (error) {
      logger.error(`Error handling reject message: ${error instanceof Error ? error.message : String(error)}`);
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
    stop
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
  on(event: 'rawMessage', listener: (data: any) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'kseTradingStatus', listener: (status: { symbol: string; status: string; timestamp: string; origTime?: string }) => void): this;
  on(event: 'marketDataReject', listener: (reject: { requestId: string; reason: string; text: string | undefined }) => void): this;
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
}