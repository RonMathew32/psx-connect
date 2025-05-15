import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { MessageType, FieldTag } from './constants';
import { createMessageBuilder } from './message-builder';
import { SequenceManager } from './sequence-manager';

interface MessageOptions {
  senderCompId: string;
  targetCompId: string;
  username: string;
  password: string;
  heartbeatIntervalSecs: number;
}

/**
 * Create a logon message with the correct sequence number
 */
export function createLogonMessage(options: MessageOptions, seqManager: SequenceManager): string {
  // Always reset sequence number on logon
  seqManager.resetAll();
  logger.info('Resetting sequence numbers to 1 for new logon');

  // Create logon message following fn-psx format
  // First set header fields
  const builder = createMessageBuilder();
  builder
    .setMsgType(MessageType.LOGON)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement()); // Use sequence number 1

  // Then add body fields in the order used by fn-psx
  builder.addField(FieldTag.ENCRYPT_METHOD, '0');
  builder.addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
  builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
  builder.addField(FieldTag.USERNAME, options.username);
  builder.addField(FieldTag.PASSWORD, options.password);
  builder.addField(FieldTag.DEFAULT_APPL_VER_ID, '9');
  builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID

  return builder.buildMessage();
}

/**
 * Create a logout message
 */
export function createLogoutMessage(
  options: MessageOptions, 
  seqManager: SequenceManager,
  text?: string
): string {
  const builder = createMessageBuilder();

  builder
    .setMsgType(MessageType.LOGOUT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement());

  if (text) {
    builder.addField(FieldTag.TEXT, text);
  }

  return builder.buildMessage();
}

/**
 * Create a heartbeat message
 */
export function createHeartbeatMessage(
  options: MessageOptions,
  seqManager: SequenceManager,
  testReqId?: string
): string {
  const builder = createMessageBuilder();

  builder
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement());

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }
  
  return builder.buildMessage();
}

/**
 * Create a test request message
 */
export function createTestRequestMessage(
  options: MessageOptions,
  seqManager: SequenceManager
): string {
  const testReqId = `TEST${Date.now()}`;
  const builder = createMessageBuilder();

  builder
    .setMsgType(MessageType.TEST_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement())
    .addField(FieldTag.TEST_REQ_ID, testReqId);

  return builder.buildMessage();
}

/**
 * Create a trading session status request
 */
export function createTradingSessionStatusRequest(
  options: MessageOptions,
  seqManager: SequenceManager
): { message: string, requestId: string } {
  const requestId = uuidv4();
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement())
    .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
    .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session

  return { message: builder.buildMessage(), requestId };
}

/**
 * Create a security list request for equity securities
 */
export function createEquitySecurityListRequest(
  options: MessageOptions,
  seqManager: SequenceManager
): { message: string, requestId: string } {
  const requestId = uuidv4();
  
  // Create message in the format used by fn-psx project
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextSecurityListAndIncrement());

  // Add required fields in same order as fn-psx
  builder.addField(FieldTag.SECURITY_REQ_ID, requestId);
  builder.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
  builder.addField('55', 'NA'); // Symbol = NA as used in fn-psx
  builder.addField('460', '4'); // Product = EQUITY (4)
  builder.addField('336', 'REG'); // TradingSessionID = REG

  return { message: builder.buildMessage(), requestId };
}

/**
 * Create a security list request for index securities
 */
export function createIndexSecurityListRequest(
  options: MessageOptions,
  seqManager: SequenceManager
): { message: string, requestId: string } {
  const requestId = uuidv4();
  
  // Create message in the format used by fn-psx project
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextSecurityListAndIncrement());

  // Add required fields in same order as fn-psx
  builder.addField(FieldTag.SECURITY_REQ_ID, requestId);
  builder.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
  builder.addField('55', 'NA'); // Symbol = NA as used in fn-psx
  builder.addField('460', '5'); // Product = INDEX (5)
  builder.addField('336', 'REG'); // TradingSessionID = REG

  return { message: builder.buildMessage(), requestId };
}

/**
 * Create a market data request message
 */
export function createMarketDataRequest(
  options: MessageOptions,
  seqManager: SequenceManager,
  symbols: string[],
  entryTypes: string[] = ['0', '1'], // Default: 0 = Bid, 1 = Offer
  subscriptionType: string = '1'     // Default: 1 = Snapshot + Updates
): { message: string, requestId: string } {
  const requestId = uuidv4();
  
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextMarketDataAndIncrement()) // Use dedicated MarketData sequence number
    .addField(FieldTag.MD_REQ_ID, requestId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
    .addField(FieldTag.MARKET_DEPTH, '0')
    .addField(FieldTag.MD_UPDATE_TYPE, '0');

  // Add symbols
  builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
  for (const symbol of symbols) {
    builder.addField(FieldTag.SYMBOL, symbol);
  }

  // Add entry types
  builder.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
  for (const entryType of entryTypes) {
    builder.addField(FieldTag.MD_ENTRY_TYPE, entryType);
  }

  return { message: builder.buildMessage(), requestId };
}

/**
 * Create an index market data request message
 */
export function createIndexMarketDataRequest(
  options: MessageOptions,
  seqManager: SequenceManager,
  symbols: string[]
): { message: string, requestId: string } {
  // For indices we use entry type 3 (Index Value) and subscription type 0 (Snapshot)
  return createMarketDataRequest(
    options,
    seqManager,
    symbols,
    ['3'], // Entry type 3 = Index Value
    '0'    // Subscription type 0 = Snapshot
  );
}

/**
 * Get human-readable name for a message type
 */
export function getMessageTypeName(msgType: string): string {
  // Find the message type name by its value
  for (const [name, value] of Object.entries(MessageType)) {
    if (value === msgType) {
      return name;
    }
  }
  return 'UNKNOWN';
} 