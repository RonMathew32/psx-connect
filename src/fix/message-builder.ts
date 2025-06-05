import { SOH, FieldTag, MessageType, DEFAULT_CONNECTION } from '../constants';
import { FixClientOptions } from '../types';
import { getCurrentTimestamp } from '../utils/helpers';
import { SequenceManager } from '../utils/sequence-manager';

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

// /**
//  * Creates a Resend Request message builder
//  * 
//  * @param options Fix client options
//  * @param sequenceManager Sequence manager
//  * @param beginSeqNo Message sequence number of first message in range to be resent
//  * @param endSeqNo Message sequence number of last message in range to be resent. 
//  *                 Use 0 to request all messages after beginSeqNo.
//  */
// export function createResendRequestMessageBuilder(
//   options: FixClientOptions,
//   sequenceManager: SequenceManager,
//   beginSeqNo: number,
//   endSeqNo: number
// ): MessageBuilder {
//   const builder = createMessageBuilder()
//     .setMsgType(MessageType.RESEND_REQUEST)
//     .setSenderCompID(options.senderCompId)
//     .setTargetCompID(options.targetCompId)
//     .setMsgSeqNum(sequenceManager.getNextAndIncrement())
//     .addField(FieldTag.BEGIN_SEQ_NO, beginSeqNo.toString())
//     .addField(FieldTag.END_SEQ_NO, endSeqNo.toString());

//   return builder;
// }