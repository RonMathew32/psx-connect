import { SOH, FieldTag, MessageType, DEFAULT_CONNECTION } from '../constants';
import { FixClientOptions } from '../types';
import { logger } from '../utils/logger';
import { SequenceManager } from '../utils/sequence-manager';

/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * 
 * @returns Current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * 
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
 * Core message builder interface
 * @param msgType Message type
 * @param senderCompID Sender component ID
 * @param targetCompID Target component ID
 * @param seqNum Message sequence number
 * @param field Tag and value to add to the message
 * @param buildMessage Build the message
 * 
 */
interface MessageBuilder {
  setMsgType(msgType: string): MessageBuilder;
  setSenderCompID(senderCompID: string): MessageBuilder;
  setTargetCompID(targetCompID: string): MessageBuilder;
  setMsgSeqNum(seqNum: number): MessageBuilder;
  addField(tag: string, value: string): MessageBuilder;
  buildMessage(): string;
}

/**
 * Creates a generic FIX message builder
 * 
 * @param beginString Begin string
 * @returns Message builder
 * 
 */
export function createMessageBuilder(beginString: string = 'FIXT.1.1'): MessageBuilder {
  let headerFields: Record<string, string> = {
    [FieldTag.BEGIN_STRING]: beginString,
  };
  let bodyFields: Record<string, string> = {};

  const setMsgType = (msgType: string) => {
    headerFields[FieldTag.MSG_TYPE] = msgType;
    return messageBuilder;
  };

  const setSenderCompID = (senderCompID: string) => {
    headerFields[FieldTag.SENDER_COMP_ID] = senderCompID;
    return messageBuilder;
  };

  const setTargetCompID = (targetCompID: string) => {
    headerFields[FieldTag.TARGET_COMP_ID] = targetCompID;
    return messageBuilder;
  };

  const setMsgSeqNum = (seqNum: number) => {
    headerFields[FieldTag.MSG_SEQ_NUM] = seqNum.toString();
    return messageBuilder;
  };

  const addField = (tag: string, value: string) => {
    bodyFields[tag] = value;
    return messageBuilder;
  };

  const buildMessage = () => {
    if (!headerFields[FieldTag.MSG_TYPE]) {
      throw new Error('Message type is required');
    }

    if (!headerFields[FieldTag.SENDING_TIME]) {
      headerFields[FieldTag.SENDING_TIME] = getCurrentTimestamp();
    }

    const allFields = { ...headerFields, ...bodyFields };

    const sortedTags = Object.keys(allFields).sort((a, b) => {
      const headerOrder: { [key: string]: number } = {
        [FieldTag.BEGIN_STRING]: 1,
        [FieldTag.BODY_LENGTH]: 2,
        [FieldTag.MSG_TYPE]: 3,
        [FieldTag.SENDER_COMP_ID]: 4,
        [FieldTag.TARGET_COMP_ID]: 5,
        [FieldTag.MSG_SEQ_NUM]: 6,
        [FieldTag.SENDING_TIME]: 7,
      };

      if (headerOrder[a] && headerOrder[b]) {
        return headerOrder[a] - headerOrder[b];
      }
      if (headerOrder[a]) return -1;
      if (headerOrder[b]) return 1;
      return parseInt(a) - parseInt(b);
    });

    let bodyContent = '';
    for (const tag of sortedTags) {
      if (tag !== FieldTag.BEGIN_STRING && tag !== FieldTag.BODY_LENGTH) {
        bodyContent += `${tag}=${allFields[tag]}${SOH}`;
      }
    }

    const bodyLength = bodyContent.length;

    let message = `${FieldTag.BEGIN_STRING}=${allFields[FieldTag.BEGIN_STRING]}${SOH}`;
    message += `${FieldTag.BODY_LENGTH}=${bodyLength}${SOH}`;
    message += bodyContent;

    let checksum = 0;
    for (let i = 0; i < message.length; i++) {
      checksum += message.charCodeAt(i);
    }
    checksum = checksum % 256;

    const checksumStr = checksum.toString().padStart(3, '0');
    message += `${FieldTag.CHECK_SUM}=${checksumStr}${SOH}`;

    return message;
  };

  const messageBuilder: MessageBuilder = {
    setMsgType,
    setSenderCompID,
    setTargetCompID,
    setMsgSeqNum,
    addField,
    buildMessage,
  };

  return messageBuilder;
}

