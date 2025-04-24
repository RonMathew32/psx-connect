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
 * Creates a new message builder with utility functions for building FIX messages
 */
function createMessageBuilder() {
    let headerFields = {
        [constants_1.FieldTag.BEGIN_STRING]: 'FIXT.1.1'
    };
    let bodyFields = {};
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
        const allFields = { ...headerFields, ...bodyFields };
        // Convert to string without checksum and body length
        let message = '';
        const sortedTags = Object.keys(allFields).sort((a, b) => {
            // Ensure BEGIN_STRING comes first, then BODY_LENGTH, then MSG_TYPE
            if (a === constants_1.FieldTag.BEGIN_STRING)
                return -1;
            if (b === constants_1.FieldTag.BEGIN_STRING)
                return 1;
            if (a === constants_1.FieldTag.BODY_LENGTH)
                return -1;
            if (b === constants_1.FieldTag.BODY_LENGTH)
                return 1;
            if (a === constants_1.FieldTag.MSG_TYPE)
                return -1;
            if (b === constants_1.FieldTag.MSG_TYPE)
                return 1;
            return parseInt(a) - parseInt(b);
        });
        // First add BEGIN_STRING field
        message += `${constants_1.FieldTag.BEGIN_STRING}=${allFields[constants_1.FieldTag.BEGIN_STRING]}${constants_1.SOH}`;
        // Calculate body content (excluding BEGIN_STRING, BODY_LENGTH, and CHECKSUM)
        let bodyContent = '';
        for (const tag of sortedTags) {
            if (tag !== constants_1.FieldTag.BEGIN_STRING && tag !== constants_1.FieldTag.BODY_LENGTH && tag !== constants_1.FieldTag.CHECK_SUM) {
                bodyContent += `${tag}=${allFields[tag]}${constants_1.SOH}`;
            }
        }
        // Add body length
        const bodyLength = bodyContent.length;
        message += `${constants_1.FieldTag.BODY_LENGTH}=${bodyLength}${constants_1.SOH}`;
        // Add body content
        message += bodyContent;
        // Calculate checksum
        let checksum = 0;
        for (let i = 0; i < message.length; i++) {
            checksum += message.charCodeAt(i);
        }
        checksum = checksum % 256;
        // Add checksum (always 3 characters with leading zeros)
        const checksumStr = checksum.toString().padStart(3, '0');
        message += `${constants_1.FieldTag.CHECK_SUM}=${checksumStr}${constants_1.SOH}`;
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
function createLogonMessage(senderCompId, targetCompId, username, password, resetSeqNum = true, heartBtInt = 30) {
    const builder = createMessageBuilder();
    return builder
        .setMsgType(constants_1.MessageType.LOGON)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .addField(constants_1.FieldTag.ENCRYPT_METHOD, constants_1.DEFAULT_CONNECTION.ENCRYPT_METHOD)
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
function createHeartbeatMessage(senderCompId, targetCompId, testReqId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.HEARTBEAT)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId);
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
    }
    return builder.buildMessage();
}
/**
 * Create a test request message
 */
function createTestRequestMessage(senderCompId, targetCompId, testReqId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.TEST_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId || new Date().getTime().toString())
        .buildMessage();
}
/**
 * Create a logout message
 */
function createLogoutMessage(senderCompId, targetCompId, text) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGOUT)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId);
    if (text) {
        builder.addField(constants_1.FieldTag.TEXT, text);
    }
    return builder.buildMessage();
}
/**
 * Create a market data request message
 */
function createMarketDataRequest(senderCompId, targetCompId, symbols, entryTypes, subscriptionType, marketDepth = 0) {
    const mdReqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .addField(constants_1.FieldTag.MD_REQ_ID, mdReqId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(constants_1.FieldTag.MARKET_DEPTH, marketDepth.toString())
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0') // Full refresh
        .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    // Add entry types
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
function createSecurityListRequest(senderCompId, targetCompId, securityType) {
    const reqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, constants_1.SecurityListRequestType.ALL_SECURITIES)
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, reqId);
    if (securityType) {
        builder.addField(constants_1.FieldTag.SECURITY_TYPE, securityType);
    }
    return builder.buildMessage();
}
/**
 * Create a trading session status request
 */
function createTradingSessionStatusRequest(senderCompId, targetCompId, tradingSessionId) {
    const reqId = (0, uuid_1.v4)();
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(senderCompId)
        .setTargetCompID(targetCompId)
        .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, reqId);
    if (tradingSessionId) {
        builder.addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionId);
    }
    return builder.buildMessage();
}
