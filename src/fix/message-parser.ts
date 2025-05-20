import { SOH, MessageType, FieldTag } from '../constants';

/**
 * Parsed FIX message as a dictionary of tag-value pairs
 */
export interface ParsedFixMessage {
  [key: string]: string;
}
/**
 * Parse a FIX message string into a tag-value object
 * @param message The raw FIX message string
 * @returns ParsedFixMessage or null if parsing failed
 */
export function parseFixMessage(message: string): ParsedFixMessage | null {
  try {
    const result: ParsedFixMessage = {};
    
    // Split on SOH character
    const fields = message.split(SOH);
    
    // Process each field
    for (const field of fields) {
      if (!field) continue;
      
      // Split tag=value
      const separatorIndex = field.indexOf('=');
      if (separatorIndex > 0) {
        const tag = field.substring(0, separatorIndex);
        const value = field.substring(separatorIndex + 1);
        result[tag] = value;
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error parsing FIX message:', error);
    return null;
  }
}

/**
 * Check if a message is a specific type
 */
export function isMessageType(message: ParsedFixMessage, type: string): boolean {
  return message[FieldTag.MSG_TYPE] === type;
}

/**
 * Check if a message is a logon message
 */
export function isLogon(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.LOGON);
}

/**
 * Check if a message is a logout message
 */
export function isLogout(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.LOGOUT);
}

/**
 * Check if a message is a heartbeat message
 */
export function isHeartbeat(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.HEARTBEAT);
}

/**
 * Check if a message is a test request message
 */
export function isTestRequest(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.TEST_REQUEST);
}

/**
 * Check if a message is a market data snapshot message
 */
export function isMarketDataSnapshot(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH);
}

/**
 * Check if a message is a market data incremental refresh message
 */
export function isMarketDataIncremental(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.MARKET_DATA_INCREMENTAL_REFRESH);
}

/**
 * Check if a message is a security list message
 */
export function isSecurityList(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.SECURITY_LIST);
}

/**
 * Check if a message is a trading session status message
 */
export function isTradingSessionStatus(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.TRADING_SESSION_STATUS);
}

/**
 * Check if a message is a reject message
 */
export function isReject(message: ParsedFixMessage): boolean {
  return isMessageType(message, MessageType.REJECT);
}

/**
 * Get the SenderCompID from a message
 */
export function getSenderCompID(message: ParsedFixMessage): string {
  return message[FieldTag.SENDER_COMP_ID] || '';
}

/**
 * Get the TargetCompID from a message
 */
export function getTargetCompID(message: ParsedFixMessage): string {
  return message[FieldTag.TARGET_COMP_ID] || '';
}

/**
 * Get the MsgSeqNum from a message
 */
export function getMsgSeqNum(message: ParsedFixMessage): number {
  return parseInt(message[FieldTag.MSG_SEQ_NUM] || '0', 10);
}

/**
 * Get the TestReqID from a message
 */
export function getTestReqID(message: ParsedFixMessage): string {
  return message[FieldTag.TEST_REQ_ID] || '';
}

/**
 * Get the MDReqID from a message
 */
export function getMDReqID(message: ParsedFixMessage): string {
  return message[FieldTag.MD_REQ_ID] || '';
}

/**
 * Get error text from a reject message
 */
export function getRejectText(message: ParsedFixMessage): string {
  return message[FieldTag.TEXT] || '';
}

/**
 * Verify the message checksum
 */
export function verifyChecksum(message: string): boolean {
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