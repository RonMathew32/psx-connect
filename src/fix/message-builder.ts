import { SOH, MessageType, FieldTag, DEFAULT_CONNECTION, SecurityListRequestType } from './constants';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 */
function getCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());
  const milliseconds = pad(now.getUTCMilliseconds(), 3);
  
  return `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Creates a new message builder with utility functions for building FIX messages
 */
export function createMessageBuilder() {
  let headerFields: Record<string, string> = {
    [FieldTag.BEGIN_STRING]: 'FIXT.1.1'
  };
  
  let bodyFields: Record<string, string> = {};
  
  /**
   * Sets the message type
   */
  const setMsgType = (msgType: string) => {
    headerFields[FieldTag.MSG_TYPE] = msgType;
    return messageBuilder;
  };
  
  /**
   * Sets the sender company ID
   */
  const setSenderCompID = (senderCompID: string) => {
    headerFields[FieldTag.SENDER_COMP_ID] = senderCompID;
    return messageBuilder;
  };
  
  /**
   * Sets the target company ID
   */
  const setTargetCompID = (targetCompID: string) => {
    headerFields[FieldTag.TARGET_COMP_ID] = targetCompID;
    return messageBuilder;
  };
  
  /**
   * Sets the message sequence number
   */
  const setMsgSeqNum = (seqNum: number) => {
    headerFields[FieldTag.MSG_SEQ_NUM] = seqNum.toString();
    return messageBuilder;
  };
  
  /**
   * Add a field to the message body
   */
  const addField = (tag: string, value: string) => {
    bodyFields[tag] = value;
    return messageBuilder;
  };
  
  /**
   * Build the complete FIX message
   */
  const buildMessage = () => {
    // Ensure we have basic required fields
    if (!headerFields[FieldTag.MSG_TYPE]) {
      throw new Error('Message type is required');
    }
    
    // Add sending time if not already set
    if (!headerFields[FieldTag.SENDING_TIME]) {
      headerFields[FieldTag.SENDING_TIME] = getCurrentTimestamp();
    }
    
    const allFields = { ...headerFields, ...bodyFields };
    
    // Convert to string without checksum and body length
    let message = '';
    const sortedTags = Object.keys(allFields).sort((a, b) => {
      // Standard FIX header field order:
      // 8 (BeginString), 9 (BodyLength), 35 (MsgType), 49 (SenderCompID), 
      // 56 (TargetCompID), 34 (MsgSeqNum), 52 (SendingTime)
      const headerOrder: { [key: string]: number } = {
        [FieldTag.BEGIN_STRING]: 1,
        [FieldTag.BODY_LENGTH]: 2,
        [FieldTag.MSG_TYPE]: 3,
        [FieldTag.SENDER_COMP_ID]: 4,
        [FieldTag.TARGET_COMP_ID]: 5,
        [FieldTag.MSG_SEQ_NUM]: 6,
        [FieldTag.SENDING_TIME]: 7
      };

      // If both are header fields, use header order
      if (headerOrder[a] && headerOrder[b]) {
        return headerOrder[a] - headerOrder[b];
      }
      // If only a is header field, it comes first
      if (headerOrder[a]) return -1;
      // If only b is header field, it comes first
      if (headerOrder[b]) return 1;
      // For non-header fields, sort by tag number
      return parseInt(a) - parseInt(b);
    });

    // First build the message without BEGIN_STRING and BODY_LENGTH
    let bodyContent = '';
    for (const tag of sortedTags) {
      if (tag !== FieldTag.BEGIN_STRING && tag !== FieldTag.BODY_LENGTH) {
        bodyContent += `${tag}=${allFields[tag]}${SOH}`;
      }
    }

    // Calculate body length (excluding BEGIN_STRING and BODY_LENGTH fields)
    const bodyLength = bodyContent.length;

    // Build the final message
    message = `${FieldTag.BEGIN_STRING}=${allFields[FieldTag.BEGIN_STRING]}${SOH}`;
    message += `${FieldTag.BODY_LENGTH}=${bodyLength}${SOH}`;
    message += bodyContent;

    // Calculate checksum
    let checksum = 0;
    for (let i = 0; i < message.length; i++) {
      checksum += message.charCodeAt(i);
    }
    checksum = checksum % 256;
    
    // Add checksum (always 3 characters with leading zeros)
    const checksumStr = checksum.toString().padStart(3, '0');
    message += `${FieldTag.CHECK_SUM}=${checksumStr}${SOH}`;
    
    return message;
  };
  
  // Create the builder object with all functions
  const messageBuilder = {
    setMsgType,
    setSenderCompID,
    setTargetCompID,
    setMsgSeqNum,
    addField,
    buildMessage
  };
  
  return messageBuilder;
}

/**
 * Helper functions for creating specific message types
 */

/**
 * Create a logon message
 */
export function createLogonMessage(
  senderCompId: string,
  targetCompId: string,
  username: string,
  password: string,
  resetSeqNum: boolean = true,
  heartBtInt: number = 30
): string {
  const builder = createMessageBuilder();
  
  return builder
    .setMsgType(MessageType.LOGON)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .addField(FieldTag.ENCRYPT_METHOD, DEFAULT_CONNECTION.ENCRYPT_METHOD)
    .addField(FieldTag.HEART_BT_INT, heartBtInt.toString())
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, resetSeqNum ? 'Y' : 'N')
    .addField(FieldTag.USERNAME, username)
    .addField(FieldTag.PASSWORD, password)
    .addField(FieldTag.DEFAULT_APPL_VER_ID, '9')
    .addField('1408', 'FIX5.00_PSX_1.00')
    .buildMessage();
}

/**
 * Create a heartbeat message
 */
export function createHeartbeatMessage(
  senderCompId: string,
  targetCompId: string,
  testReqId?: string
): string {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId);
  
  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }
  
  return builder.buildMessage();
}

/**
 * Create a test request message
 */
export function createTestRequestMessage(
  senderCompId: string,
  targetCompId: string,
  testReqId?: string
): string {
  return createMessageBuilder()
    .setMsgType(MessageType.TEST_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .addField(FieldTag.TEST_REQ_ID, testReqId || new Date().getTime().toString())
    .buildMessage();
}

/**
 * Create a logout message
 */
export function createLogoutMessage(
  senderCompId: string,
  targetCompId: string,
  text?: string
): string {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGOUT)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId);
  
  if (text) {
    builder.addField(FieldTag.TEXT, text);
  }
  
  return builder.buildMessage();
}

/**
 * Create a market data request message
 */
export function createMarketDataRequest(
  senderCompId: string,
  targetCompId: string,
  symbols: string[],
  entryTypes: string[],
  subscriptionType: string,
  marketDepth: number = 0
): string {
  const mdReqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .addField(FieldTag.MD_REQ_ID, mdReqId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
    .addField(FieldTag.MARKET_DEPTH, marketDepth.toString())
    .addField(FieldTag.MD_UPDATE_TYPE, '0') // Full refresh
    .addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
  
  // Add entry types
  for (let i = 0; i < entryTypes.length; i++) {
    builder.addField(FieldTag.MD_ENTRY_TYPE, entryTypes[i]);
  }
  
  // Add symbols
  builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
  for (let i = 0; i < symbols.length; i++) {
    builder.addField(FieldTag.SYMBOL, symbols[i]);
  }
  
  return builder.buildMessage();
}

/**
 * Create a security list request
 */
export function createSecurityListRequest(
  senderCompId: string,
  targetCompId: string,
  securityType?: string
): string {
  const reqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, SecurityListRequestType.ALL_SECURITIES)
    .addField(FieldTag.SECURITY_REQ_ID, reqId);
  
  if (securityType) {
    builder.addField(FieldTag.SECURITY_TYPE, securityType);
  }
  
  return builder.buildMessage();
}

/**
 * Create a trading session status request
 */
export function createTradingSessionStatusRequest(
  senderCompId: string,
  targetCompId: string,
  tradingSessionId?: string
): string {
  const reqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .addField(FieldTag.TRAD_SES_REQ_ID, reqId);
  
  if (tradingSessionId) {
    builder.addField(FieldTag.TRADING_SESSION_ID, tradingSessionId);
  }
  
  return builder.buildMessage();
} 