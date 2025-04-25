import net from 'net';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag, SubscriptionRequestType, SecurityListRequestType } from './constants';
import logger from '../utils/logger';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';

export interface FixClientOptions {
  host: string;
  port: number;
  senderCompId: string;
  targetCompId: string;
  username: string;
  password: string;
  heartbeatIntervalSecs: number;
  resetOnLogon?: boolean;
  resetOnLogout?: boolean;
  resetOnDisconnect?: boolean;
  validateFieldsOutOfOrder?: boolean;
  checkFieldsOutOfOrder?: boolean;
  rejectInvalidMessage?: boolean;
  forceResync?: boolean;
  fileLogPath?: string;
  fileStorePath?: string;
  connectTimeoutMs?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  onBehalfOfCompId?: string;
  rawDataLength?: number;
  rawData?: string;
}

export interface MarketDataItem {
  symbol: string;
  entryType: string;
  price?: number;
  size?: number;
  entryId?: string;
  timestamp?: string;
}

export interface SecurityInfo {
  symbol: string;
  securityType: string;
  securityDesc?: string;
  currency?: string;
  isin?: string;
}

export interface TradingSessionInfo {
  sessionId: string;
  status: string;
  startTime?: string;
  endTime?: string;
}

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
      logger.info(`Received FIX message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      
      const parsedMessage = parseFixMessage(message);
      
      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }
      
      // Emit the raw message
      emitter.emit('message', parsedMessage);
      
      // Process specific message types
      const messageType = parsedMessage[FieldTag.MSG_TYPE];
      
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
          handleMarketDataSnapshot(parsedMessage);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          handleMarketDataIncremental(parsedMessage);
          break;
        case MessageType.SECURITY_LIST:
          handleSecurityList(parsedMessage);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          handleTradingSessionStatus(parsedMessage);
          break;
        // Add more message type handlers as needed
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      
      if (marketDataItems.length > 0) {
        logger.info(`Extracted ${marketDataItems.length} market data items for ${symbol}`);
        
        // Check if this is KSE data
        const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');
        
        if (isKseData) {
          logger.info(`Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
          emitter.emit('kseData', marketDataItems);
        }
        
        // Also emit general market data event
        emitter.emit('marketData', marketDataItems);
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
      logger.debug(`Sending FIX message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);

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
    
    // Reset sequence numbers if requested
    if (options.resetOnLogon) {
      msgSeqNum = 1;
    }
    
    // Start heartbeat monitoring
    startHeartbeatMonitoring();
    
    // Automatically request KSE data upon successful logon
    sendKseDataRequest();
    
    // Emit logon event
    emitter.emit('logon', message);
    
    logger.info('Successfully logged in to FIX server');
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
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType) // Subscription type
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh

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
      socket.write(rawMessage);
      logger.info(`Sent market data request for symbols: ${symbols.join(', ')}`);
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
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh

      // Add KSE index or key symbols
      const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];
      message.addField(FieldTag.NO_RELATED_SYM, kseSymbols.length.toString());
      for (const symbol of kseSymbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types - for indices we typically want the index value
      const entryTypes = ['3']; // 3 = Index Value
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      // Add custom KSE identifier field if needed
      if (options.rawData === 'kse') {
        message.addField(FieldTag.RAW_DATA_LENGTH, options.rawDataLength?.toString() || '3');
        message.addField(FieldTag.RAW_DATA, 'kse');
      }

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
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
    if (!connected) {
      logger.warn('Cannot send logon, not connected');
      return;
    }
    
    try {
      const builder = createMessageBuilder();
      
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++);
      
      // Standard FIX Logon fields
      builder
        .addField(FieldTag.ENCRYPT_METHOD, '0')             // EncryptMethod
        .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString()) // HeartBtInt
        .addField(FieldTag.RESET_SEQ_NUM_FLAG, options.resetOnLogon ? 'Y' : 'N')  // ResetSeqNumFlag
        .addField(FieldTag.PASSWORD, options.password || '') // Password (554)
        .addField(FieldTag.DEFAULT_APPL_VER_ID, '9')        // DefaultApplVerID (1137)
        .addField('1408', 'FIX5.00_PSX_1.00');               // ApplVerID custom field
      
      const message = builder.buildMessage();
      // Log in a more readable format with pipes instead of SOH
      logger.info(`Sending Logon Message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
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
   * Format a FIX message for logging (preserve SOH instead of using pipe)
   */
  const formatMessageForLogging = (message: string): string => {
    return message;
  };

  // Return the public API
  return {
    on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
    connect,
    disconnect,
    sendMarketDataRequest,
    sendSecurityListRequest,
    sendTradingSessionStatusRequest,
    sendKseDataRequest,
    sendLogon,
    sendLogout,
    start,
    stop
  };
}

// Type definition for the returned FixClient API
export interface FixClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'logon', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'logout', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'marketData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
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
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
}