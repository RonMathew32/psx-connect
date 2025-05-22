"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageBuilder = createMessageBuilder;
exports.createLogonMessageBuilder = createLogonMessageBuilder;
exports.createLogoutMessageBuilder = createLogoutMessageBuilder;
exports.createHeartbeatMessageBuilder = createHeartbeatMessageBuilder;
exports.createMarketDataRequestBuilder = createMarketDataRequestBuilder;
exports.createTradingSessionStatusRequestBuilder = createTradingSessionStatusRequestBuilder;
exports.createSecurityListRequestForEquityBuilder = createSecurityListRequestForEquityBuilder;
exports.createSecurityListRequestForFutBuilder = createSecurityListRequestForFutBuilder;
exports.createSecurityListRequestForIndexBuilder = createSecurityListRequestForIndexBuilder;
exports.createIndexMarketDataRequestBuilder = createIndexMarketDataRequestBuilder;
exports.createSymbolMarketDataSubscriptionBuilder = createSymbolMarketDataSubscriptionBuilder;
exports.getMessageTypeName = getMessageTypeName;
const constants_1 = require("../constants");
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
 * Creates a generic FIX message builder
 */
function createMessageBuilder() {
    let headerFields = {
        [constants_1.FieldTag.BEGIN_STRING]: 'FIXT.1.1',
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
 */
function createLogonMessageBuilder(options, sequenceManager) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(1) // Always use sequence number 1 for initial logon
        .addField(constants_1.FieldTag.ENCRYPT_METHOD, constants_1.DEFAULT_CONNECTION.ENCRYPT_METHOD)
        .addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
        .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y')
        .addField(constants_1.FieldTag.USERNAME, options.username)
        .addField(constants_1.FieldTag.PASSWORD, options.password)
        .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)
        .addField(constants_1.FieldTag.DEFAULT_CSTM_APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_CSTM_APPL_VER_ID);
    return builder;
}
/**
 * Creates a Logout message builder
 */
function createLogoutMessageBuilder(options, sequenceManager, text) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y');
    if (text) {
        builder.addField(constants_1.FieldTag.TEXT, text);
    }
    return builder;
}
/**
 * Creates a Heartbeat message builder
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
 * Creates a Market Data Request message builder
 */
function createMarketDataRequestBuilder(options, sequenceManager, symbols, entryTypes = ['0', '1'], subscriptionType = '1', requestId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextMarketDataAndIncrement())
        .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0')
        .addField(constants_1.FieldTag.NO_PARTY_IDS, '1')
        .addField(constants_1.FieldTag.PARTY_ID, options.partyId || options.senderCompId)
        .addField(constants_1.FieldTag.PARTY_ID_SOURCE, 'D')
        .addField(constants_1.FieldTag.PARTY_ROLE, '3')
        .addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
    symbols.forEach(symbol => {
        builder.addField(constants_1.FieldTag.SYMBOL, symbol);
    });
    builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    for (const entryType of entryTypes) {
        builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
    }
    return builder;
}
/**
 * Creates a Trading Session Status Request message builder
 */
function createTradingSessionStatusRequestBuilder(options, sequenceManager, requestId, tradingSessionID = 'REG') {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextTradingStatusAndIncrement())
        .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0')
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionID);
}
/**
 * Creates a Security List Request message builder for Equity
 */
function createSecurityListRequestForEquityBuilder(options, sequenceManager, requestId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SYMBOL, 'NA')
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '2') // All securities
        .addField(constants_1.FieldTag.PRODUCT, '4') // Futures
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'FUT') // Futures market
        .addField('1128', '9');
}
/**
 * Creates a Security List Request message builder for FUT market
 */
function createSecurityListRequestForFutBuilder(options, sequenceManager, requestId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '4') // 3 = All Securities
        .addField(constants_1.FieldTag.SYMBOL, 'NA') // Symbol is required
        .addField(constants_1.FieldTag.PRODUCT, '5') // 4 = EQUITY as in fixpkf-50
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG') // FUT session
        .addField('207', 'PSX') // SecurityExchange = Pakistan Stock Exchange
        .addField('1128', '9'); // ApplVerID (FIX50SP2 = 9)
}
/**
 * Creates a Security List Request message builder for Index
 */
function createSecurityListRequestForIndexBuilder(options, sequenceManager, requestId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '4')
        .addField(constants_1.FieldTag.SYMBOL, 'NA')
        .addField(constants_1.FieldTag.SECURITY_TYPE, 'FUT')
        .addField(constants_1.FieldTag.PRODUCT, '5')
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG');
}
/**
 * Creates an Index Market Data Request message builder
 */
function createIndexMarketDataRequestBuilder(options, sequenceManager, symbols, requestId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextMarketDataAndIncrement())
        .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0')
        .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0')
        .addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
    symbols.forEach(symbol => {
        builder.addField(constants_1.FieldTag.SYMBOL, symbol);
    });
    builder
        .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1')
        .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3');
    return builder;
}
/**
 * Creates a Symbol Market Data Subscription message builder
 */
function createSymbolMarketDataSubscriptionBuilder(options, sequenceManager, symbols, requestId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextMarketDataAndIncrement())
        .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1')
        .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0')
        .addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
    symbols.forEach(symbol => {
        builder.addField(constants_1.FieldTag.SYMBOL, symbol);
    });
    builder
        .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '3')
        .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '0')
        .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '1')
        .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '2');
    return builder;
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
