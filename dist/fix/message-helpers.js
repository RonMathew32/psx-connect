"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogonMessage = createLogonMessage;
exports.createLogoutMessage = createLogoutMessage;
exports.createHeartbeatMessage = createHeartbeatMessage;
exports.createTestRequestMessage = createTestRequestMessage;
exports.createTradingSessionStatusRequest = createTradingSessionStatusRequest;
exports.createEquitySecurityListRequest = createEquitySecurityListRequest;
exports.createIndexSecurityListRequest = createIndexSecurityListRequest;
exports.createMarketDataRequest = createMarketDataRequest;
exports.createIndexMarketDataRequest = createIndexMarketDataRequest;
exports.getMessageTypeName = getMessageTypeName;
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("./constants");
const message_builder_1 = require("./message-builder");
/**
 * Create a logon message with the correct sequence number
 */
function createLogonMessage(options, seqManager) {
    // Always reset sequence number on logon
    seqManager.resetAll();
    logger_1.default.info('Resetting sequence numbers to 1 for new logon');
    // Create logon message following fn-psx format
    // First set header fields
    const builder = (0, message_builder_1.createMessageBuilder)();
    builder
        .setMsgType(constants_1.MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement()); // Use sequence number 1
    // Then add body fields in the order used by fn-psx
    builder.addField(constants_1.FieldTag.ENCRYPT_METHOD, '0');
    builder.addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
    builder.addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
    builder.addField(constants_1.FieldTag.USERNAME, options.username);
    builder.addField(constants_1.FieldTag.PASSWORD, options.password);
    builder.addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9');
    builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID
    return builder.buildMessage();
}
/**
 * Create a logout message
 */
function createLogoutMessage(options, seqManager, text) {
    const builder = (0, message_builder_1.createMessageBuilder)();
    builder
        .setMsgType(constants_1.MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement());
    if (text) {
        builder.addField(constants_1.FieldTag.TEXT, text);
    }
    return builder.buildMessage();
}
/**
 * Create a heartbeat message
 */
function createHeartbeatMessage(options, seqManager, testReqId) {
    const builder = (0, message_builder_1.createMessageBuilder)();
    builder
        .setMsgType(constants_1.MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement());
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
    }
    return builder.buildMessage();
}
/**
 * Create a test request message
 */
function createTestRequestMessage(options, seqManager) {
    const testReqId = `TEST${Date.now()}`;
    const builder = (0, message_builder_1.createMessageBuilder)();
    builder
        .setMsgType(constants_1.MessageType.TEST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
    return builder.buildMessage();
}
/**
 * Create a trading session status request
 */
function createTradingSessionStatusRequest(options, seqManager) {
    const requestId = (0, uuid_1.v4)();
    const builder = (0, message_builder_1.createMessageBuilder)()
        .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
    return { message: builder.buildMessage(), requestId };
}
/**
 * Create a security list request for equity securities
 */
function createEquitySecurityListRequest(options, seqManager) {
    const requestId = (0, uuid_1.v4)();
    // Create message in the format used by fn-psx project
    const builder = (0, message_builder_1.createMessageBuilder)()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextSecurityListAndIncrement());
    // Add required fields in same order as fn-psx
    builder.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
    builder.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
    builder.addField('55', 'NA'); // Symbol = NA as used in fn-psx
    builder.addField('460', '4'); // Product = EQUITY (4)
    builder.addField('336', 'REG'); // TradingSessionID = REG
    return { message: builder.buildMessage(), requestId };
}
/**
 * Create a security list request for index securities
 */
function createIndexSecurityListRequest(options, seqManager) {
    const requestId = (0, uuid_1.v4)();
    // Create message in the format used by fn-psx project
    const builder = (0, message_builder_1.createMessageBuilder)()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextSecurityListAndIncrement());
    // Add required fields in same order as fn-psx
    builder.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
    builder.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
    builder.addField('55', 'NA'); // Symbol = NA as used in fn-psx
    builder.addField('460', '5'); // Product = INDEX (5)
    builder.addField('336', 'REG'); // TradingSessionID = REG
    return { message: builder.buildMessage(), requestId };
}
/**
 * Create a market data request message
 */
function createMarketDataRequest(options, seqManager, symbols, entryTypes = ['0', '1'], // Default: 0 = Bid, 1 = Offer
subscriptionType = '1' // Default: 1 = Snapshot + Updates
) {
    const requestId = (0, uuid_1.v4)();
    const builder = (0, message_builder_1.createMessageBuilder)()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextMarketDataAndIncrement()) // Use dedicated MarketData sequence number
        .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
    // Add symbols
    builder.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
    for (const symbol of symbols) {
        builder.addField(constants_1.FieldTag.SYMBOL, symbol);
    }
    // Add entry types
    builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    for (const entryType of entryTypes) {
        builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
    }
    return { message: builder.buildMessage(), requestId };
}
/**
 * Create an index market data request message
 */
function createIndexMarketDataRequest(options, seqManager, symbols) {
    // For indices we use entry type 3 (Index Value) and subscription type 0 (Snapshot)
    return createMarketDataRequest(options, seqManager, symbols, ['3'], // Entry type 3 = Index Value
    '0' // Subscription type 0 = Snapshot
    );
}
/**
 * Get human-readable name for a message type
 */
function getMessageTypeName(msgType) {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(constants_1.MessageType)) {
        if (value === msgType) {
            return name;
        }
    }
    return 'UNKNOWN';
}
