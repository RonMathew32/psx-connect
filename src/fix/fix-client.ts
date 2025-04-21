import net from 'net';
import { EventEmitter } from 'events';
import { FixMessageBuilder } from './message-builder';
import { FixMessageParser, ParsedFixMessage } from './message-parser';
import { SOH, MessageType } from './constants';
import logger from '../utils/logger';

export interface FixClientOptions {
  host: string;
  port: number;
  senderCompId: string;
  targetCompId: string;
  username: string;
  password: string;
  heartbeatIntervalSecs: number;
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
   * Connect to the FIX server
   */
  private connect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    logger.info(`Connecting to PSX at ${this.options.host}:${this.options.port}`);
    
    this.socket = new net.Socket();
    this.setupSocketHandlers();
    
    this.socket.connect(this.options.port, this.options.host);
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
      this.sendLogon();
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
      this.emit('error', error);
    });

    this.socket.on('close', () => {
      logger.info('Socket disconnected');
      this.connected = false;
      this.loggedIn = false;
      this.clearTimers();
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.socket.on('timeout', () => {
      logger.warn('Socket timeout');
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
    this.lastActivityTime = Date.now();
    this.receivedData += data.toString();

    // Process complete messages
    let endIndex;
    while ((endIndex = this.receivedData.indexOf(SOH + '10=')) !== -1) {
      // Find the end of the message (next SOH after the checksum)
      const checksumEndIndex = this.receivedData.indexOf(SOH, endIndex + 1);
      if (checksumEndIndex === -1) break;

      // Extract the complete message
      const completeMessage = this.receivedData.substring(0, checksumEndIndex + 1);
      this.receivedData = this.receivedData.substring(checksumEndIndex + 1);

      // Process the message
      this.processMessage(completeMessage);
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
   * Send a message to the server
   */
  private sendMessage(message: string): void {
    if (!this.socket || !this.connected) {
      logger.warn('Cannot send message: not connected');
      return;
    }

    logger.debug(`Sending: ${message.replace(/\x01/g, '|')}`);
    this.socket.write(message);
    this.lastActivityTime = Date.now();
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
    const logonMessage = FixMessageBuilder.createLogonMessage(
      this.options.senderCompId,
      this.options.targetCompId,
      this.options.username,
      this.options.password,
      true,
      this.options.heartbeatIntervalSecs
    );
    this.sendMessage(logonMessage);
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
} 