"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageBuilder = createMessageBuilder;
exports.createLogonMessageBuilder = createLogonMessageBuilder;
exports.createLogoutMessageBuilder = createLogoutMessageBuilder;
exports.createHeartbeatMessageBuilder = createHeartbeatMessageBuilder;
exports.createTestRequestMessageBuilder = createTestRequestMessageBuilder;
const constants_1 = require("../constants");
const helpers_1 = require("../utils/helpers");
/**
 * Creates a generic FIX message builder
 *
 * @param beginString Begin string
 * @returns Message builder
 *
 */
function createMessageBuilder(beginString = 'FIXT.1.1') {
    let headerFields = {
        [constants_1.FieldTag.BEGIN_STRING]: beginString,
    };
    let bodyFields = {};
    const setMsgType = (msgType) => {
        headerFields[constants_1.FieldTag.MSG_TYPE] = msgType;
        return messageBuilder;
    };
    const setSenderCompID = (senderCompID) => {
        headerFields[constants_1.FieldTag.SENDER_COMP_ID] = senderCompID;
        return messageBuilder;
    };
    const setTargetCompID = (targetCompID) => {
        headerFields[constants_1.FieldTag.TARGET_COMP_ID] = targetCompID;
        return messageBuilder;
    };
    const setMsgSeqNum = (seqNum) => {
        headerFields[constants_1.FieldTag.MSG_SEQ_NUM] = seqNum.toString();
        return messageBuilder;
    };
    const addField = (tag, value) => {
        bodyFields[tag] = value;
        return messageBuilder;
    };
    const buildMessage = () => {
        if (!headerFields[constants_1.FieldTag.MSG_TYPE]) {
            throw new Error('Message type is required');
        }
        if (!headerFields[constants_1.FieldTag.SENDING_TIME]) {
            headerFields[constants_1.FieldTag.SENDING_TIME] = (0, helpers_1.getCurrentTimestamp)();
        }
        const allFields = { ...headerFields, ...bodyFields };
        const sortedTags = Object.keys(allFields).sort((a, b) => {
            const headerOrder = {
                [constants_1.FieldTag.BEGIN_STRING]: 1,
                [constants_1.FieldTag.BODY_LENGTH]: 2,
                [constants_1.FieldTag.MSG_TYPE]: 3,
                [constants_1.FieldTag.SENDER_COMP_ID]: 4,
                [constants_1.FieldTag.TARGET_COMP_ID]: 5,
                [constants_1.FieldTag.MSG_SEQ_NUM]: 6,
                [constants_1.FieldTag.SENDING_TIME]: 7,
            };
            if (headerOrder[a] && headerOrder[b]) {
                return headerOrder[a] - headerOrder[b];
            }
            if (headerOrder[a])
                return -1;
            if (headerOrder[b])
                return 1;
            return parseInt(a) - parseInt(b);
        });
        let bodyContent = '';
        for (const tag of sortedTags) {
            if (tag !== constants_1.FieldTag.BEGIN_STRING && tag !== constants_1.FieldTag.BODY_LENGTH) {
                bodyContent += `${tag}=${allFields[tag]}${constants_1.SOH}`;
            }
        }
        const bodyLength = bodyContent.length;
        let message = `${constants_1.FieldTag.BEGIN_STRING}=${allFields[constants_1.FieldTag.BEGIN_STRING]}${constants_1.SOH}`;
        message += `${constants_1.FieldTag.BODY_LENGTH}=${bodyLength}${constants_1.SOH}`;
        message += bodyContent;
        let checksum = 0;
        for (let i = 0; i < message.length; i++) {
            checksum += message.charCodeAt(i);
        }
        checksum = checksum % 256;
        const checksumStr = checksum.toString().padStart(3, '0');
        message += `${constants_1.FieldTag.CHECK_SUM}=${checksumStr}${constants_1.SOH}`;
        return message;
    };
    const messageBuilder = {
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
function createLogonMessageBuilder(options) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(1)
        .addField(constants_1.FieldTag.ENCRYPT_METHOD, constants_1.DEFAULT_CONNECTION.ENCRYPT_METHOD)
        .addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
        .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, constants_1.DEFAULT_CONNECTION.RESET_SEQ_NUM)
        .addField(constants_1.FieldTag.USERNAME, options.username)
        .addField(constants_1.FieldTag.PASSWORD, options.password)
        .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)
        .addField(constants_1.FieldTag.DEFAULT_CSTM_APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_CSTM_APPL_VER_ID);
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
function createLogoutMessageBuilder(options, sequenceManager, text) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, constants_1.DEFAULT_CONNECTION.RESET_SEQ_NUM);
    if (text) {
        builder.addField(constants_1.FieldTag.TEXT, text);
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
function createHeartbeatMessageBuilder(options, sequenceManager, testReqId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement());
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
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
function createTestRequestMessageBuilder(options, testReqId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.TEST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.MSG_SEQ_NUM, "2");
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
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
