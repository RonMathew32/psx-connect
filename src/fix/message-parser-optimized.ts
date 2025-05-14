import { SOH, MessageType, FieldTag } from './constants';

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
    
    // Split on SOH character - using precomputed length for performance
    const fields = message.split(SOH);
    const length = fields.length;
    
    // Process each field - optimized loop
    for (let i = 0; i < length; i++) {
      const field = fields[i];
      if (!field) continue;
      
      // Find separator index instead of using split
      const separatorIndex = field.indexOf('=');
      if (separatorIndex > 0) {
        const tag = field.substring(0, separatorIndex);
        const value = field.substring(separatorIndex + 1);
        result[tag] = value;
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    console.error('Error parsing FIX message:', error);
    return null;
  }
}

/**
 * Check if a message is a specific type - optimized to avoid property lookup inside function
 */
export function isMessageType(message: ParsedFixMessage, type: string): boolean {
  return message[FieldTag.MSG_TYPE] === type;
}

// Specialized message type checks for common message types
// Using a lookup approach for better performance
const messageTypeCheckers: { [key: string]: (msg: ParsedFixMessage) => boolean } = {
  isLogon: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.LOGON,
  isLogout: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.LOGOUT,
  isHeartbeat: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.HEARTBEAT,
  isTestRequest: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.TEST_REQUEST,
  isMarketDataSnapshot: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH,
  isMarketDataIncremental: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.MARKET_DATA_INCREMENTAL_REFRESH,
  isSecurityList: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.SECURITY_LIST,
  isTradingSessionStatus: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.TRADING_SESSION_STATUS,
  isReject: (msg) => msg[FieldTag.MSG_TYPE] === MessageType.REJECT
};

// Export all the type checkers
export const {
  isLogon,
  isLogout,
  isHeartbeat,
  isTestRequest,
  isMarketDataSnapshot,
  isMarketDataIncremental,
  isSecurityList,
  isTradingSessionStatus,
  isReject
} = messageTypeCheckers;

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
 * Get a field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present
 */
export function getField(message: ParsedFixMessage, tag: string, defaultValue: string = ''): string {
  return message[tag] || defaultValue;
}

/**
 * Get a numeric field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present or invalid
 */
export function getNumericField(message: ParsedFixMessage, tag: string, defaultValue: number = 0): number {
  const value = message[tag];
  if (value === undefined) return defaultValue;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a decimal field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present or invalid
 */
export function getDecimalField(message: ParsedFixMessage, tag: string, defaultValue: number = 0): number {
  const value = message[tag];
  if (value === undefined) return defaultValue;
  
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Verify the message checksum
 */
export function verifyChecksum(message: string): boolean {
  // Find the last SOH before the checksum field
  const checksumIndex = message.lastIndexOf('10=');
  if (checksumIndex === -1) return false;
  
  // Find the last SOH before the checksum field
  const lastSOHIndex = message.lastIndexOf(SOH, checksumIndex - 1);
  if (lastSOHIndex === -1) return false;
  
  // Calculate the checksum for the part of the message before the checksum field
  const messageBody = message.substring(0, lastSOHIndex + 1);
  let sum = 0;
  const bodyLength = messageBody.length;
  
  // Optimized loop
  for (let i = 0; i < bodyLength; i++) {
    sum += messageBody.charCodeAt(i);
  }
  
  const calculatedChecksum = (sum % 256).toString().padStart(3, '0');
  
  // Extract the checksum from the message - avoid regex for better performance
  const checksumStart = checksumIndex + 3; // Skip "10="
  const checksumEnd = message.indexOf(SOH, checksumStart);
  const messageChecksum = checksumEnd !== -1 
    ? message.substring(checksumStart, checksumEnd) 
    : message.substring(checksumStart);
  
  return calculatedChecksum === messageChecksum;
}

/**
 * Extract repeating group fields from a FIX message
 * @param message The parsed FIX message
 * @param countTag The tag containing the count of repeating items
 * @param tags Array of tags to extract for each item in the group
 * @returns Array of extracted group items
 */
export function extractRepeatingGroup(
  message: ParsedFixMessage,
  countTag: string,
  tags: string[]
): Record<string, string>[] {
  const count = getNumericField(message, countTag, 0);
  const result: Record<string, string>[] = [];
  
  for (let i = 0; i < count; i++) {
    const groupItem: Record<string, string> = {};
    
    // Extract each tag for this group item
    for (const tag of tags) {
      // Try different formats for repeating group fields
      const value = message[`${tag}.${i}`] || message[`${tag}_${i}`];
      if (value !== undefined) {
        groupItem[tag] = value;
      }
    }
    
    // Only add items that have at least one field
    if (Object.keys(groupItem).length > 0) {
      result.push(groupItem);
    }
  }
  
  return result;
} 