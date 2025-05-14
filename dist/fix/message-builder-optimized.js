"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageBuilder = createMessageBuilder;
exports.createLogonMessage = createLogonMessage;
exports.createHeartbeatMessage = createHeartbeatMessage;
exports.createTestRequestMessage = createTestRequestMessage;
exports.createLogoutMessage = createLogoutMessage;
exports.createMarketDataRequest = createMarketDataRequest;
exports.createSecurityListRequest = createSecurityListRequest;
exports.createTradingSessionStatusRequest = createTradingSessionStatusRequest;
const constants_1 = require("./constants");
const uuid_1 = require("uuid");
/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * Optimized implementation using string concatenation instead of templating
 */
function getCurrentTimestamp() {
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
function createMessageBuilder() {
    // Use objects to store fields for better lookups
    const headerFields = {
        [constants_1.FieldTag.BEGIN_STRING]: 'FIXT.1.1'
    };
    const bodyFields = {};
    /**
     * Sets the message type
     */
    const setMsgType = (msgType) => {
        headerFields[constants_1.FieldTag.MSG_TYPE] = msgType;
        return messageBuilder;
    };
    /**
     * Sets the sender company ID
     */
    const setSenderCompID = (senderCompID) => {
        headerFields[constants_1.FieldTag.SENDER_COMP_ID] = senderCompID;
        return messageBuilder;
    };
    /**
     * Sets the target company ID
     */
    const setTargetCompID = (targetCompID) => {
        headerFields[constants_1.FieldTag.TARGET_COMP_ID] = targetCompID;
        return messageBuilder;
    };
    /**
     * Sets the message sequence number
     */
    const setMsgSeqNum = (seqNum) => {
        headerFields[constants_1.FieldTag.MSG_SEQ_NUM] = seqNum.toString();
        return messageBuilder;
    };
    /**
     * Add a field to the message body
     */
    const addField = (tag, value) => {
        bodyFields[tag] = value;
        return messageBuilder;
    };
    /**
     * Build the complete FIX message
     * Optimized version that uses predefined order for header fields
     */
    const buildMessage = () => {
        // Ensure we have basic required fields
        if (!headerFields[constants_1.FieldTag.MSG_TYPE]) {
            throw new Error('Message type is required');
        }
        // Add sending time if not already set
        if (!headerFields[constants_1.FieldTag.SENDING_TIME]) {
            headerFields[constants_1.FieldTag.SENDING_TIME] = getCurrentTimestamp();
        }
        // Step 1: Build the body content first (excluding BEGIN_STRING and BODY_LENGTH)
        let bodyContent = '';
        // Add message type first (always comes after header)
        bodyContent += constants_1.FieldTag.MSG_TYPE + '=' + headerFields[constants_1.FieldTag.MSG_TYPE] + constants_1.SOH;
        // Add other required header fields in standard order
        if (headerFields[constants_1.FieldTag.SENDER_COMP_ID]) {
            bodyContent += constants_1.FieldTag.SENDER_COMP_ID + '=' + headerFields[constants_1.FieldTag.SENDER_COMP_ID] + constants_1.SOH;
        }
        if (headerFields[constants_1.FieldTag.TARGET_COMP_ID]) {
            bodyContent += constants_1.FieldTag.TARGET_COMP_ID + '=' + headerFields[constants_1.FieldTag.TARGET_COMP_ID] + constants_1.SOH;
        }
        if (headerFields[constants_1.FieldTag.MSG_SEQ_NUM]) {
            bodyContent += constants_1.FieldTag.MSG_SEQ_NUM + '=' + headerFields[constants_1.FieldTag.MSG_SEQ_NUM] + constants_1.SOH;
        }
        if (headerFields[constants_1.FieldTag.SENDING_TIME]) {
            bodyContent += constants_1.FieldTag.SENDING_TIME + '=' + headerFields[constants_1.FieldTag.SENDING_TIME] + constants_1.SOH;
        }
        // Add all body fields sorted by tag number for consistency
        const sortedBodyTags = Object.keys(bodyFields).sort((a, b) => parseInt(a) - parseInt(b));
        for (const tag of sortedBodyTags) {
            bodyContent += tag + '=' + bodyFields[tag] + constants_1.SOH;
        }
        // Step 2: Calculate body length
        const bodyLength = bodyContent.length;
        // Step 3: Build the final message
        let message = constants_1.FieldTag.BEGIN_STRING + '=' + headerFields[constants_1.FieldTag.BEGIN_STRING] + constants_1.SOH;
        message += constants_1.FieldTag.BODY_LENGTH + '=' + bodyLength + constants_1.SOH;
        message += bodyContent;
        // Step 4: Calculate checksum
        let checksum = 0;
        for (let i = 0; i < message.length; i++) {
            checksum += message.charCodeAt(i);
        }
        checksum = checksum % 256;
        // Add checksum (always 3 characters with leading zeros)
        const checksumStr = checksum.toString().padStart(3, '0');
        message += constants_1.FieldTag.CHECK_SUM + '=' + checksumStr + constants_1.SOH;
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
function createLogonMessage(senderCompId, targetCompId, username, password, resetSeqNum = true, heartBtInt = 30, msgSeqNum = 1) {
    const builder = createMessageBuilder();
    return builder
        .setMsgType(constants_1.MessageType.LOGON)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(constants_1.FieldTag.ENCRYPT_METHOD, '0')
        .addField(constants_1.FieldTag.HEART_BT_INT, heartBtInt.toString())
        .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, resetSeqNum ? 'Y' : 'N')
        .addField(constants_1.FieldTag.USERNAME, username)
        .addField(constants_1.FieldTag.PASSWORD, password)
        .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9')
        .addField('1408', 'FIX5.00_PSX_1.00')
        .buildMessage();
}
/**
 * Create a heartbeat message
 */
function createHeartbeatMessage(senderCompId, targetCompId, msgSeqNum, testReqId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.HEARTBEAT)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum);
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
    }
    return builder.buildMessage();
}
/**
 * Create a test request message
 */
