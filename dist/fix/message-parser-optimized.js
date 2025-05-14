"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReject = exports.isTradingSessionStatus = exports.isSecurityList = exports.isMarketDataIncremental = exports.isMarketDataSnapshot = exports.isTestRequest = exports.isHeartbeat = exports.isLogout = exports.isLogon = void 0;
exports.parseFixMessage = parseFixMessage;
exports.isMessageType = isMessageType;
exports.getSenderCompID = getSenderCompID;
exports.getTargetCompID = getTargetCompID;
exports.getMsgSeqNum = getMsgSeqNum;
exports.getTestReqID = getTestReqID;
exports.getMDReqID = getMDReqID;
exports.getRejectText = getRejectText;
exports.getField = getField;
exports.getNumericField = getNumericField;
exports.getDecimalField = getDecimalField;
exports.verifyChecksum = verifyChecksum;
exports.extractRepeatingGroup = extractRepeatingGroup;
const constants_1 = require("./constants");
/**
 * Parse a FIX message string into a tag-value object
 * @param message The raw FIX message string
 * @returns ParsedFixMessage or null if parsing failed
 */
function parseFixMessage(message) {
    try {
        const result = {};
        // Split on SOH character - using precomputed length for performance
        const fields = message.split(constants_1.SOH);
        const length = fields.length;
        // Process each field - optimized loop
        for (let i = 0; i < length; i++) {
            const field = fields[i];
            if (!field)
                continue;
            // Find separator index instead of using split
            const separatorIndex = field.indexOf('=');
            if (separatorIndex > 0) {
                const tag = field.substring(0, separatorIndex);
                const value = field.substring(separatorIndex + 1);
                result[tag] = value;
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }
    catch (error) {
        console.error('Error parsing FIX message:', error);
        return null;
    }
}
/**
 * Check if a message is a specific type - optimized to avoid property lookup inside function
 */
function isMessageType(message, type) {
    return message[constants_1.FieldTag.MSG_TYPE] === type;
}
// Specialized message type checks for common message types
// Using a lookup approach for better performance
const messageTypeCheckers = {
    isLogon: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.LOGON,
    isLogout: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.LOGOUT,
    isHeartbeat: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.HEARTBEAT,
    isTestRequest: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.TEST_REQUEST,
    isMarketDataSnapshot: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH,
    isMarketDataIncremental: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH,
    isSecurityList: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.SECURITY_LIST,
    isTradingSessionStatus: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.TRADING_SESSION_STATUS,
    isReject: (msg) => msg[constants_1.FieldTag.MSG_TYPE] === constants_1.MessageType.REJECT
};
// Export all the type checkers
exports.isLogon = messageTypeCheckers.isLogon, exports.isLogout = messageTypeCheckers.isLogout, exports.isHeartbeat = messageTypeCheckers.isHeartbeat, exports.isTestRequest = messageTypeCheckers.isTestRequest, exports.isMarketDataSnapshot = messageTypeCheckers.isMarketDataSnapshot, exports.isMarketDataIncremental = messageTypeCheckers.isMarketDataIncremental, exports.isSecurityList = messageTypeCheckers.isSecurityList, exports.isTradingSessionStatus = messageTypeCheckers.isTradingSessionStatus, exports.isReject = messageTypeCheckers.isReject;
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
 * Get a field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present
 */
function getField(message, tag, defaultValue = '') {
    return message[tag] || defaultValue;
}
/**
 * Get a numeric field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present or invalid
 */
function getNumericField(message, tag, defaultValue = 0) {
    const value = message[tag];
    if (value === undefined)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
/**
 * Get a decimal field value with error handling
 * @param message The parsed FIX message
 * @param tag The field tag to retrieve
 * @param defaultValue Optional default value if field is not present or invalid
 */
function getDecimalField(message, tag, defaultValue = 0) {
    const value = message[tag];
    if (value === undefined)
        return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}
/**
 * Verify the message checksum
 */
function verifyChecksum(message) {
    // Find the last SOH before the checksum field
    const checksumIndex = message.lastIndexOf('10=');
    if (checksumIndex === -1)
        return false;
    // Find the last SOH before the checksum field
    const lastSOHIndex = message.lastIndexOf(constants_1.SOH, checksumIndex - 1);
    if (lastSOHIndex === -1)
        return false;
    // Calculate the checksum for the part of the message before the checksum field
    const messageBody = message.substring(0, lastSOHIndex + 1);
    let sum = 0;
    const bodyLength = messageBody.length;
    // Optimized loop
    for (let i = 0; i < bodyLength; i++) {
        sum += messageBody.charCodeAt(i);
    }
    const calculatedChecksum = (sum % 256).toString().padStart(3, '0');
    // Extract the checksum from the message - avoid regex for better performance
    const checksumStart = checksumIndex + 3; // Skip "10="
    const checksumEnd = message.indexOf(constants_1.SOH, checksumStart);
    const messageChecksum = checksumEnd !== -1
        ? message.substring(checksumStart, checksumEnd)
        : message.substring(checksumStart);
    return calculatedChecksum === messageChecksum;
}
/**
 * Extract repeating group fields from a FIX message
 * @param message The parsed FIX message
 * @param countTag The tag containing the count of repeating items
 * @param tags Array of tags to extract for each item in the group
 * @returns Array of extracted group items
 */
function extractRepeatingGroup(message, countTag, tags) {
    const count = getNumericField(message, countTag, 0);
    const result = [];
    for (let i = 0; i < count; i++) {
        const groupItem = {};
        // Extract each tag for this group item
        for (const tag of tags) {
            // Try different formats for repeating group fields
            const value = message[`${tag}.${i}`] || message[`${tag}_${i}`];
            if (value !== undefined) {
                groupItem[tag] = value;
            }
        }
        // Only add items that have at least one field
        if (Object.keys(groupItem).length > 0) {
            result.push(groupItem);
        }
    }
    return result;
}
