import net from 'net';
import { EventEmitter } from 'events';
import { FixMessageBuilder } from './message-builder';
import { FixMessageParser, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import logger from '../utils/logger';
import { Socket } from 'net';
import { VpnChecker } from '../utils/vpn-check';

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
  public async connect(): Promise<void> {
    if (this.socket && this.connected) {
      logger.warn('Already connected');
      return;
    }

    // Check VPN connection first
    const vpnChecker = VpnChecker.getInstance();
    const isVpnActive = await vpnChecker.ensureVpnConnection();
    
    if (!isVpnActive) {
      logger.error("Cannot connect: VPN is not active");
      this.emit('error', new Error('VPN connection required'));
      return;
    }
    
    logger.info("VPN connection confirmed, connecting to PSX...");
    logger.info(`Connecting to ${this.options.host}:${this.options.port}`);
    
    try {
      // Create socket with specific configuration - matching fn-psx
      this.socket = new Socket();
      
      // Apply socket settings exactly like fn-psx
      this.socket.setKeepAlive(true);
      this.socket.setNoDelay(true);
      
      // Set connection timeout 
      this.socket.setTimeout(this.options.connectTimeoutMs || 30000);
      
      // Setup event handlers
      this.socket.on('timeout', () => {
        logger.error('Connection timed out');
        this.socket?.destroy();
        this.connected = false;
        this.emit('error', new Error('Connection timed out'));
      });

      this.socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        this.emit('error', error);
      });

      this.socket.on('close', () => {
        logger.info('Socket disconnected');
        this.connected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });
      
      // Handle received data
      this.socket.on('data', (data) => {
        this.handleData(data);
      });
      
      // On connect, send logon immediately after VPN check
      this.socket.on('connect', () => {
        logger.info(`Connected to ${this.options.host}:${this.options.port}`);
        this.connected = true;
        
        // Clear any existing timeout to prevent duplicate logon attempts
        if (this.logonTimer) {
          clearTimeout(this.logonTimer);
        }
        
        // Send logon message after a short delay - exactly like fn-psx
        this.logonTimer = setTimeout(() => {
          try {
            logger.info('Sending logon message...');
            this.sendLogon();
          } catch (error) {
            logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
            this.disconnect();
          }
        }, 500);
        
        this.emit('connected');
      });
      
      // Connect to the server
      logger.info(`Establishing TCP connection to ${this.options.host}:${this.options.port}...`);
      this.socket.connect(this.options.port, this.options.host);
    } catch (error) {
      logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
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
      
      logger.debug(`Received data: ${dataStr.length} bytes`);
      
      // Handle complete messages
      this.receivedData += dataStr;
      this.processMessage(this.receivedData);
      this.receivedData = '';
    } catch (error) {
      logger.error(`Error processing received data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a complete FIX message
   */
  private processMessage(message: string): void {
    try {
      logger.debug(`Processing message: ${message}`);

      // Basic parsing for FIX message
      const parsedMessage = this.parseFixMessage(message);
      
      // Simple extraction of message type
      const msgType = this.getMessageType(message);
      logger.debug(`Received message type: ${msgType}`);

      // Handle different message types
      if (msgType === 'A') {
        // Logon
        logger.info('Logon response received');
        this.loggedIn = true;
        this.emit('logon', parsedMessage);
      } else if (msgType === '5') {
        // Logout
        logger.info('Logout message received');
        this.loggedIn = false;
        this.emit('logout', parsedMessage);
      } else if (msgType === '0') {
        // Heartbeat
        logger.debug('Heartbeat received');
      } else if (msgType === '1') {
        // Test request
        logger.debug('Test request received');
        // Send heartbeat in response
        const testReqId = this.getField(message, '112');
        if (testReqId) {
          this.sendHeartbeat(testReqId);
        }
      } else {
        // Other message types
        logger.debug(`Received message type ${msgType}`);
        this.emit('message', parsedMessage);
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Basic parsing of FIX message into tag-value pairs
   */
  private parseFixMessage(message: string): Record<string, string> {
    const result: Record<string, string> = {};
    
    // Simple regex to extract fields
    const regex = /(\d+)=([^,;\s]*)/g;
    let match;
    
    while (match = regex.exec(message)) {
      const [, tag, value] = match;
      result[tag] = value;
    }
    
    return result;
  }
  
  /**
   * Extract message type from FIX message
   */
  private getMessageType(message: string): string {
    const match = message.match(/35=([^,;\s]*)/);
    return match ? match[1] : '';
  }
  
  /**
   * Extract field value from FIX message
   */
  private getField(message: string, tag: string): string | undefined {
    const regex = new RegExp(tag + '=([^,;\s]*)');
    const match = message.match(regex);
    return match ? match[1] : undefined;
  }
  
  /**
   * Send a heartbeat message in response to test request
   */
  private sendHeartbeat(testReqId: string): void {
    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
      
      const heartbeat = `8=FIXT.1.19=6535=034=249=${this.options.senderCompId}52=${timestamp}56=${this.options.targetCompId}112=${testReqId}10=000`;
      
      if (this.socket && this.connected) {
        this.socket.write(heartbeat);
        logger.debug(`Sent heartbeat in response to test request: ${testReqId}`);
      }
    } catch (error) {
      logger.error(`Failed to send heartbeat: ${error instanceof Error ? error.message : String(error)}`);
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

  /**
   * Send a logon message - exactly as fn-psx does
   */
  public sendLogon(): void {
    logger.info("Sending logon message...");
    
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
      // Exactly match the fn-psx logon message format with no delimiters
      const logonMessage = "8=FIXT.1.19=12735=A34=149=" + 
        this.options.senderCompId + 
        "52=" + timestamp + 
        "56=" + this.options.targetCompId + 
        "98=0108=" + this.options.heartbeatIntervalSecs + 
        "141=Y554=" + this.options.password + 
        "1137=91408=FIX5.00_PSX_1.0010=153";
      
      logger.info(`Logon message: ${logonMessage}`);
      
      if (!this.socket || !this.connected) {
        logger.warn('Cannot send logon: not connected');
        return;
      }
      
      // Simple socket write - exactly as fn-psx does it
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
    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
      
      const logoutMessage = `8=FIXT.1.19=6535=534=349=${this.options.senderCompId}52=${timestamp}56=${this.options.targetCompId}10=000`;
      
      if (this.socket && this.connected) {
        this.socket.write(logoutMessage);
        logger.info('Sent logout message');
      }
    } catch (error) {
      logger.error(`Failed to send logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private formatMessageForLogging(message: string): string {
    // Implement the logic to format the message for logging
    return message;
  }
}