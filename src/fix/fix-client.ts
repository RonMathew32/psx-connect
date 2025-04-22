import net from 'net';
import { EventEmitter } from 'events';
import { FixMessageBuilder } from './message-builder';
import { FixMessageParser, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import logger from '../utils/logger';

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

export declare interface FixClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'logon', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'logout', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'marketData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
}

export class FixClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private options: FixClientOptions;
  private connected = false;
  private loggedIn = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageSequenceNumber = 1;
  private receivedData = '';
  private lastActivityTime = 0;
  private testRequestCount = 0;
  private lastSentTime = new Date();
  private msgSeqNum = 1;

  constructor(options: FixClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the FIX client and connect to the server
   */
  public start(): void {
    this.connect();
  }

  /**
   * Stop the FIX client and disconnect from the server
   */
  public stop(): void {
    this.disconnect();
  }

  /**
   * Connect to the FIX server and return a promise
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }

      logger.info(`Connecting to PSX at ${this.options.host}:${this.options.port}`);
      
      this.socket = new net.Socket();
      
      // Set up one-time connect handler for the promise
      this.socket.once('connect', () => {
        resolve();
      });
      
      this.socket.once('error', (err) => {
        reject(err);
      });
      
      this.setupSocketHandlers();
      this.socket.connect(this.options.port, this.options.host);
    });
  }

  /**
   * Disconnect from the FIX server
   */
  public disconnect(): void {
    this.clearTimers();
    if (this.connected && this.loggedIn) {
      this.sendLogout();
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.loggedIn = false;
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      logger.info('Socket connected');
      this.connected = true;
      this.emit('connected');
      
      // Log connection details for debugging
      logger.debug(`Connected to ${this.options.host}:${this.options.port}`);
      logger.debug(`Local address: ${this.socket?.localAddress}:${this.socket?.localPort}`);
      
      // Add a small delay before sending logon to ensure socket is fully established
      setTimeout(() => {
        logger.info('Sending logon message...');
        this.sendLogon();
      }, 500);
    });

    this.socket.on('data', (data) => {
      const dataStr = data.toString();
      logger.debug(`Received data: ${dataStr.replace(new RegExp(SOH, 'g'), '|')}`);
      this.handleData(data);
    });

    this.socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      this.emit('error', error);
    });

    this.socket.on('close', (hadError) => {
      logger.info(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
      this.connected = false;
      this.loggedIn = false;
      this.clearTimers();
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.socket.on('timeout', () => {
      logger.warn('Socket timeout - connection inactive');
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
    });

    // Set socket options
    this.socket.setKeepAlive(true, 30000);
    this.socket.setTimeout(60000);
    this.socket.setNoDelay(true);
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    logger.info('Scheduling reconnect in 5 seconds');
    this.reconnectTimer = setTimeout(() => {
      logger.info('Attempting to reconnect');
      this.connect();
    }, 5000);
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Handle incoming data from the socket
   */
  private handleData(data: Buffer): void {
    try {
      this.lastActivityTime = Date.now();
      const dataStr = data.toString();
      
      logger.debug(`Processing received data (${dataStr.length} bytes)`);
      
      // Handle binary SOH characters that might not be visible in logs
      if (dataStr.indexOf(SOH) === -1) {
        logger.warn(`Received data without SOH delimiter: ${dataStr}`);
        // Try to continue processing anyway, replacing any control chars with SOH
        this.receivedData += dataStr.replace(/[\x00-\x1F]/g, SOH);
      } else {
        this.receivedData += dataStr;
      }

      // Process complete messages
      let endIndex;
      while ((endIndex = this.receivedData.indexOf(SOH + '10=')) !== -1) {
        // Find the end of the message (next SOH after the checksum)
        const checksumEndIndex = this.receivedData.indexOf(SOH, endIndex + 1);
        if (checksumEndIndex === -1) {
          logger.debug('Found incomplete message, waiting for more data');
          break;
        }

        // Extract the complete message
        const completeMessage = this.receivedData.substring(0, checksumEndIndex + 1);
        this.receivedData = this.receivedData.substring(checksumEndIndex + 1);

        // Log the complete FIX message for debugging
        logger.debug(`Extracted complete message: ${completeMessage.replace(new RegExp(SOH, 'g'), '|')}`);
        
        // Process the message
        this.processMessage(completeMessage);
      }
      
      // If there's too much unprocessed data, log a warning
      if (this.receivedData.length > 8192) {
        logger.warn(`Large amount of unprocessed data: ${this.receivedData.length} bytes`);
        // Keep only the last 8K to prevent memory issues
        this.receivedData = this.receivedData.substring(this.receivedData.length - 8192);
      }
    } catch (error) {
      logger.error(`Error processing received data: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.error(`Stack trace: ${error.stack}`);
      }
    }
  }

  /**
   * Process a complete FIX message
   */
  private processMessage(message: string): void {
    logger.debug(`Received: ${message.replace(/\x01/g, '|')}`);

    if (!FixMessageParser.verifyChecksum(message)) {
      logger.warn('Invalid checksum in message');
      return;
    }

    const parsedMessage = FixMessageParser.parse(message);
    this.emit('message', parsedMessage);

    if (FixMessageParser.isLogon(parsedMessage)) {
      this.handleLogon(parsedMessage);
    } else if (FixMessageParser.isLogout(parsedMessage)) {
      this.handleLogout(parsedMessage);
    } else if (FixMessageParser.isHeartbeat(parsedMessage)) {
      // Just reset the activity timer
      this.testRequestCount = 0;
    } else if (FixMessageParser.isTestRequest(parsedMessage)) {
      this.handleTestRequest(parsedMessage);
    } else if (FixMessageParser.isMarketDataSnapshot(parsedMessage)) {
      this.handleMarketDataSnapshot(parsedMessage);
    } else if (FixMessageParser.isMarketDataIncremental(parsedMessage)) {
      this.handleMarketDataIncremental(parsedMessage);
    } else if (FixMessageParser.isSecurityList(parsedMessage)) {
      this.handleSecurityList(parsedMessage);
    } else if (FixMessageParser.isTradingSessionStatus(parsedMessage)) {
      this.handleTradingSessionStatus(parsedMessage);
    } else if (FixMessageParser.isReject(parsedMessage)) {
      this.handleReject(parsedMessage);
    }
  }

  /**
   * Send a message via the socket
   */
  private sendMessage(message: string): void {
    if (!this.socket || !this.connected) {
      logger.warn('Cannot send message: not connected');
      return;
    }

    try {
      // Similar to the Go implementation's ToApp function - add the PSX specific fields
      if (!message.includes('35=A') && !message.includes('35=5')) {
        // Not a logon or logout message - add the PSX specific fields
        // This is similar to the Go code in ToApp method
        // Replace the message with one containing the PSX specific fields
        const msgParts = message.split(SOH);
        let modifiedMessage = '';
        
        // Find position to insert DEFAULT_APPL_VER_ID and DEFAULT_CSTM_APPL_VER_ID
        for (let i = 0; i < msgParts.length; i++) {
          modifiedMessage += msgParts[i] + SOH;
          
          // After MsgType, add the PSX specific fields
          if (msgParts[i].startsWith('35=')) {
            modifiedMessage += `1137=9${SOH}`; // DEFAULT_APPL_VER_ID
            modifiedMessage += `1129=FIX5.00_PSX_1.00${SOH}`; // DEFAULT_CSTM_APPL_VER_ID
            modifiedMessage += `115=600${SOH}`; // ON_BEHALF_OF_COMP_ID
            modifiedMessage += `96=kse${SOH}`; // RAW_DATA
            modifiedMessage += `95=3${SOH}`; // RAW_DATA_LENGTH
          }
        }
        
        message = modifiedMessage;
      }
      
      logger.debug(`Sending: ${message.replace(/\x01/g, '|')}`);
      this.socket.write(message);
      this.lastActivityTime = Date.now();
    } catch (error) {
      logger.error(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle a logon message response
   */
  private handleLogon(message: ParsedFixMessage): void {
    logger.info('Logon successful');
    this.loggedIn = true;
    this.startHeartbeatMonitoring();
    this.emit('logon', message);
  }

  /**
   * Handle a logout message
   */
  private handleLogout(message: ParsedFixMessage): void {
    logger.info('Logout received');
    this.loggedIn = false;
    this.clearTimers();
    this.emit('logout', message);
    
    // Close the socket
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Handle a test request
   */
  private handleTestRequest(message: ParsedFixMessage): void {
    const testReqId = FixMessageParser.getTestReqID(message);
    if (testReqId) {
      const heartbeat = FixMessageBuilder.createHeartbeatMessage(
        this.options.senderCompId,
        this.options.targetCompId,
        testReqId
      );
      this.sendMessage(heartbeat);
    }
  }

  /**
   * Handle a reject message
   */
  private handleReject(message: ParsedFixMessage): void {
    const text = FixMessageParser.getRejectText(message);
    logger.error(`Received reject: ${text}`);
  }

  /**
   * Handle a market data snapshot
   */
  private handleMarketDataSnapshot(message: ParsedFixMessage): void {
    try {
      const mdReqId = FixMessageParser.getMDReqID(message);
      const noMDEntries = parseInt(message['268'] || '0', 10); // NoMDEntries
      const items: MarketDataItem[] = [];

      for (let i = 1; i <= noMDEntries; i++) {
        const entryType = message[`269.${i}`]; // MDEntryType
        const symbol = message[`55.${i}`] || message['55']; // Symbol
        if (!entryType || !symbol) continue;

        const item: MarketDataItem = {
          symbol,
          entryType,
          price: parseFloat(message[`270.${i}`] || '0'), // MDEntryPx
          size: parseFloat(message[`271.${i}`] || '0'), // MDEntrySize
          entryId: message[`278.${i}`], // MDEntryID
          timestamp: message[`273.${i}`] // MDEntryTime
        };

        items.push(item);
      }

      if (items.length > 0) {
        logger.info(`Received market data snapshot for request ${mdReqId} with ${items.length} entries`);
        this.emit('marketData', items);
      }
    } catch (error) {
      logger.error(`Error processing market data snapshot: ${error}`);
    }
  }

  /**
   * Handle market data incremental updates
   */
  private handleMarketDataIncremental(message: ParsedFixMessage): void {
    try {
      const mdReqId = FixMessageParser.getMDReqID(message);
      const noMDEntries = parseInt(message['268'] || '0', 10); // NoMDEntries
      const items: MarketDataItem[] = [];

      for (let i = 1; i <= noMDEntries; i++) {
        const entryType = message[`269.${i}`]; // MDEntryType
        const symbol = message[`55.${i}`] || message['55']; // Symbol
        if (!entryType || !symbol) continue;

        const item: MarketDataItem = {
          symbol,
          entryType,
          price: parseFloat(message[`270.${i}`] || '0'), // MDEntryPx
          size: parseFloat(message[`271.${i}`] || '0'), // MDEntrySize
          entryId: message[`278.${i}`], // MDEntryID
          timestamp: message[`273.${i}`] // MDEntryTime
        };

        items.push(item);
      }

      if (items.length > 0) {
        logger.info(`Received market data update for request ${mdReqId} with ${items.length} entries`);
        this.emit('marketData', items);
      }
    } catch (error) {
      logger.error(`Error processing market data incremental update: ${error}`);
    }
  }

  /**
   * Handle security list response
   */
  private handleSecurityList(message: ParsedFixMessage): void {
    try {
      const noRelatedSym = parseInt(message['146'] || '0', 10); // NoRelatedSym
      const securities: SecurityInfo[] = [];

      for (let i = 1; i <= noRelatedSym; i++) {
        const symbol = message[`55.${i}`]; // Symbol
        const securityType = message[`167.${i}`] || message['167']; // SecurityType
        if (!symbol) continue;

        const security: SecurityInfo = {
          symbol,
          securityType: securityType || '',
          securityDesc: message[`107.${i}`], // SecurityDesc
          isin: message[`48.${i}`], // SecurityID (ISIN)
          currency: message[`15.${i}`] // Currency
        };

        securities.push(security);
      }

      if (securities.length > 0) {
        logger.info(`Received security list with ${securities.length} securities`);
        this.emit('securityList', securities);
      }
    } catch (error) {
      logger.error(`Error processing security list: ${error}`);
    }
  }

  /**
   * Handle trading session status
   */
  private handleTradingSessionStatus(message: ParsedFixMessage): void {
    try {
      const sessionId = message['336']; // TradingSessionID
      const status = message['340']; // TradSesStatus
      if (!sessionId || !status) return;

      const sessionInfo: TradingSessionInfo = {
        sessionId,
        status,
        startTime: message['341'], // TradSesStartTime
        endTime: message['342'] // TradSesEndTime
      };

      logger.info(`Received trading session status: ${status} for session ${sessionId}`);
      this.emit('tradingSessionStatus', sessionInfo);
    } catch (error) {
      logger.error(`Error processing trading session status: ${error}`);
    }
  }

  /**
   * Send a logon message
   */
  public sendLogon(): void {
    // Create a raw FIX message string directly to match the Go implementation
    const now = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').substring(0, 17);
    
    // Build the message body first - add 34=1 (MsgSeqNum) and 52=<time> (SendingTime)
    const bodyFields = [
      `35=A${SOH}`, // MsgType (Logon)
      `34=1${SOH}`, // MsgSeqNum - adding this explicitly
      `49=${this.options.senderCompId}${SOH}`, // SenderCompID
      `56=${this.options.targetCompId}${SOH}`, // TargetCompID
      `52=${now}${SOH}`, // SendingTime - adding this explicitly
      `98=0${SOH}`, // EncryptMethod
      `108=${this.options.heartbeatIntervalSecs}${SOH}`, // HeartBtInt
      `141=Y${SOH}`, // ResetSeqNumFlag
      `553=${this.options.username}${SOH}`, // Username
      `554=${this.options.password}${SOH}`, // Password - use from options
      `1137=9${SOH}`, // DefaultApplVerID
      `1129=FIX5.00_PSX_1.00${SOH}`, // DefaultCstmApplVerID - explicitly add this
      `115=600${SOH}`, // OnBehalfOfCompID
      `96=kse${SOH}`, // RawData
      `95=3${SOH}` // RawDataLength
    ].join('');
    
    // Calculate body length (excluding SOH characters)
    const bodyLength = bodyFields.replace(new RegExp(SOH, 'g'), '').length;
    
    // Construct the complete message with header
    const message = [
      `8=FIXT.1.1${SOH}`, // BeginString
      `9=${bodyLength}${SOH}`, // BodyLength
      bodyFields
    ].join('');
    
    // Calculate checksum - sum of ASCII values of all characters modulo 256
    let sum = 0;
    for (let i = 0; i < message.length; i++) {
      sum += message.charCodeAt(i);
    }
    const checksum = (sum % 256).toString().padStart(3, '0');
    
    // Add the checksum
    const finalMessage = message + `10=${checksum}${SOH}`;
    
    logger.info("Sending logon message with exact PSX format");
    logger.debug(`Logon message: ${finalMessage.replace(new RegExp(SOH, 'g'), '|')}`);
    
    if (!this.socket || !this.connected) {
      logger.warn('Cannot send logon: not connected');
      return;
    }

    try {
      this.socket.write(finalMessage);
      this.lastActivityTime = Date.now();
    } catch (error) {
      logger.error(`Failed to send logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Send a logout message
   */
  public sendLogout(text?: string): void {
    const logoutMessage = FixMessageBuilder.createLogoutMessage(
      this.options.senderCompId,
      this.options.targetCompId,
      text
    );
    this.sendMessage(logoutMessage);
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeatMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    const heartbeatInterval = this.options.heartbeatIntervalSecs * 1000;
    this.heartbeatTimer = setInterval(() => {
      const currentTime = Date.now();
      const timeSinceLastActivity = currentTime - this.lastActivityTime;

      // If no activity for more than heartbeat interval, send a heartbeat
      if (timeSinceLastActivity >= heartbeatInterval) {
        // If no response to multiple test requests, consider connection dead
        if (this.testRequestCount >= 2) {
          logger.warn('No response to test requests, connection may be dead');
          if (this.socket) {
            this.socket.destroy();
            this.socket = null;
          }
          return;
        }

        // After 1.5 intervals without activity, send a test request instead of heartbeat
        if (timeSinceLastActivity >= heartbeatInterval * 1.5) {
          logger.debug('Sending test request');
          const testRequest = FixMessageBuilder.createTestRequestMessage(
            this.options.senderCompId,
            this.options.targetCompId
          );
          this.sendMessage(testRequest);
          this.testRequestCount++;
        } else {
          logger.debug('Sending heartbeat');
          const heartbeat = FixMessageBuilder.createHeartbeatMessage(
            this.options.senderCompId,
            this.options.targetCompId
          );
          this.sendMessage(heartbeat);
        }
      }
    }, Math.min(heartbeatInterval / 2, 10000)); // Check at half the heartbeat interval or 10 seconds, whichever is less
  }

  /**
   * Send a market data request
   */
  public sendMarketDataRequest(
    symbols: string[],
    entryTypes: string[],
    subscriptionType: string,
    marketDepth: number = 0
  ): void {
    if (!this.loggedIn) {
      logger.warn('Cannot send market data request: not logged in');
      return;
    }

    const message = FixMessageBuilder.createMarketDataRequest(
      this.options.senderCompId,
      this.options.targetCompId,
      symbols,
      entryTypes,
      subscriptionType,
      marketDepth
    );
    this.sendMessage(message);
    logger.info(`Sent market data request for symbols: ${symbols.join(', ')}`);
  }

  /**
   * Send a security list request
   */
  public sendSecurityListRequest(securityType?: string): void {
    if (!this.loggedIn) {
      logger.warn('Cannot send security list request: not logged in');
      return;
    }

    const message = FixMessageBuilder.createSecurityListRequest(
      this.options.senderCompId,
      this.options.targetCompId,
      securityType
    );
    this.sendMessage(message);
    logger.info('Sent security list request');
  }

  /**
   * Send a trading session status request
   */
  public sendTradingSessionStatusRequest(tradingSessionId?: string): void {
    if (!this.loggedIn) {
      logger.warn('Cannot send trading session status request: not logged in');
      return;
    }

    const message = FixMessageBuilder.createTradingSessionStatusRequest(
      this.options.senderCompId,
      this.options.targetCompId,
      tradingSessionId
    );
    this.sendMessage(message);
    logger.info('Sent trading session status request');
  }

  private formatMessageForLogging(message: string): string {
    // Implement the logic to format the message for logging
    return message;
  }
} 