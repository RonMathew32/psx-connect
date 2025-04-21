import { SOH, MessageType, FieldTag } from './constants';

export interface ParsedFixMessage {
  [key: string]: string;
}

export class FixMessageParser {
  /**
   * Parse a FIX message string into an object
   */
  static parse(message: string): ParsedFixMessage {
    const result: ParsedFixMessage = {};
    
    // Split the message by the SOH character
    const fields = message.split(SOH);
    
    // Process each field
    for (const field of fields) {
      if (!field) continue;
      
      // Split the field into tag and value
      const equalPos = field.indexOf('=');
      if (equalPos === -1) continue;
      
      const tag = field.substring(0, equalPos);
      const value = field.substring(equalPos + 1);
      
      result[tag] = value;
    }
    
    return result;
  }

  /**
   * Check if a message is a specific type
   */
  static isMessageType(message: ParsedFixMessage, type: string): boolean {
    return message[FieldTag.MSG_TYPE.toString()] === type;
  }

  /**
   * Check if a message is a logon message
   */
  static isLogon(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.LOGON);
  }

  /**
   * Check if a message is a logout message
   */
  static isLogout(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.LOGOUT);
  }

  /**
   * Check if a message is a heartbeat message
   */
  static isHeartbeat(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.HEARTBEAT);
  }

  /**
   * Check if a message is a test request message
   */
  static isTestRequest(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.TEST_REQUEST);
  }

  /**
   * Check if a message is a market data snapshot message
   */
  static isMarketDataSnapshot(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH);
  }

  /**
   * Check if a message is a market data incremental refresh message
   */
  static isMarketDataIncremental(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.MARKET_DATA_INCREMENTAL_REFRESH);
  }

  /**
   * Check if a message is a security list message
   */
  static isSecurityList(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.SECURITY_LIST);
  }

  /**
   * Check if a message is a trading session status message
   */
  static isTradingSessionStatus(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.TRADING_SESSION_STATUS);
  }

  /**
   * Check if a message is a reject message
   */
  static isReject(message: ParsedFixMessage): boolean {
    return this.isMessageType(message, MessageType.REJECT);
  }

  /**
   * Get the SenderCompID from a message
   */
  static getSenderCompID(message: ParsedFixMessage): string {
    return message[FieldTag.SENDER_COMP_ID.toString()] || '';
  }

  /**
   * Get the TargetCompID from a message
   */
  static getTargetCompID(message: ParsedFixMessage): string {
    return message[FieldTag.TARGET_COMP_ID.toString()] || '';
  }

  /**
   * Get the MsgSeqNum from a message
   */
  static getMsgSeqNum(message: ParsedFixMessage): number {
    return parseInt(message[FieldTag.MSG_SEQ_NUM.toString()] || '0', 10);
  }

  /**
   * Get the TestReqID from a message
   */
  static getTestReqID(message: ParsedFixMessage): string {
    return message[FieldTag.TEST_REQ_ID.toString()] || '';
  }

  /**
   * Get the MDReqID from a message
   */
  static getMDReqID(message: ParsedFixMessage): string {
    return message[FieldTag.MD_REQ_ID.toString()] || '';
  }

  /**
   * Get error text from a reject message
   */
  static getRejectText(message: ParsedFixMessage): string {
    return message['58'] || ''; // Text is tag 58
  }

  /**
   * Verify the message checksum
   */
  static verifyChecksum(message: string): boolean {
    // Find the last SOH before the checksum field
    const lastSOHIndex = message.lastIndexOf(SOH, message.lastIndexOf('10=') - 1);
    if (lastSOHIndex === -1) return false;

    // Calculate the checksum for the part of the message before the checksum field
    const messageBody = message.substring(0, lastSOHIndex + 1);
    let sum = 0;
    for (let i = 0; i < messageBody.length; i++) {
      sum += messageBody.charCodeAt(i);
    }
    const calculatedChecksum = (sum % 256).toString().padStart(3, '0');

    // Extract the checksum from the message
    const checksumMatch = message.match(/10=(\d{3})/);
    if (!checksumMatch) return false;
    
    const messageChecksum = checksumMatch[1];

    return calculatedChecksum === messageChecksum;
  }
} 