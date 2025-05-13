/**
 * PSX Security List Request Handler
 * 
 * Specialized handler for PSX security list requests, which require specific
 * sequence number handling and message formatting.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { SOH, MessageType, FieldTag } from './constants';
import { createMessageBuilder } from './message-builder';
import SequenceManager from './sequence-manager';
import { SecurityInfo } from '../types';

export enum SecurityListType {
  EQUITY = 'EQUITY',
  INDEX = 'INDEX',
  BOND = 'BOND'
}

export interface SecurityListRequestConfig {
  senderCompId: string;
  targetCompId: string;
  onRequestSent?: (requestId: string, type: SecurityListType) => void;
  onDataReceived?: (securities: SecurityInfo[], type: SecurityListType) => void;
}

export class SecurityListHandler {
  private config: SecurityListRequestConfig;
  private sequenceManager: SequenceManager;
  private socketWrite: (data: string) => void;
  private requestsInProgress: Set<string> = new Set();
  private receivedSecurities: Map<SecurityListType, SecurityInfo[]> = new Map();
  
  constructor(
    config: SecurityListRequestConfig, 
    sequenceManager: SequenceManager,
    socketWrite: (data: string) => void
  ) {
    this.config = config;
    this.sequenceManager = sequenceManager;
    this.socketWrite = socketWrite;
    
    // Initialize empty security lists
    this.receivedSecurities.set(SecurityListType.EQUITY, []);
    this.receivedSecurities.set(SecurityListType.INDEX, []);
    this.receivedSecurities.set(SecurityListType.BOND, []);
  }
  
  /**
   * Send a security list request for equities
   */
  public requestEquitySecurities(): string {
    logger.info(`[SECURITY_LIST] Preparing to send equity security list request`);
    
    // Enter security list mode to use fixed sequence number
    this.sequenceManager.enterSecurityListMode();
    
    const requestId = uuidv4();
    logger.info(`[SECURITY_LIST] Sending EQUITY security list request with ID: ${requestId}`);
    
    // Create message in the format used by fn-psx project
    const message = createMessageBuilder()
      .setMsgType(MessageType.SECURITY_LIST_REQUEST)
      .setSenderCompID(this.config.senderCompId)
      .setTargetCompID(this.config.targetCompId)
      .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum());
    
    // Add required fields in same order as fn-psx
    message.addField(FieldTag.SECURITY_REQ_ID, requestId);
    message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
    message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
    message.addField('460', '4'); // Product = EQUITY (4)
    message.addField('336', 'REG'); // TradingSessionID = REG
    
    const rawMessage = message.buildMessage();
    logger.info(`[SECURITY_LIST] Raw equity security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
    
    try {
      // Track this request
      this.requestsInProgress.add(requestId);
      
      // Send the message
      this.socketWrite(rawMessage);
      
      // Call the callback if provided
      if (this.config.onRequestSent) {
        this.config.onRequestSent(requestId, SecurityListType.EQUITY);
      }
      
      return requestId;
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
      this.sequenceManager.exitSecurityListMode();
      throw error;
    }
  }
  
  /**
   * Send a security list request for indices
   */
  public requestIndexSecurities(): string {
    logger.info(`[SECURITY_LIST] Preparing to send index security list request`);
    
    // Enter security list mode to use fixed sequence number
    this.sequenceManager.enterSecurityListMode();
    
    const requestId = uuidv4();
    logger.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);
    
    // Create message in the format used by fn-psx project
    const message = createMessageBuilder()
      .setMsgType(MessageType.SECURITY_LIST_REQUEST)
      .setSenderCompID(this.config.senderCompId)
      .setTargetCompID(this.config.targetCompId)
      .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum());
    
    // Add required fields in same order as fn-psx
    message.addField(FieldTag.SECURITY_REQ_ID, requestId);
    message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
    message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
    message.addField('460', '5'); // Product = INDEX (5)
    message.addField('336', 'REG'); // TradingSessionID = REG
    
    const rawMessage = message.buildMessage();
    logger.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
    
    try {
      // Track this request
      this.requestsInProgress.add(requestId);
      
      // Send the message
      this.socketWrite(rawMessage);
      
      // Call the callback if provided
      if (this.config.onRequestSent) {
        this.config.onRequestSent(requestId, SecurityListType.INDEX);
      }
      
      return requestId;
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
      this.sequenceManager.exitSecurityListMode();
      throw error;
    }
  }
  
  /**
   * Request both equity and index securities in sequence
   */
  public requestAllSecurities(): void {
    // First request equities
    const equityRequestId = this.requestEquitySecurities();
    logger.info(`[SECURITY_LIST] Started comprehensive security list request, equity ID: ${equityRequestId}`);
    
    // Set up a timer to request index securities after a delay
    setTimeout(() => {
      // Reset sequence number again for the index request
      this.sequenceManager.enterSecurityListMode();
      
      const indexRequestId = this.requestIndexSecurities();
      logger.info(`[SECURITY_LIST] Continuing comprehensive security list request, index ID: ${indexRequestId}`);
      
      // Set up a retry timer if no responses within 10 seconds
      setTimeout(() => {
        // Check if we still have pending requests
        if (this.requestsInProgress.size > 0) {
          logger.warn(`[SECURITY_LIST] Some security list requests still pending after timeout, retrying...`);
          this.retryPendingRequests();
        }
      }, 10000);
    }, 5000); // Wait 5 seconds between requests
  }
  
  /**
   * Handle a security list response message
   */
  public handleSecurityListResponse(message: Record<string, string>): void {
    try {
      const requestId = message[FieldTag.SECURITY_REQ_ID];
      
      if (!requestId || !this.requestsInProgress.has(requestId)) {
        logger.warn(`[SECURITY_LIST] Received security list response for unknown request ID: ${requestId}`);
        return;
      }
      
      // Extract securities from the message
      const securities = this.parseSecurities(message);
      
      // Determine the type of securities based on the response
      let securityType = SecurityListType.EQUITY;
      if (securities.length > 0) {
        const firstSecurity = securities[0];
        if (firstSecurity.productType === '5' || firstSecurity.productType === 'INDEX') {
          securityType = SecurityListType.INDEX;
        } else if (firstSecurity.productType === '4' || firstSecurity.productType === 'EQUITY') {
          securityType = SecurityListType.EQUITY;
        }
      }
      
      // Store the received securities
      const existingSecurities = this.receivedSecurities.get(securityType) || [];
      this.receivedSecurities.set(securityType, [...existingSecurities, ...securities]);
      
      logger.info(`[SECURITY_LIST] Received ${securities.length} ${securityType} securities for request ID: ${requestId}`);
      
      // Mark this request as completed
      this.requestsInProgress.delete(requestId);
      
      // Call the callback if provided
      if (this.config.onDataReceived) {
        this.config.onDataReceived(securities, securityType);
      }
      
      // If we have no more pending requests, exit security list mode
      if (this.requestsInProgress.size === 0) {
        this.sequenceManager.exitSecurityListMode();
        logger.info(`[SECURITY_LIST] All security list requests completed, exiting security list mode`);
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error handling security list response: ${error instanceof Error ? error.message : String(error)}`);
      this.sequenceManager.exitSecurityListMode();
    }
  }
  
  /**
   * Parse securities from a security list message
   */
  private parseSecurities(message: Record<string, string>): SecurityInfo[] {
    const securities: SecurityInfo[] = [];
    
    try {
      // Check if this is a security list message
      if (message[FieldTag.MSG_TYPE] !== MessageType.SECURITY_LIST) {
        throw new Error(`Not a security list message: ${message[FieldTag.MSG_TYPE]}`);
      }
      
      // Get the number of securities in the list
      const noRelatedSym = parseInt(message[FieldTag.NO_SECURITIES] || '0', 10);
      
      if (noRelatedSym === 0) {
        logger.warn(`[SECURITY_LIST] Security list contains 0 securities`);
        return securities;
      }
      
      logger.info(`[SECURITY_LIST] Parsing ${noRelatedSym} securities from message`);
      
      // Try the standard FIX format first (repeating groups)
      if (this.tryStandardFormat(message, securities)) {
        return securities;
      }
      
      // If standard format failed, try alternative formats (custom PSX format)
      this.tryAlternativeFormats(message, securities);
      
      // Remove duplicates
      return this.removeDuplicates(securities);
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error parsing securities: ${error instanceof Error ? error.message : String(error)}`);
      return securities;
    }
  }
  
  /**
   * Try to parse securities using standard FIX format
   */
  private tryStandardFormat(message: Record<string, string>, securities: SecurityInfo[]): boolean {
    // Implementation will depend on the specific PSX format
    // This is a placeholder for the actual implementation
    logger.info(`[SECURITY_LIST] Trying standard FIX format for security list parsing`);
    return false;
  }
  
  /**
   * Try to parse securities using alternative PSX formats
   */
  private tryAlternativeFormats(message: Record<string, string>, securities: SecurityInfo[]): void {
    // Implementation will depend on the specific PSX format
    // This is a placeholder for the actual implementation
    logger.info(`[SECURITY_LIST] Trying alternative formats for security list parsing`);
    
    // Example implementation:
    // Iterate through message fields to find security data
    Object.keys(message).forEach(key => {
      // Look for symbol fields (tag 55)
      if (key.includes('55.')) {
        const index = key.split('.')[1];
        const symbol = message[key];
        
        if (symbol) {
          const security: SecurityInfo = {
            symbol,
            securityDesc: message[`107.${index}`] || '',
            productType: message[`460.${index}`] || '',
            lotSize: parseInt(message[`1234.${index}`] || '0', 10),
            tickSize: parseFloat(message[`969.${index}`] || '0'),
            exchange: message[`207.${index}`] || 'PSX',
            isin: message[`48.${index}`] || '',
            currency: message[`15.${index}`] || 'PKR'
          };
          
          securities.push(security);
        }
      }
    });
  }
  
  /**
   * Remove duplicate securities by symbol
   */
  private removeDuplicates(securities: SecurityInfo[]): SecurityInfo[] {
    const uniqueMap = new Map<string, SecurityInfo>();
    
    for (const security of securities) {
      if (!uniqueMap.has(security.symbol)) {
        uniqueMap.set(security.symbol, security);
      }
    }
    
    return Array.from(uniqueMap.values());
  }
  
  /**
   * Retry any pending security list requests
   */
  private retryPendingRequests(): void {
    if (this.requestsInProgress.size === 0) {
      logger.info(`[SECURITY_LIST] No pending requests to retry`);
      return;
    }
    
    logger.info(`[SECURITY_LIST] Retrying ${this.requestsInProgress.size} pending security list requests`);
    
    // Reset and clear pending requests
    const pendingRequests = Array.from(this.requestsInProgress);
    this.requestsInProgress.clear();
    
    // Re-enter security list mode with fresh sequence
    this.sequenceManager.enterSecurityListMode();
    
    // Request both types again
    this.requestAllSecurities();
  }
  
  /**
   * Get all received securities by type
   */
  public getSecurities(type: SecurityListType): SecurityInfo[] {
    return this.receivedSecurities.get(type) || [];
  }
  
  /**
   * Get all received securities (all types)
   */
  public getAllSecurities(): SecurityInfo[] {
    const allSecurities: SecurityInfo[] = [];
    
    for (const securities of this.receivedSecurities.values()) {
      allSecurities.push(...securities);
    }
    
    return this.removeDuplicates(allSecurities);
  }
}

export default SecurityListHandler; 