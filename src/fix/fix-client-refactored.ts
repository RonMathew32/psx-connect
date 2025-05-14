import net from 'net';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { SOH, MessageType, FieldTag } from './constants';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import SequenceManager, { SequenceStream } from './sequence-manager';
import SessionManager, { SessionState } from './session-manager';
import MarketDataHandler from './market-data-handler';
import SecurityListHandler, { SecurityListType } from './security-list-handler';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';

/**
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions) {
  // Core components
  const emitter = new EventEmitter();
  let socket: net.Socket | null = null;
  
  // Create managers
  const sequenceManager = new SequenceManager();
  const sessionManager = new SessionManager({
    heartbeatIntervalSecs: options.heartbeatIntervalSecs,
    reconnectDelayMs: options.connectTimeoutMs || 5000
  });
  
  // Initialize socket-dependent handlers later
  let marketDataHandler: MarketDataHandler | null = null;
  let securityListHandler: SecurityListHandler | null = null;
  
  // Socket write function to be passed to handlers
  const socketWrite = (data: string): void => {
    if (!socket || !sessionManager.isConnected()) {
      logger.warn('Cannot send message, not connected');
      return;
    }
    
    try {
      socket.write(data);
      logger.debug(`Sent message: ${data.replace(new RegExp(SOH, 'g'), '|')}`);
      emitter.emit('messageSent', data);
    } catch (error) {
      logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
      
      if (socket) {
        socket.destroy();
        socket = null;
      }
      
      sessionManager.disconnected();
    }
  };
  
  /**
   * Initialize the specialized handlers once we have a socket connection
   */
  const initializeHandlers = (): void => {
    // Create market data handler
    marketDataHandler = new MarketDataHandler({
      senderCompId: options.senderCompId,
      targetCompId: options.targetCompId,
      onRequestSent: (requestId, symbols) => {
        logger.info(`Market data request sent: ${requestId} for ${symbols.join(', ')}`);
      },
      onDataReceived: (data) => {
        emitter.emit('marketData', data);
        
        // Check for KSE data
        if (data.length > 0 && data[0].symbol && data[0].symbol.includes('KSE')) {
          emitter.emit('kseData', data);
        }
      }
    }, sequenceManager, socketWrite);
    
    // Create security list handler
    securityListHandler = new SecurityListHandler({
      senderCompId: options.senderCompId,
      targetCompId: options.targetCompId,
      onRequestSent: (requestId, type) => {
        logger.info(`Security list request sent: ${requestId} for ${type}`);
      },
      onDataReceived: (securities, type) => {
        logger.info(`Received ${securities.length} ${type} securities`);
        emitter.emit('securityList', securities);
      }
    }, sequenceManager, socketWrite);
  };
  
  /**
   * Connect to the FIX server
   */
  const connect = async (): Promise<void> => {
    if (socket || sessionManager.isState(SessionState.CONNECTING)) {
      logger.warn('Connection already in progress or established');
      return;
    }
    
    try {
      sessionManager.connecting();
      
      // Create socket with specific configuration
      socket = new net.Socket();
      
      // Apply socket settings
      socket.setKeepAlive(true);
      socket.setNoDelay(true);
      
      // Set connection timeout 
      socket.setTimeout(options.connectTimeoutMs || 30000);
      
      // Setup event handlers
      socket.on('timeout', () => {
        logger.error('Connection timed out');
        socket?.destroy();
        sessionManager.disconnected();
        emitter.emit('error', new Error('Connection timed out'));
      });
      
      socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        sessionManager.error(error.message);
        emitter.emit('error', error);
      });
      
      socket.on('close', () => {
        logger.info('Socket disconnected');
        sessionManager.disconnected();
        emitter.emit('disconnected');
        
        // Schedule reconnect if appropriate
        if (!sessionManager.isState(SessionState.ERROR)) {
          sessionManager.scheduleReconnect();
        }
      });
      
      // Handle received data
      socket.on('data', (data) => {
        handleData(data);
      });
      
      socket.on('connect', () => {
        logger.info(`Connected to ${options.host}:${options.port}`);
        sessionManager.connected();
        
        // Initialize handlers now that we have a socket
        initializeHandlers();
        
        // Send logon message after a short delay
        setTimeout(() => {
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
      sessionManager.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };
  
  /**
   * Disconnect from the FIX server
   */
  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      // If logged in, send logout message first
      if (sessionManager.isLoggedIn()) {
        sessionManager.loggingOut();
        sendLogout();
      }
      
      // Clean up and close socket
      if (socket) {
        socket.destroy();
        socket = null;
      }
      
      sessionManager.disconnected();
      
      // Cancel any active market data requests
      if (marketDataHandler && marketDataHandler.hasActiveRequests()) {
        marketDataHandler.cancelAllRequests();
      }
      
      resolve();
    });
  };
  
  /**
   * Handle incoming data from the socket
   */
  const handleData = (data: Buffer): void => {
    try {
      // Record activity for heartbeat monitoring
      sessionManager.recordActivity();
      
      const dataStr = data.toString();
      logger.debug(`Received data: ${dataStr.length} bytes`);
      
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
      // Parse the message
      const parsedMessage = parseFixMessage(message);
      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }
      
      // Log the raw message
      logger.info(`Received FIX message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      
      // Get message type
      const messageType = parsedMessage[FieldTag.MSG_TYPE];
      
      // Track sequence numbers if available
      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        const seqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
        sequenceManager.updateIncomingSeqNum(seqNum);
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
          // Just log - heartbeat is handled automatically by SessionManager
          logger.debug('Received heartbeat');
          break;
          
        case MessageType.TEST_REQUEST:
          // Respond with heartbeat
          sendHeartbeat(parsedMessage[FieldTag.TEST_REQ_ID]);
          break;
          
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          if (marketDataHandler) {
            marketDataHandler.handleMarketDataSnapshot(parsedMessage);
          }
          break;
          
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          if (marketDataHandler) {
            marketDataHandler.handleMarketDataIncremental(parsedMessage);
          }
          break;
          
        case MessageType.SECURITY_LIST:
          if (securityListHandler) {
            securityListHandler.handleSecurityListResponse(parsedMessage);
          }
          break;
          
        case MessageType.TRADING_SESSION_STATUS:
          handleTradingSessionStatus(parsedMessage);
          break;
          
        case MessageType.REJECT:
          handleReject(parsedMessage);
          break;
          
        case 'Y': // Market Data Request Reject
          if (marketDataHandler) {
            marketDataHandler.handleMarketDataReject(parsedMessage);
          }
          break;
          
        default:
          logger.info(`Received unhandled message type: ${messageType}`);
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Handle a logon message from the server
   */
  const handleLogon = (message: ParsedFixMessage): void => {
    // Update session state
    sessionManager.loggedIn();
    
    // Reset sequence numbers if needed
    if (message[FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
      sequenceManager.resetAll(2); // Start with 2 after logon acknowledgment with reset flag
      logger.info('Reset sequence flag is Y, resetting all sequence numbers');
    }
    
    // Emit event so client can handle login success
    emitter.emit('logon', message);
    
    logger.info('Successfully logged in to FIX server');
  };
  
  /**
   * Handle a logout message from the server
   */
  const handleLogout = (message: ParsedFixMessage): void => {
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
          
          // Reset sequence numbers and reconnect
          sequenceManager.resetAll(expectedSeqNum);
          sessionManager.sequenceReset();
          
          // Reconnect with corrected sequence numbers
          if (socket) {
            socket.destroy();
            socket = null;
          }
          
          setTimeout(() => {
            connect();
          }, 2000);
          
          return;
        }
      }
    }
    
    // For normal logouts, update state and emit event
    logger.info('Logged out from FIX server');
    sessionManager.disconnected();
    emitter.emit('logout', message);
  };
  
  /**
   * Handle a reject message from the server
   */
  const handleReject = (message: ParsedFixMessage): void => {
    const refSeqNum = message[FieldTag.REF_SEQ_NUM];
    const refTagId = message[FieldTag.REF_TAG_ID];
    const text = message[FieldTag.TEXT];
    
    logger.error(`Received REJECT message for sequence number ${refSeqNum}`);
    logger.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);
    
    // Check if this is a sequence number issue
    if (refTagId === '34' || text?.includes('MsgSeqNum')) {
      logger.info('Sequence number mismatch detected, handling sequence reset...');
      
      // Try to parse the expected sequence number
      const expectedSeqNumMatch = text?.match(/expected ['"]?(\d+)['"]?/);
      if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
        const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
        if (!isNaN(expectedSeqNum)) {
          logger.info(`Server expects sequence number: ${expectedSeqNum}`);
          sequenceManager.resetAll(expectedSeqNum);
          
          // Send a heartbeat with the correct sequence number to sync
          sendHeartbeat('');
        }
      }
    }
    
    // Emit reject event
    emitter.emit('reject', { refSeqNum, refTagId, text });
  };
  
  /**
   * Handle a trading session status message
   */
  const handleTradingSessionStatus = (message: ParsedFixMessage): void => {
    try {
      // Extract standard fields
      const sessionId = message[FieldTag.TRADING_SESSION_ID] || 'REG';
      const status = message[FieldTag.TRAD_SES_STATUS] || '2'; // Default to Open
      const startTime = message[FieldTag.START_TIME];
      const endTime = message[FieldTag.END_TIME];
      
      // Construct session info
      const sessionInfo: TradingSessionInfo = {
        sessionId,
        status,
        startTime,
        endTime
      };
      
      logger.info(`Received trading session status: ${sessionId}, status: ${status}`);
      emitter.emit('tradingSessionStatus', sessionInfo);
    } catch (error) {
      logger.error(`Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Send a heartbeat message
   */
  const sendHeartbeat = (testReqId?: string): void => {
    if (!sessionManager.isConnected()) return;
    
    try {
      const builder = createMessageBuilder();
      
      builder
        .setMsgType(MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
      
      if (testReqId) {
        builder.addField(FieldTag.TEST_REQ_ID, testReqId);
      }
      
      const message = builder.buildMessage();
      socketWrite(message);
      sequenceManager.incrementOutgoingSeqNum();
    } catch (error) {
      logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Send a logon message to the server
   */
  const sendLogon = (): void => {
    if (!sessionManager.isConnected()) {
      logger.warn('Cannot send logon, not connected');
      return;
    }
    
    try {
      // Reset sequence numbers for a new logon
      sequenceManager.resetAll(1);
      
      // Create logon message
      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
      
      // Add required fields
      builder.addField(FieldTag.ENCRYPT_METHOD, '0');
      builder.addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
      builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
      builder.addField(FieldTag.USERNAME, options.username);
      builder.addField(FieldTag.PASSWORD, options.password);
      builder.addField(FieldTag.DEFAULT_APPL_VER_ID, '9');
      builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID
      
      const message = builder.buildMessage();
      socketWrite(message);
      
      // Increment sequence number for next message
      sequenceManager.incrementOutgoingSeqNum();
    } catch (error) {
      logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
      sessionManager.error(`Logon failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Send a logout message to the server
   */
  const sendLogout = (text?: string): void => {
    if (!sessionManager.isConnected()) {
      logger.warn('Cannot send logout, not connected');
      return;
    }
    
    try {
      const builder = createMessageBuilder();
      
      builder
        .setMsgType(MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
      
      if (text) {
        builder.addField(FieldTag.TEXT, text);
      }
      
      const message = builder.buildMessage();
      socketWrite(message);
      sequenceManager.incrementOutgoingSeqNum();
    } catch (error) {
      logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    disconnect();
  };
  
  /**
   * Send a market data request for specified symbols
   */
  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ['0', '1'], // 0 = Bid, 1 = Offer
    subscriptionType: string = '1'     // 1 = Snapshot + Updates
  ): string | null => {
    if (!marketDataHandler || !sessionManager.isLoggedIn()) {
      logger.error('Cannot send market data request: not connected or not logged in');
      return null;
    }
    
    return marketDataHandler.requestMarketData(symbols, entryTypes, subscriptionType);
  };
  
  /**
   * Send a market data request for index symbols
   */
  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    if (!marketDataHandler || !sessionManager.isLoggedIn()) {
      logger.error('Cannot send index market data request: not connected or not logged in');
      return null;
    }
    
    return marketDataHandler.requestIndexValues(symbols);
  };
  
  /**
   * Send a security list request
   */
  const sendSecurityListRequest = (): string | null => {
    if (!securityListHandler || !sessionManager.isLoggedIn()) {
      logger.error('Cannot send security list request: not connected or not logged in');
      return null;
    }
    
    securityListHandler.requestAllSecurities();
    return 'security-list-request';
  };
  
  /**
   * Send a security list request for equities
   */
  const sendSecurityListRequestForEquity = (): string | null => {
    if (!securityListHandler || !sessionManager.isLoggedIn()) {
      logger.error('Cannot send equity security list request: not connected or not logged in');
      return null;
    }
    
    return securityListHandler.requestEquitySecurities();
  };
  
  /**
   * Send a security list request for indices
   */
  const sendSecurityListRequestForIndex = (): string | null => {
    if (!securityListHandler || !sessionManager.isLoggedIn()) {
      logger.error('Cannot send index security list request: not connected or not logged in');
      return null;
    }
    
    return securityListHandler.requestIndexSecurities();
  };
  
  /**
   * Send a trading session status request
   */
  const sendTradingSessionStatusRequest = (): string | null => {
    if (!sessionManager.isLoggedIn()) {
      logger.error('Cannot send trading session status request: not connected or not logged in');
      return null;
    }
    
    try {
      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum())
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
      
      const rawMessage = message.buildMessage();
      socketWrite(rawMessage);
      sequenceManager.incrementOutgoingSeqNum();
      
      logger.info(`Sent trading session status request (ID: ${requestId})`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending trading session status request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  
  /**
   * Send a market data subscription for specific symbols
   */
  const sendSymbolMarketDataSubscription = (symbols: string[]): string | null => {
    return sendMarketDataRequest(symbols, ['0', '1', '2'], '1'); // Bid, Offer, Trade with subscription
  };
  
  /**
   * Send a security status request for a symbol
   */
  const sendSecurityStatusRequest = (symbol: string): string | null => {
    if (!sessionManager.isLoggedIn()) {
      logger.error('Cannot send security status request: not connected or not logged in');
      return null;
    }
    
    try {
      const requestId = uuidv4();
      
      const message = createMessageBuilder()
        .setMsgType('e') // Security Status Request
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum())
        .addField(FieldTag.SECURITY_STATUS_REQ_ID, requestId)
        .addField(FieldTag.SYMBOL, symbol)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .buildMessage();
      
      socketWrite(message);
      sequenceManager.incrementOutgoingSeqNum();
      
      logger.info(`Sent security status request for: ${symbol}`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending security status request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  
  /**
   * Reset client state and reconnect
   */
  const reset = () => {
    logger.info('Performing complete reset with disconnection and reconnection');
    
    // Disconnect completely
    if (socket) {
      socket.destroy();
      socket = null;
    }
    
    // Reset managers
    sessionManager.disconnected();
    sequenceManager.resetAll(1);
    
    // Cancel any active market data requests
    if (marketDataHandler && marketDataHandler.hasActiveRequests()) {
      marketDataHandler.cancelAllRequests();
    }
    
    // Wait a moment and reconnect
    setTimeout(() => {
      logger.info('Reconnecting after reset');
      connect();
    }, 3000);
    
    return client;
  };
  
  // Set up session manager event handlers
  sessionManager.on('reconnect', () => {
    logger.info('Attempting to reconnect...');
    connect();
  });
  
  sessionManager.on('testRequest', () => {
    sendHeartbeat('TEST' + Date.now());
  });
  
  sessionManager.on('heartbeat', () => {
    sendHeartbeat();
  });
  
  sessionManager.on('connectionLost', () => {
    logger.error('Connection lost due to heartbeat timeout');
    if (socket) {
      socket.destroy();
      socket = null;
    }
    sessionManager.disconnected();
  });
  
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
      sequenceManager.resetAll(newSeq);
      return client;
    },
    reset,
    requestSecurityList: () => {
      if (securityListHandler && sessionManager.isLoggedIn()) {
        logger.info('Requesting comprehensive security list');
        securityListHandler.requestAllSecurities();
      } else {
        logger.error('Cannot request security list: not connected or logged in');
      }
      return client;
    },
    getStatus: () => ({
      isConnected: sessionManager.isConnected(),
      isLoggedIn: sessionManager.isLoggedIn(),
      sessionState: sessionManager.getState(),
      sequenceState: sequenceManager.getState(),
      hasActiveMarketDataRequests: marketDataHandler?.hasActiveRequests() || false
    })
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
  on(event: 'marketData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'messageSent', listener: (data: string) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'reject', listener: (reject: { refSeqNum: string; refTagId: string; text: string | undefined }) => void): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(
    symbols: string[],
    entryTypes?: string[],
    subscriptionType?: string
  ): string | null;
  sendSecurityListRequest(): string | null;
  sendTradingSessionStatusRequest(): string | null;
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
  reset(): this;
  requestSecurityList(): this;
  getStatus(): {
    isConnected: boolean;
    isLoggedIn: boolean;
    sessionState: string;
    sequenceState: any;
    hasActiveMarketDataRequests: boolean;
  };
} 