function createTestRequestMessage(senderCompId, targetCompId, msgSeqNum, testReqId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.TEST_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId || Date.now().toString())
        .buildMessage();
}
/**
 * Create a logout message
 */
function createLogoutMessage(senderCompId, targetCompId, msgSeqNum, text) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGOUT)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum);
    if (text) {
        builder.addField(constants_1.FieldTag.TEXT, text);
    }
    return builder.buildMessage();
}
/**
 * Create a market data request message
 */
function createMarketDataRequest(senderCompId, targetCompId, msgSeqNum, symbols, entryTypes = ['0', '1'], subscriptionType = '1', marketDepth = 0) {
    const mdReqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(constants_1.FieldTag.MD_REQ_ID, mdReqId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(constants_1.FieldTag.MARKET_DEPTH, marketDepth.toString())
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0'); // Full refresh
    // Add entry types
    builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    for (let i = 0; i < entryTypes.length; i++) {
        builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryTypes[i]);
    }
    // Add symbols
    builder.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
    for (let i = 0; i < symbols.length; i++) {
        builder.addField(constants_1.FieldTag.SYMBOL, symbols[i]);
    }
    return builder.buildMessage();
}
/**
 * Create a security list request
 */
function createSecurityListRequest(senderCompId, targetCompId, msgSeqNum, requestType = '0', // 0 = All Securities
productType, // 4 = EQUITY, 5 = INDEX
sessionId = 'REG') {
    const reqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, reqId)
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, requestType)
        .addField('55', 'NA'); // Symbol = NA
    if (productType) {
        builder.addField('460', productType);
    }
    if (sessionId) {
        builder.addField(constants_1.FieldTag.TRADING_SESSION_ID, sessionId);
    }
    return builder.buildMessage();
}
/**
 * Create a trading session status request
 */
function createTradingSessionStatusRequest(senderCompId, targetCompId, msgSeqNum, tradingSessionId = 'REG') {
    const reqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, reqId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionId);
    return builder.buildMessage();
}
