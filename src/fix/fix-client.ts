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

      // Handle complete messages
      receivedData += dataStr;
      processMessage(receivedData);
      // parseMarketDataSnapshotToJson(receivedData);
      receivedData = '';
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
      emitter.emit('rawMessage', parseFixMessage(message));
      const parsedMessage = parseFixMessage(message);

      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }

      // Log message type for debugging
      const messageType = parsedMessage[FieldTag.MSG_TYPE];
      logger.info(`Message type: ${messageType} (${getMessageTypeName(messageType)})`);

      // Track server's sequence number if available
      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        const serverSeq = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
        logger.info(`Server sequence number: ${serverSeq}`);
      }

      // Log symbol information if present
      if (parsedMessage[FieldTag.SYMBOL]) {
        logger.info(`Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
        // Log additional symbol-related fields
        if (parsedMessage['140']) logger.info(`  Last Price: ${parsedMessage['140']}`);
        if (parsedMessage['8503']) logger.info(`  Volume: ${parsedMessage['8503']}`);
        if (parsedMessage['387']) logger.info(`  Total Value: ${parsedMessage['387']}`);
        if (parsedMessage['8504']) logger.info(`  Market Cap: ${parsedMessage['8504']}`);
      }

      // Emit the raw message
      emitter.emit('message', parsedMessage);

      // Process specific message types
      switch (messageType) {
        case MessageType.LOGON:
          handleLogon(parsedMessage);
          break;
        case MessageType.LOGOUT:
          handleLogout(parsedMessage);
          break;
        case MessageType.HEARTBEAT:
          // Just log and reset the test request counter
          testRequestCount = 0;
          break;
        case MessageType.TEST_REQUEST:
          // Respond with heartbeat
          sendHeartbeat(parsedMessage[FieldTag.TEST_REQ_ID]);
          break;
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          logger.info(`Received market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleMarketDataSnapshot(parsedMessage);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          logger.info(`Received market data incremental refresh for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleMarketDataIncremental(parsedMessage);
          break;
        case MessageType.SECURITY_LIST:
          handleSecurityList(parsedMessage);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          handleTradingSessionStatus(parsedMessage);
          break;
        case 'f': // Trading Status - specific PSX format
          logger.info(`Received TRADING STATUS for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
          handleTradingStatus(parsedMessage);
          break;
        case MessageType.REJECT:
          logger.error(`Received REJECT message: ${JSON.stringify(parsedMessage)}`);
          if (parsedMessage[FieldTag.TEXT]) {
            logger.error(`Reject reason: ${parsedMessage[FieldTag.TEXT]}`);
          }
          break;
        case 'Y': // Market Data Request Reject
          logger.error(`Received MARKET DATA REQUEST REJECT message: ${JSON.stringify(parsedMessage)}`);
          handleMarketDataRequestReject(parsedMessage);
          break;
        default:
          logger.info(`Received unhandled message type: ${messageType} (${getMessageTypeName(messageType)})`);
          if (parsedMessage[FieldTag.SYMBOL]) {
            logger.info(`  Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
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

      logger.info(`Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);

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
        logger.info(`Extracted ${marketDataItems.length} market data items for ${symbol}`);

        // Check if this is KSE data
        const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');

        if (isKseData) {
          logger.info(`Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
          emitter.emit('kseData', marketDataItems);
        }

        // Also emit general market data event
      }
    } catch (error) {
      logger.error(`Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
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
      logger.info(`Received security list for request: ${reqId}`);

      // Extract securities
      const securities: SecurityInfo[] = [];
      const noSecurities = parseInt(message[FieldTag.NO_RELATED_SYM] || '0', 10);

      if (noSecurities > 0) {
        // Simplified parsing of security list - real implementation would handle groups properly
        // This is just a skeleton
        for (let i = 0; i < 100; i++) {  // Safe upper limit
          const symbol = message[`${FieldTag.SYMBOL}.${i}`] || message[FieldTag.SYMBOL];
          const securityType = message[`${FieldTag.SECURITY_TYPE}.${i}`] || message[FieldTag.SECURITY_TYPE];

          if (!symbol) break;  // No more securities

          securities.push({
            symbol,
            securityType: securityType || '',
            securityDesc: message[`${FieldTag.SECURITY_DESC}.${i}`] || message[FieldTag.SECURITY_DESC]
          });
        }
      }

      if (securities.length > 0) {
        logger.info(`Extracted ${securities.length} securities`);
        emitter.emit('securityList', securities);
      }
    } catch (error) {
      logger.error(`Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
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

      logger.info(`Received trading session status for request: ${reqId}, session: ${sessionId}, status: ${status}`);

      const sessionInfo: TradingSessionInfo = {
        sessionId: sessionId || '',
        status: status || '',
        startTime: message[FieldTag.START_TIME],
        endTime: message[FieldTag.END_TIME]
      };

      emitter.emit('tradingSessionStatus', sessionInfo);
    } catch (error) {
      logger.error(`Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
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
      // logger.debug(`Sending FIX message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      logger.debug(`Sending FIX message: ${message}`);

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

    // Reset our sequence number to ensure we start fresh
    msgSeqNum = 2; // Start from 2 since we just sent message 1 (logon)
    logger.info(`Successfully logged in to FIX server. Next sequence number: ${msgSeqNum}`);
    const requestId = client.sendMarketDataRequest(['CNERGY'], ['0', '1', '3']); // CNERGY symbol
    logger.info(`Sent market data request with ID: ${requestId}`);
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
   * Send a trading session status request
   */
  const sendTradingSessionStatusRequest = (tradingSessionID?: string): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send trading session status request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1'); // 1 = Snapshot + Updates

      // Add trading session ID if provided
      if (tradingSessionID) {
        message.addField(FieldTag.TRADING_SESSION_ID, tradingSessionID);
      }

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent trading session status request${tradingSessionID ? ` for session ${tradingSessionID}` : ''}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending trading session status request:', error);
      return null;
    }
  };

  /**
   * Send a request specifically for KSE (Karachi Stock Exchange) data
   */
  const sendKseDataRequest = (): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send KSE data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`Creating KSE data request with ID: ${requestId}`);

      // Add KSE index or key symbols
      const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];

      // Add entry types - for indices we typically want the index value
      const entryTypes = ['3']; // 3 = Index Value

      logger.info(`Requesting symbols: ${kseSymbols.join(', ')} with entry types: ${entryTypes.join(', ')}`);

      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, kseSymbols.length.toString());
      for (const symbol of kseSymbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      // Add custom KSE identifier field if needed
      if (options.rawData === 'kse') {
        logger.info(`Adding raw data field: ${options.rawData} with length: ${options.rawDataLength}`);
        message.addField(FieldTag.RAW_DATA_LENGTH, options.rawDataLength?.toString() || '3');
        message.addField(FieldTag.RAW_DATA, 'kse');
      }

      const rawMessage = message.buildMessage();
      logger.info(`KSE data request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write("8=FIXT.1.19=25435=W49=realtime56=NMDUFISQ000134=5952=20230104-09:40:37.62442=20230104-09:40:37.00010201=30211500=08055=ASCR8538=T1140=2.57008503=0387=0.008504=0.0000268=2269=xe270=4.570000271=0.001023=0346=0269=xf270=0.570000271=0.001023=0346=010=250");
      logger.info(`Sent KSE data request for indices: ${kseSymbols.join(', ')}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending KSE data request:', error);
      return null;
    }
  };

  /**
   * Send a logon message to the server
   */
  const sendLogon = (): void => {
    logger.info('logout first');
    if (!connected) {
      logger.warn('Cannot send logon, not connected');
      return;
    }

    try {
      if (options.resetOnLogon) {
        msgSeqNum = 1;
        logger.info('Resetting sequence numbers for new logon');
      }

      const sendingTime = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
      logger.debug(`Generated SendingTime: ${sendingTime}`);

      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SENDING_TIME, sendingTime)
        .addField(FieldTag.ENCRYPT_METHOD, '0')
        .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
        .addField(FieldTag.DEFAULT_APPL_VER_ID, '9')
        .addField('1408', 'FIX5.00_PSX_1.00')
        .addField(FieldTag.USERNAME, options.username)
        .addField(FieldTag.PASSWORD, options.password);

      if (options.resetOnLogon) {
        builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y');
      }

      const message = builder.buildMessage();
      logger.info(`Sending Logon Message with sequence number ${msgSeqNum - 1}: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      // logger.info(`Sending Logon Message with sequence number ${msgSeqNum - 1}: 8=FIXT.1.19=12735=A34=149=realtime52=20250422-09:36:31.27556=NMDUFISQ000198=0108=30141=Y554=NMDUFISQ00011137=91408=FIX5.00_PSX_1.0010=159`);
      sendMessage(message);
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
   * Send a market data request specifically for UBL symbol
   */
  const sendUblMarketDataRequest = (): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send UBL market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      logger.info(`Creating UBL market data request with ID: ${requestId}`);

      // UBL symbol
      const ublSymbol = 'UBL';

      // Entry types for market data
      const entryTypes = ['0', '1', '2']; // 0 = Bid, 1 = Offer, 2 = Trade

      logger.info(`Requesting market data for UBL with entry types: ${entryTypes.join(', ')}`);

      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID('realtime')
        .setTargetCompID('NMDUFISQ0001')
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh

      // Add PartyID group (required by PSX)
      message
        .addField('453', '1') // NoPartyIDs = 1
        .addField('448', options.partyId || options.senderCompId) // PartyID
        .addField('447', 'D') // PartyIDSource = D (custom)
        .addField('452', '3'); // PartyRole = 3

      // Add UBL symbol
      message.addField(FieldTag.NO_RELATED_SYM, '1');
      message.addField(FieldTag.SYMBOL, ublSymbol);

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      const rawMessage = message.buildMessage();
      logger.info(`UBL market data request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write(rawMessage);
      logger.info(`Sent market data request for UBL`);
      return requestId;
    } catch (error) {
      logger.error('Error sending UBL market data request:', error);
      return null;
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
    sendKseDataRequest,
    sendKseTradingStatusRequest: () => null,
    sendSecurityStatusRequest,
    sendUblMarketDataRequest,
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
  on(event: 'ublMarketDataRequest', listener: () => string | null): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(
    symbols: string[],
    entryTypes?: string[],
    subscriptionType?: string
  ): string | null;
  sendSecurityListRequest(): string | null;
  sendTradingSessionStatusRequest(tradingSessionID?: string): string | null;
  sendKseDataRequest(): string | null;
  sendKseTradingStatusRequest(): string | null;
  sendSecurityStatusRequest(symbol: string): string | null;
  sendUblMarketDataRequest(): string | null;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
}