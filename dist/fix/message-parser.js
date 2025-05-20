"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFixMessage = parseFixMessage;
exports.isMessageType = isMessageType;
exports.isLogon = isLogon;
exports.isLogout = isLogout;
exports.isHeartbeat = isHeartbeat;
exports.isTestRequest = isTestRequest;
exports.isMarketDataSnapshot = isMarketDataSnapshot;
exports.isMarketDataIncremental = isMarketDataIncremental;
exports.isSecurityList = isSecurityList;
exports.isTradingSessionStatus = isTradingSessionStatus;
exports.isReject = isReject;
exports.getSenderCompID = getSenderCompID;
exports.getTargetCompID = getTargetCompID;
exports.getMsgSeqNum = getMsgSeqNum;
exports.getTestReqID = getTestReqID;
exports.getMDReqID = getMDReqID;
exports.getRejectText = getRejectText;
exports.verifyChecksum = verifyChecksum;
const constants_1 = require("../constants");
/**
 * Parse a FIX message string into a tag-value object
 * @param message The raw FIX message string
 * @returns ParsedFixMessage or null if parsing failed
 */
function parseFixMessage(message) {
    try {
        const result = {};
        // Split on SOH character
        const fields = message.split(constants_1.SOH);
        // Process each field
        for (const field of fields) {
            if (!field)
                continue;
            // Split tag=value
            const separatorIndex = field.indexOf('=');
            if (separatorIndex > 0) {
                const tag = field.substring(0, separatorIndex);
                const value = field.substring(separatorIndex + 1);
                result[tag] = value;
            }
        }
        return result;
    }
    catch (error) {
        console.error('Error parsing FIX message:', error);
        return null;
    }
}
/**
 * Check if a message is a specific type
 */
function isMessageType(message, type) {
    return message[constants_1.FieldTag.MSG_TYPE] === type;
}
/**
 * Check if a message is a logon message
 */
function isLogon(message) {
    return isMessageType(message, constants_1.MessageType.LOGON);
}
/**
 * Check if a message is a logout message
 */
function isLogout(message) {
    return isMessageType(message, constants_1.MessageType.LOGOUT);
}
/**
 * Check if a message is a heartbeat message
 */
function isHeartbeat(message) {
    return isMessageType(message, constants_1.MessageType.HEARTBEAT);
}
/**
 * Check if a message is a test request message
 */
function isTestRequest(message) {
    return isMessageType(message, constants_1.MessageType.TEST_REQUEST);
}
/**
 * Check if a message is a market data snapshot message
 */
function isMarketDataSnapshot(message) {
    return isMessageType(message, constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH);
}
/**
 * Check if a message is a market data incremental refresh message
 */
function isMarketDataIncremental(message) {
    return isMessageType(message, constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH);
}
/**
 * Check if a message is a security list message
 */
function isSecurityList(message) {
    return isMessageType(message, constants_1.MessageType.SECURITY_LIST);
}
/**
 * Check if a message is a trading session status message
 */
function isTradingSessionStatus(message) {
    return isMessageType(message, constants_1.MessageType.TRADING_SESSION_STATUS);
}
/**
 * Check if a message is a reject message
 */
function isReject(message) {
    return isMessageType(message, constants_1.MessageType.REJECT);
}
/**
 * Get the SenderCompID from a message
 */
function getSenderCompID(message) {
    return message[constants_1.FieldTag.SENDER_COMP_ID] || '';
}
/**
 * Get the TargetCompID from a message
 */
function getTargetCompID(message) {
    return message[constants_1.FieldTag.TARGET_COMP_ID] || '';
}
/**
 * Get the MsgSeqNum from a message
 */
function getMsgSeqNum(message) {
    return parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '0', 10);
}
/**
 * Get the TestReqID from a message
 */
function getTestReqID(message) {
    return message[constants_1.FieldTag.TEST_REQ_ID] || '';
}
/**
 * Get the MDReqID from a message
 */
function getMDReqID(message) {
    return message[constants_1.FieldTag.MD_REQ_ID] || '';
}
/**
 * Get error text from a reject message
 */
function getRejectText(message) {
    return message[constants_1.FieldTag.TEXT] || '';
}
/**
 * Verify the message checksum
 */
function verifyChecksum(message) {
    // Find the last SOH before the checksum field
    const lastSOHIndex = message.lastIndexOf(constants_1.SOH, message.lastIndexOf('10=') - 1);
    if (lastSOHIndex === -1)
        return false;
    // Calculate the checksum for the part of the message before the checksum field
    const messageBody = message.substring(0, lastSOHIndex + 1);
    let sum = 0;
    for (let i = 0; i < messageBody.length; i++) {
        sum += messageBody.charCodeAt(i);
    }
    const calculatedChecksum = (sum % 256).toString().padStart(3, '0');
    // Extract the checksum from the message
    const checksumMatch = message.match(/10=(\d{3})/);
    if (!checksumMatch)
        return false;
    const messageChecksum = checksumMatch[1];
    return calculatedChecksum === messageChecksum;
}
