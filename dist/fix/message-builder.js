"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageBuilder = createMessageBuilder;
exports.createLogonMessageBuilder = createLogonMessageBuilder;
exports.createLogoutMessageBuilder = createLogoutMessageBuilder;
exports.createHeartbeatMessageBuilder = createHeartbeatMessageBuilder;
exports.createTestRequestMessageBuilder = createTestRequestMessageBuilder;
exports.getMessageTypeByChannelNo = getMessageTypeByChannelNo;
exports.getMessageTypeName = getMessageTypeName;
const constants_1 = require("../constants");
const logger_1 = require("../utils/logger");
/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 *
 * @returns Current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 *
 */
function getCurrentTimestamp() {
    const now = new Date();
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
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
            headerFields[constants_1.FieldTag.SENDING_TIME] = getCurrentTimestamp();
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
/**
 * Get message type description based on ChannelNo
 * This helps identify the type of message received based on the ChannelNo field
 * @param channelNo The channel number from the FIX message
 * @returns Description of the message type
 */
function getMessageTypeByChannelNo(channelNo) {
    logger_1.logger.info(`[SESSION:MESSAGE] Getting message type by channel no: ${channelNo}`);
    const channelNoNum = parseInt(channelNo, 10);
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
function getMessageTypeName(msgType) {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(constants_1.MessageType)) {
        if (value === msgType) {
            return name;
        }
    }
    return 'UNKNOWN';
}
