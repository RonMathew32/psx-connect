import net from 'net';
import { EventEmitter } from 'events';
import { FixMessageBuilder } from './message-builder';
import { FixMessageParser, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import logger from '../utils/logger';
import { Socket } from 'net';

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
  private logonTimer: NodeJS.Timeout | null = null;

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
   * Connect to the FIX server
   */
  public connect(): void {
    if (this.socket && this.connected) {
      logger.warn('Already connected');
      return;
    }

    logger.info(`Connecting to ${this.options.host}:${this.options.port}`);
    this.socket = new Socket();
    this.socket.setKeepAlive(true);
    this.socket.setNoDelay(true);

    // Set connection timeout - increase to 30 seconds for PSX connections
    this.socket.setTimeout(this.options.connectTimeoutMs || 30000);
    
    this.socket.on('timeout', () => {
      logger.error('Connection timed out');
      this.socket?.destroy();
      this.connected = false;
      this.emit('error', new Error('Connection timed out'));
    });

    this.socket.on('connect', () => {
      logger.info(`Connected to ${this.options.host}:${this.options.port}`);
      this.connected = true;
      
      // Clear any existing timeout to prevent duplicate logon attempts
      if (this.logonTimer) {
        clearTimeout(this.logonTimer);
      }
      
      // Send logon message after a short delay
      this.logonTimer = setTimeout(async () => {
        try {
          await this.sendLogon();
        } catch (error) {
          logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
          this.disconnect();
        }
      }, 500);
      
      this.emit('connected');
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
      if (error.stack) {
        logger.debug(`Error stack: ${error.stack}`);
      }
      
      // Check specific error codes and respond accordingly
      if ('code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED') {
          logger.error(`Connection refused to ${this.options.host}:${this.options.port}. Server may be down or unreachable.`);
        } else if (code === 'ETIMEDOUT') {
          logger.error(`Connection timed out to ${this.options.host}:${this.options.port}`);
        }
      }
      
      this.emit('error', error);
    });

    this.socket.on('close', (hadError) => {
      logger.info(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
      this.connected = false;
      this.loggedIn = false;
      this.clearTimers();
      this.emit('disconnected');
      
      // Check if data was ever received
      if (this.lastActivityTime === 0) {
        logger.warn('Connection closed without any data received - server may have rejected the connection');
        logger.warn('Check credentials and network connectivity to the FIX server');
        logger.warn('Make sure your OnBehalfOfCompID, RawData, and RawDataLength fields are correct');
      }
      
      this.scheduleReconnect();
    });

    // Connect to the server
    try {
      this.socket.connect(this.options.port, this.options.host);
    } catch (error) {
      logger.error(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
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
      const localAddress = this.socket?.localAddress;
      const localPort = this.socket?.localPort;
      logger.debug(`Connected to ${this.options.host}:${this.options.port}`);
      logger.debug(`Local address: ${localAddress}:${localPort}`);
      
      // Wait before sending logon to ensure socket is fully established
      // This delay matches the behavior observed in the Go implementation
      setTimeout(() => {
        // Send logon message to authenticate
        this.sendLogon();
      }, 500);
      
      this.emit('connected');
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('error', (error) => {
      logger.error(`Socket error: ${error.message}`);
      if (error.stack) {
        logger.debug(`Error stack: ${error.stack}`);
      }
      
      // Check specific error codes and respond accordingly
      if ('code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ECONNREFUSED') {
          logger.error(`Connection refused to ${this.options.host}:${this.options.port}. Server may be down or unreachable.`);
        } else if (code === 'ETIMEDOUT') {
          logger.error(`Connection timed out to ${this.options.host}:${this.options.port}`);
        }
      }
      
      this.emit('error', error);
    });

    this.socket.on('close', (hadError) => {
      logger.info(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
      this.connected = false;
      this.loggedIn = false;
      this.clearTimers();
      this.emit('disconnected');
      
      // Check if data was ever received
      if (this.lastActivityTime === 0) {
        logger.warn('Connection closed without any data received - server may have rejected the connection');
        logger.warn('Check credentials and network connectivity to the FIX server');
        logger.warn('Make sure your OnBehalfOfCompID, RawData, and RawDataLength fields are correct');
      }
      
      this.scheduleReconnect();
    });

    this.socket.on('timeout', () => {
      logger.warn('Socket timeout - connection inactive');
      
      if (this.connected && this.loggedIn) {
        // If we're logged in, try sending a test request to keep the connection alive
        logger.warn('Sending test request to check if server is still responsive');
        try {
          const testRequest = FixMessageBuilder.createTestRequestMessage(
            this.options.senderCompId,
            this.options.targetCompId
          );
          
          if (this.socket) {
            this.socket.write(testRequest);
          }
        } catch (error) {
          logger.error('Failed to send test request, destroying socket');
          if (this.socket) {
            this.socket.destroy();
            this.socket = null;
          }
        }
      } else {
        // If we're not yet logged in, the connection attempt failed
        logger.error('Socket timeout during connection attempt - server did not respond');
        if (this.socket) {
          this.socket.destroy();
          this.socket = null;
        }
      }
    });
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
        
        // Verify checksum before processing
        if (!FixMessageParser.verifyChecksum(completeMessage)) {
          logger.warn('Invalid checksum in message, skipping processing');
          continue;
        }
        
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
    try {
      logger.debug(`Processing received message: ${message.replace(/\x01/g, '|')}`);

      if (!FixMessageParser.verifyChecksum(message)) {
        logger.warn('Invalid checksum in message, rejecting');
        return;
      }

      const parsedMessage = FixMessageParser.parse(message);
      
      // Emit the raw message event for debugging and custom handling
      this.emit('message', parsedMessage);

      // Log the message type for debugging
      const msgType = parsedMessage['35']; // MsgType
      logger.debug(`Processing message type: ${msgType}`);

      // Handle different message types
      if (FixMessageParser.isLogon(parsedMessage)) {
        // Logon acknowledged by server
        logger.info(`Logon response received: ${JSON.stringify(parsedMessage)}`);
        this.handleLogon(parsedMessage);
      } else if (FixMessageParser.isLogout(parsedMessage)) {
        // Server is logging us out
        const text = parsedMessage['58'] || 'No reason provided'; // Text field
        logger.info(`Logout received with reason: ${text}`);
        this.handleLogout(parsedMessage);
      } else if (FixMessageParser.isHeartbeat(parsedMessage)) {
        // Heartbeat from server, reset activity timer
        logger.debug('Heartbeat received');
        this.testRequestCount = 0; // Reset test request counter
      } else if (FixMessageParser.isTestRequest(parsedMessage)) {
        // Test request from server, respond with heartbeat
        const testReqId = parsedMessage['112'] || ''; // TestReqID
        logger.debug(`Test request received with ID: ${testReqId}`);
        this.handleTestRequest(parsedMessage);
      } else if (FixMessageParser.isReject(parsedMessage)) {
        // Message rejected by server
        const rejectText = parsedMessage['58'] || 'No reason provided'; // Text
        const rejectReason = parsedMessage['373'] || 'Unknown'; // SessionRejectReason
        logger.error(`Reject message received: ${rejectText}, reason: ${rejectReason}`);
        this.handleReject(parsedMessage);
      } else if (FixMessageParser.isMarketDataSnapshot(parsedMessage)) {
        // Market data snapshot from server
        // Check if this is a PSX-specific format
        if (parsedMessage['1137'] === '9' && parsedMessage['1129'] === 'FIX5.00_PSX_1.00') {
          logger.debug('Received PSX-specific market data snapshot');
        }
        this.handleMarketDataSnapshot(parsedMessage);
      } else if (FixMessageParser.isMarketDataIncremental(parsedMessage)) {
        // Market data incremental update from server
        // Check if this is a PSX-specific format
        if (parsedMessage['1137'] === '9' && parsedMessage['1129'] === 'FIX5.00_PSX_1.00') {
          logger.debug('Received PSX-specific market data update');
        }
        this.handleMarketDataIncremental(parsedMessage);
      } else if (FixMessageParser.isSecurityList(parsedMessage)) {
        // Security list from server
        this.handleSecurityList(parsedMessage);
      } else if (FixMessageParser.isTradingSessionStatus(parsedMessage)) {
        // Trading session status from server
        this.handleTradingSessionStatus(parsedMessage);
      } else {
        // Unknown message type
        logger.debug(`Unhandled message type: ${msgType}`);
        logger.debug(`Message content: ${JSON.stringify(parsedMessage)}`);
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Error stack: ${error.stack}`);
      }
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
        
        // Find position to insert PSX specific fields after MsgType
        const msgParts = message.split(SOH);
        let modifiedMessage = '';
        
        // Add PSX specific fields after MsgType (35=...)
        for (let i = 0; i < msgParts.length; i++) {
          modifiedMessage += msgParts[i] + SOH;
          
          // After MsgType field, add PSX specific fields
          if (msgParts[i].startsWith('35=')) {
            modifiedMessage += `1137=9${SOH}`; // DefaultApplVerID
            modifiedMessage += `1129=FIX5.00_PSX_1.00${SOH}`; // DefaultCstmApplVerID
            modifiedMessage += `115=600${SOH}`; // OnBehalfOfCompID
            modifiedMessage += `96=kse${SOH}`; // RawData
            modifiedMessage += `95=3${SOH}`; // RawDataLength
          }
        }
        
        // Use the modified message with PSX fields
        message = modifiedMessage;
        
        // Need to recalculate body length and checksum
        // Extract the message parts (without checksum)
        const checksumPos = message.lastIndexOf('10=');
        const messageWithoutChecksum = message.substring(0, checksumPos);
        
        // Extract the header
        const bodyLengthPos = message.indexOf('9=');
        const headerEnd = message.indexOf(SOH, bodyLengthPos) + 1;
        const header = message.substring(0, headerEnd);
        
        // Extract the body
        const body = message.substring(headerEnd, checksumPos);
        
        // Calculate new body length (without SOH characters)
        const bodyLengthValue = body.replace(new RegExp(SOH, 'g'), '').length;
        
        // Create new message with updated body length
        const newMessage = `8=FIXT.1.1${SOH}9=${bodyLengthValue}${SOH}${body}`;
        
        // Calculate new checksum
        let sum = 0;
        for (let i = 0; i < newMessage.length; i++) {
          sum += newMessage.charCodeAt(i);
        }
        const checksum = (sum % 256).toString().padStart(3, '0');
        
        // Final message with updated checksum
        message = newMessage + `10=${checksum}${SOH}`;
      }
      
      logger.debug(`Sending: ${message.replace(/\x01/g, '|')}`);
      logger.debug(`Sending: ${message}`);
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
    try {
      logger.info('Logon successful - authenticated with PSX server');
      this.loggedIn = true;
      this.testRequestCount = 0;
      
      // Get server's message sequence number
      const serverSeqNum = parseInt(message['34'] || '1', 10);
      logger.debug(`Server message sequence number: ${serverSeqNum}`);
      
      // Reset sequence number if requested
      if (message['141'] === 'Y') { // ResetSeqNumFlag
        this.msgSeqNum = 1;
        logger.debug('Sequence number reset to 1 based on server response');
      } else {
        // Increment our sequence number
        this.msgSeqNum = 2; // After logon, next message should be 2
        logger.debug('Sequence number set to 2 for next message');
      }
      
      // Check for PSX-specific fields
      if (message['1137'] && message['1129']) {
        logger.info('PSX-specific fields present in logon response');
      }
      
      // Start sending heartbeats
      this.startHeartbeatMonitoring();
      
      // Emit logon event
      this.emit('logon', message);
      
      logger.info('Ready to send FIX messages to PSX');
    } catch (error) {
      logger.error(`Error handling logon response: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Error stack: ${error.stack}`);
      }
    }
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
   * Check if VPN is active before sending logon message
   * @returns A promise that resolves to true if VPN is active, false otherwise
   */
  private async checkVpnConnection(): Promise<boolean> {
    try {
      logger.info("Checking VPN connectivity before sending logon message...");
      
      // Try to ping the PSX server to verify VPN connectivity
      const { exec } = require('child_process');
      
      return new Promise((resolve) => {
        // PSX server address from options
        const psx_host = this.options.host;
        
        // Use ping to check connectivity - ping only once with 3s timeout
        const cmd = `ping -c 1 -W 3 ${psx_host}`;
        
        exec(cmd, (error: any) => {
          if (error) {
            logger.error(`VPN connection check failed: Cannot reach ${psx_host}`);
            logger.error('Please ensure you are connected to the correct VPN before connecting to PSX');
            resolve(false);
          } else {
            logger.info(`VPN connectivity to ${psx_host} confirmed`);
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.error(`Error checking VPN connectivity: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Send a logon message
   */
  public async sendLogon(): Promise<void> {
    logger.info("Preparing to send logon message...");
    
    // Check VPN connectivity before sending logon
    const vpnActive = await this.checkVpnConnection();
    if (!vpnActive) {
      logger.error("Aborting logon attempt: No VPN connectivity detected");
      this.emit('error', new Error('No VPN connectivity detected. Please connect to VPN before attempting to connect to PSX.'));
      return;
    }
    
    // Format timestamp to match FIX standard: YYYYMMDD-HH:MM:SS.sss
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
    const timestamp = `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
    
    try {
      // Create logon message without any delimiters at all, matching fn-psx format
      const logonMessage = "8=FIXT.1.19=12735=A34=149=" + 
        this.options.senderCompId + 
        "52=" + timestamp + 
        "56=" + this.options.targetCompId + 
        "98=0108=" + this.options.heartbeatIntervalSecs + 
        "141=Y553=" + this.options.username +
        "554=" + this.options.password + 
        // Add PSX specific fields for logon without delimiters
        "115=60096=kse95=3" +
        "1137=91408=FIX5.00_PSX_1.0010=153";
      
      logger.info("Sending logon message with no delimiters, matching fn-psx format");
      logger.info(`Logon message: ${logonMessage}`);
      
      if (!this.socket || !this.connected) {
        logger.warn('Cannot send logon: not connected');
        return;
      }
  
      this.socket.write(logonMessage);
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
      this.heartbeatTimer = null;
    }

    const heartbeatInterval = this.options.heartbeatIntervalSecs * 1000;
    logger.info(`Starting heartbeat monitoring with interval of ${this.options.heartbeatIntervalSecs} seconds`);
    
    this.heartbeatTimer = setInterval(() => {
      try {
        const currentTime = Date.now();
        const timeSinceLastActivity = currentTime - this.lastActivityTime;

        // If no activity for more than heartbeat interval, send a heartbeat
        if (timeSinceLastActivity >= heartbeatInterval) {
          // If no response to multiple test requests, consider connection dead
          if (this.testRequestCount >= 2) {
            logger.warn('No response to test requests after multiple attempts, connection may be dead');
            logger.warn('Destroying socket and attempting to reconnect');
            if (this.socket) {
              this.socket.destroy();
              this.socket = null;
            }
            return;
          }

          // After 1.5 intervals without activity, send a test request instead of heartbeat
          if (timeSinceLastActivity >= heartbeatInterval * 1.5) {
            logger.debug('Sending test request to verify connection');
            
            // Create test request with current sequence number
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 21);
            const testReqId = `TEST-${timestamp}`;
            
            const testRequest = FixMessageBuilder.createTestRequestMessage(
              this.options.senderCompId,
              this.options.targetCompId,
              testReqId
            );
            
            this.sendMessage(testRequest);
            this.testRequestCount++;
            logger.debug(`Test request count: ${this.testRequestCount}`);
          } else {
            logger.debug('Sending heartbeat to maintain connection');
            
            // Create heartbeat with current sequence number
            const heartbeat = FixMessageBuilder.createHeartbeatMessage(
              this.options.senderCompId,
              this.options.targetCompId
            );
            
            this.sendMessage(heartbeat);
          }
        }
      } catch (error) {
        logger.error(`Error in heartbeat monitoring: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          logger.debug(`Error stack: ${error.stack}`);
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