/**
 * Creates a Logon message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * 
 */
export function createLogonMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGON)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(1)
    .addField(FieldTag.ENCRYPT_METHOD, DEFAULT_CONNECTION.ENCRYPT_METHOD)
    .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, DEFAULT_CONNECTION.RESET_SEQ_NUM)
    .addField(FieldTag.USERNAME, options.username)
    .addField(FieldTag.PASSWORD, options.password)
    .addField(FieldTag.DEFAULT_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)
    .addField(FieldTag.DEFAULT_CSTM_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_CSTM_APPL_VER_ID);

  return builder;
}

/**
 * Creates a Logout message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param text Text message
 * 
 */
export function createLogoutMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  text?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGOUT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement())
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, DEFAULT_CONNECTION.RESET_SEQ_NUM);

  if (text) {
    builder.addField(FieldTag.TEXT, text);
  }

  return builder;
}

/**
 * Creates a Heartbeat message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param testReqId Test request ID
 * 
 */
export function createHeartbeatMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  testReqId?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement());

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }

  return builder;
}

/**
 * Creates a Test Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param testReqId Test request ID
 * 
 */
export function createTestRequestMessageBuilder(
  options: FixClientOptions,
  testReqId?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TEST_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .addField(FieldTag.MSG_SEQ_NUM, "2");

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }

  return builder;
}

/**
 * Creates a Resend Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param beginSeqNo Message sequence number of first message in range to be resent
 * @param endSeqNo Message sequence number of last message in range to be resent. 
 *                 Use 0 to request all messages after beginSeqNo.
 */
export function createResendRequestMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  beginSeqNo: number,
  endSeqNo: number
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.RESEND_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement())
    .addField(FieldTag.BEGIN_SEQ_NO, beginSeqNo.toString())
    .addField(FieldTag.END_SEQ_NO, endSeqNo.toString());

  return builder;
}

/**
 * Get message type description based on ChannelNo
 * This helps identify the type of message received based on the ChannelNo field
 * @param channelNo The channel number from the FIX message
 * @returns Description of the message type
 */
export function getMessageTypeByChannelNo(channelNo: string): string {
  logger.info(`[SESSION:MESSAGE] Getting message type by channel no: ${channelNo}`);
  const channelNoStr = channelNo.replace('=', '');
  logger.info(`[SESSION:MESSAGE] Channel no string: ${channelNoStr}`);

  const channelNoNum = parseInt(channelNoStr, 10);

  switch (channelNoNum) {
    case 1:
      return 'TradingSessionStatus/SecurityStatus';
    case 2:
      return 'News';
    case 10:
      return 'Index Snapshot';
    case 1011:
      return 'Share Auction Snapshot';
    case 1021:
      return 'Fund Auction Snapshot';
    case 1031:
      return 'Bond Auction Snapshot';
    case 1041:
      return 'Stock Deliverable Future Auction Snapshot';
    case 1051:
      return 'Stock Cash Settled Future Auction Snapshot';
    case 1061:
      return 'Stock Deliverable Option Auction Snapshot';
    case 1071:
      return 'Stock Index Option Auction Snapshot';
    case 1081:
      return 'Stock Index Future Auction Snapshot';
    case 2011:
      return 'Share TickData (tick order message)';
    case 2021:
      return 'Fund TickData (tick execution message)';
    case 2041:
      return 'Stock Deliverable Future TickData';
    case 2051:
      return 'Stock Cash Settled Future TickData';
    case 2061:
      return 'Stock Deliverable Option TickData';
    case 2071:
      return 'Stock Index Option TickData';
    case 2081:
      return 'Stock Index Future TickData';
    case 3011:
      return 'Equities Square Up Snapshot';
    case 3021:
      return 'Odd Lot Snapshot';
    case 3041:
      return 'Futures Square Up Snapshot';
    case 4001:
      return 'Negotiated Deal Market TickData';
    case 4021:
      return 'Odd Lot TickData';
    default:
      return 'Unknown Message Type';
  }
}

export function getMessageTypeName(msgType: string): string {
  // Find the message type name by its value
  for (const [name, value] of Object.entries(MessageType)) {
    if (value === msgType) {
      return name;
    }
  }
  return 'UNKNOWN';
} 