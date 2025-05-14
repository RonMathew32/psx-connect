import { SOH, MessageType, FieldTag } from './constants';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * Optimized implementation using string concatenation instead of templating
 */
function getCurrentTimestamp(): string {
  const now = new Date();
  
  const year = now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  const hours = now.getUTCHours().toString().padStart(2, '0');
  const minutes = now.getUTCMinutes().toString().padStart(2, '0');
  const seconds = now.getUTCSeconds().toString().padStart(2, '0');
  const milliseconds = now.getUTCMilliseconds().toString().padStart(3, '0');
  
  return year + month + day + '-' + hours + ':' + minutes + ':' + seconds + '.' + milliseconds;
}

/**
 * Creates a new message builder with utility functions for building FIX messages
 */
export function createMessageBuilder() {
  // Use objects to store fields for better lookups
  const headerFields: Record<string, string> = {
    [FieldTag.BEGIN_STRING]: 'FIXT.1.1'
  };
  
  const bodyFields: Record<string, string> = {};
  
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
   * Optimized version that uses predefined order for header fields
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
    
    // Step 1: Build the body content first (excluding BEGIN_STRING and BODY_LENGTH)
    let bodyContent = '';
    
    // Add message type first (always comes after header)
    bodyContent += FieldTag.MSG_TYPE + '=' + headerFields[FieldTag.MSG_TYPE] + SOH;
    
    // Add other required header fields in standard order
    if (headerFields[FieldTag.SENDER_COMP_ID]) {
      bodyContent += FieldTag.SENDER_COMP_ID + '=' + headerFields[FieldTag.SENDER_COMP_ID] + SOH;
    }
    
    if (headerFields[FieldTag.TARGET_COMP_ID]) {
      bodyContent += FieldTag.TARGET_COMP_ID + '=' + headerFields[FieldTag.TARGET_COMP_ID] + SOH;
    }
    
    if (headerFields[FieldTag.MSG_SEQ_NUM]) {
      bodyContent += FieldTag.MSG_SEQ_NUM + '=' + headerFields[FieldTag.MSG_SEQ_NUM] + SOH;
    }
    
    if (headerFields[FieldTag.SENDING_TIME]) {
      bodyContent += FieldTag.SENDING_TIME + '=' + headerFields[FieldTag.SENDING_TIME] + SOH;
    }
    
    // Add all body fields sorted by tag number for consistency
    const sortedBodyTags = Object.keys(bodyFields).sort((a, b) => parseInt(a) - parseInt(b));
    for (const tag of sortedBodyTags) {
      bodyContent += tag + '=' + bodyFields[tag] + SOH;
    }
    
    // Step 2: Calculate body length
    const bodyLength = bodyContent.length;
    
    // Step 3: Build the final message
    let message = FieldTag.BEGIN_STRING + '=' + headerFields[FieldTag.BEGIN_STRING] + SOH;
    message += FieldTag.BODY_LENGTH + '=' + bodyLength + SOH;
    message += bodyContent;
    
    // Step 4: Calculate checksum
    let checksum = 0;
    for (let i = 0; i < message.length; i++) {
      checksum += message.charCodeAt(i);
    }
    checksum = checksum % 256;
    
    // Add checksum (always 3 characters with leading zeros)
    const checksumStr = checksum.toString().padStart(3, '0');
    message += FieldTag.CHECK_SUM + '=' + checksumStr + SOH;
    
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
 * Create a logon message
 */
export function createLogonMessage(
  senderCompId: string,
  targetCompId: string,
  username: string,
  password: string,
  resetSeqNum: boolean = true,
  heartBtInt: number = 30,
  msgSeqNum: number = 1
): string {
  const builder = createMessageBuilder();
  
  return builder
    .setMsgType(MessageType.LOGON)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum)
    .addField(FieldTag.ENCRYPT_METHOD, '0')
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
  msgSeqNum: number,
  testReqId?: string
): string {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum);
  
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
  msgSeqNum: number,
  testReqId?: string
): string {
  return createMessageBuilder()
    .setMsgType(MessageType.TEST_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum)
    .addField(FieldTag.TEST_REQ_ID, testReqId || Date.now().toString())
    .buildMessage();
}

/**
 * Create a logout message
 */
export function createLogoutMessage(
  senderCompId: string,
  targetCompId: string,
  msgSeqNum: number,
  text?: string
): string {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGOUT)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum);
  
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
  msgSeqNum: number,
  symbols: string[],
  entryTypes: string[] = ['0', '1'],
  subscriptionType: string = '1',
  marketDepth: number = 0
): string {
  const mdReqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum)
    .addField(FieldTag.MD_REQ_ID, mdReqId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
    .addField(FieldTag.MARKET_DEPTH, marketDepth.toString())
    .addField(FieldTag.MD_UPDATE_TYPE, '0'); // Full refresh
  
  // Add entry types
  builder.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
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
  msgSeqNum: number,
  requestType: string = '0', // 0 = All Securities
  productType?: string,  // 4 = EQUITY, 5 = INDEX
  sessionId: string = 'REG'
): string {
  const reqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum)
    .addField(FieldTag.SECURITY_REQ_ID, reqId)
    .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, requestType)
    .addField('55', 'NA'); // Symbol = NA
  
  if (productType) {
    builder.addField('460', productType);
  }
  
  if (sessionId) {
    builder.addField(FieldTag.TRADING_SESSION_ID, sessionId);
  }
  
  return builder.buildMessage();
}

/**
 * Create a trading session status request
 */
export function createTradingSessionStatusRequest(
  senderCompId: string,
  targetCompId: string,
  msgSeqNum: number,
  tradingSessionId: string = 'REG'
): string {
  const reqId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
    .setSenderCompID(senderCompId)
    .setTargetCompID(targetCompId)
    .setMsgSeqNum(msgSeqNum)
    .addField(FieldTag.TRAD_SES_REQ_ID, reqId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
    .addField(FieldTag.TRADING_SESSION_ID, tradingSessionId);
  
  return builder.buildMessage();
} 