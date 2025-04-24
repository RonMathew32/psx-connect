import net from 'net';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import logger from '../utils/logger';
import { Socket } from 'net';
import * as vpnUtils from '../utils/vpn-check';

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

    // Check VPN connection first
    const isVpnActive = await vpnUtils.ensureVpnConnection();
    
    if (!isVpnActive) {
      logger.error("Cannot connect: VPN is not active");
      emitter.emit('error', new Error('VPN connection required'));
      return;
    }
    
    logger.info("VPN connection confirmed, connecting to PSX...");
    logger.info(`Connecting to ${options.host}:${options.port}`);
    
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
      
      // On connect, send logon immediately after VPN check
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
        // Add more message type handlers as needed
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
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
      // Format for logging
      const logMessage = formatMessageForLogging(message);
      logger.debug(`Sending: ${logMessage}`);
      
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
    entryTypes: string[],
    subscriptionType: string,
    marketDepth: number = 0
  ): void => {
    if (!connected || !loggedIn) {
      logger.warn('Cannot send market data request, not logged in');
      return;
    }
    
    try {
      // Implement market data request logic here
      // This would be similar to the original class implementation
      // but using the functional style
      
      // For example:
      const builder = createMessageBuilder();
      // Build market data request
      
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending market data request: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a security list request
   */
  const sendSecurityListRequest = (securityType?: string): void => {
    if (!connected || !loggedIn) {
      logger.warn('Cannot send security list request, not logged in');
      return;
    }
    
    try {
      // Implement security list request logic here
      // This would be similar to the original class implementation
      
      // For example:
      const builder = createMessageBuilder();
      // Build security list request
      
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending security list request: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a trading session status request
   */
  const sendTradingSessionStatusRequest = (tradingSessionId?: string): void => {
    if (!connected || !loggedIn) {
      logger.warn('Cannot send trading session status request, not logged in');
      return;
    }
    
    try {
      // Implement trading session status request logic here
      // This would be similar to the original class implementation
      
      // For example:
      const builder = createMessageBuilder();
      // Build trading session status request
      
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending trading session status request: ${error instanceof Error ? error.message : String(error)}`);
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
      
      // PSX-specific authentication and session fields
      builder
        .addField(FieldTag.ON_BEHALF_OF_COMP_ID, options.onBehalfOfCompId || '')
        .addField(FieldTag.RAW_DATA_LENGTH, String(options.rawDataLength || ''))
        .addField(FieldTag.RAW_DATA, options.rawData || '')
        .addField(FieldTag.ENCRYPT_METHOD, '0')
        .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
        .addField(FieldTag.RESET_SEQ_NUM_FLAG, options.resetOnLogon ? 'Y' : 'N');
      
      const message = builder.buildMessage();
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
   * Format a FIX message for logging (replace SOH with |)
   */
  const formatMessageForLogging = (message: string): string => {
    return message.replace(new RegExp(SOH, 'g'), '|');
  };

  // Return the public API
  return {
    on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
    connect,
    disconnect,
    sendMarketDataRequest,
    sendSecurityListRequest,
    sendTradingSessionStatusRequest,
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
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(symbols: string[], entryTypes: string[], subscriptionType: string, marketDepth?: number): void;
  sendSecurityListRequest(securityType?: string): void;
  sendTradingSessionStatusRequest(tradingSessionId?: string): void;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
}