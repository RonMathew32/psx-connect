"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketCode = void 0;
exports.createMessageBuilder = createMessageBuilder;
exports.createLogonMessageBuilder = createLogonMessageBuilder;
exports.createLogoutMessageBuilder = createLogoutMessageBuilder;
exports.createHeartbeatMessageBuilder = createHeartbeatMessageBuilder;
exports.createTestRequestMessageBuilder = createTestRequestMessageBuilder;
exports.createResendRequestMessageBuilder = createResendRequestMessageBuilder;
exports.createSequenceResetRequestMessageBuilder = createSequenceResetRequestMessageBuilder;
exports.createTradingSessionStatusRequestBuilder = createTradingSessionStatusRequestBuilder;
exports.createSecurityStatusRequestBuilder = createSecurityStatusRequestBuilder;
exports.createMarketDataRequestBuilder = createMarketDataRequestBuilder;
exports.createSecurityListRequestForREGEquityBuilder = createSecurityListRequestForREGEquityBuilder;
exports.createSecurityListRequestForFutEquityBuilder = createSecurityListRequestForFutEquityBuilder;
exports.createSecurityListRequestForRegIndexBuilder = createSecurityListRequestForRegIndexBuilder;
exports.createSecurityListRequestForFutIndexBuilder = createSecurityListRequestForFutIndexBuilder;
exports.createIndexMarketDataRequestBuilder = createIndexMarketDataRequestBuilder;
exports.createSymbolMarketDataSubscriptionBuilder = createSymbolMarketDataSubscriptionBuilder;
exports.createNewsMessageBuilder = createNewsMessageBuilder;
exports.getMessageTypeName = getMessageTypeName;
const constants_1 = require("../constants");
// Market codes from specification
exports.MarketCode = {
    REGULAR: '01',
    BILLS_AND_BOND: '02',
    STOCK_DELIVERABLE_FUTURE: '03',
    STOCK_OPTION: '05',
    INDEX_OPTION: '06',
    STOCK_INDEX_FUTURE: '07',
    ODD_LOT: '08',
    NEGOTIATED_DEAL: '09',
    EQUITIES_SQUARE_UP: '10',
    FUTURES_SQUARE_UP: '12',
    TRADE_RECTIFICATION: '13'
};
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
function createLogonMessageBuilder(options, sequenceManager) {
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
/**
 * Creates a Resend Request message builder
 *
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param beginSeqNo Message sequence number of first message in range to be resent
 * @param endSeqNo Message sequence number of last message in range to be resent.
 *                 Use 0 to request all messages after beginSeqNo.
 */
function createResendRequestMessageBuilder(options, sequenceManager, beginSeqNo, endSeqNo) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.RESEND_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.BEGIN_SEQ_NO, beginSeqNo.toString())
        .addField(constants_1.FieldTag.END_SEQ_NO, endSeqNo.toString());
    return builder;
}
/**
 * Creates a Sequence Reset message builder
 *
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param newSeqNo New sequence number
 * @param gapFill If true, sets GapFillFlag to 'Y', otherwise 'N' or omitted
 * @returns Message builder for Sequence Reset
 *
 */
function createSequenceResetRequestMessageBuilder(options, sequenceManager, newSeqNo, gapFill = false) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.SEQUENCE_RESET)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(sequenceManager.getNextAndIncrement())
        .addField(constants_1.FieldTag.NEW_SEQ_NO, newSeqNo.toString());
    // GapFillFlag is optional, include only if specified
    if (gapFill) {
        builder.addField(constants_1.FieldTag.GAP_FILL_FLAG, constants_1.DEFAULT_CONNECTION.RESET_SEQ_NUM);
    }
    return builder;
}
/**
 * Creates a Trading Session Status Request message builder
 *
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param requestId Request ID
 * @param tradingSessionID Trading session ID
 * @returns Message builder for Trading Session Status Request
 *
 */
function createTradingSessionStatusRequestBuilder(options, sequenceManager, requestId, tradingSessionID = 'REG') {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(2)
        .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionID)
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, "0");
    return builder;
}
/**
 * Creates a Security Status Request message builder
 *
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param requestId Request ID
 * @param symbol Symbol to request status for
 * @returns Message builder for Security Status Request
 *
 */
function createSecurityStatusRequestBuilder(options, sequenceManager, requestId, symbol = "NA") {
    // Current timestamp in FIX format (YYYYMMDD-HH:MM:SS)
    const now = new Date();
    const origTime = now.toISOString().replace(/[-T:Z.]/g, '').substring(0, 8) + '-' +
        now.toISOString().substring(11, 19).replace(/:/g, '');
    // Build a message with fields from the specification
    const builder = createMessageBuilder()
        .setMsgType('f') // Security Status message type
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(2)
        // Add the required fields from the specification
        .addField(constants_1.FieldTag.ORIG_TIME, origTime) // Tag 42: OrigTime
        .addField(constants_1.FieldTag.CHANNEL_NO, '1') // Tag 10201: ChannelNo
        .addField(constants_1.FieldTag.SYMBOL, symbol) // Tag 55: Symbol
        .addField(constants_1.FieldTag.SECURITY_SWITCH_TYPE, '1') // Tag 10203: SecuritySwitchType
        .addField(constants_1.FieldTag.SECURITY_SWITCH_STATUS, 'Y'); // Tag 10204: SecuritySwitchStatus (Y=OPEN)
    return builder;
}
/**
 * Creates a Market Data Request message builder
 */
function createMarketDataRequestBuilder(options, sequenceManager, symbols, entryTypes = ['0', '1', '2', '3', '5', '6', '7', '8', '9', 'B'], subscriptionType = '1', requestId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.MSG_SEQ_NUM, "2")
        .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
        .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
        .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0')
        .addField(constants_1.FieldTag.SYMBOL, 'NA')
        .addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString())
        .addField(constants_1.FieldTag.NO_TRADING_SESSION, '1')
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'FUT');
    // .addField(FieldTag.NO_PARTY_IDS, '1')
    // .addField(FieldTag.PARTY_ID, options.partyId || options.senderCompId)
    // .addField(FieldTag.PARTY_ID_SOURCE, 'D')
    // .addField(FieldTag.PARTY_ROLE, '3')
    builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    for (const entryType of entryTypes) {
        builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
    }
    return builder;
}
/**
 * Creates a Security List Request message builder for REG Equity
 */
function createSecurityListRequestForREGEquityBuilder(options, sequenceManager, requestId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.TRANSACT_TIME, getCurrentTimestamp())
        .addField("15", "008")
        .addField(constants_1.FieldTag.SYMBOL, "NA")
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, "REG")
        .addField(constants_1.FieldTag.PRODUCT, "5")
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
        .addField(constants_1.FieldTag.APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID); // TradingSessionID
}
/**
 * Creates a Security List Request message builder for FUT Equity
 */
function createSecurityListRequestForFutEquityBuilder(options, sequenceManager, requestId) {
    // Build a message with an exact sequence of fields that matches a previously successful message
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.TRANSACT_TIME, getCurrentTimestamp())
        .addField("15", "008")
        .addField(constants_1.FieldTag.SYMBOL, "UPP9")
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, "FUT")
        .addField(constants_1.FieldTag.PRODUCT, "5")
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
        .addField(constants_1.FieldTag.APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID);
    return builder;
}
/**
 * Creates a Security List Request message builder for REG Index
 */
function createSecurityListRequestForRegIndexBuilder(options, sequenceManager, requestId) {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.TRANSACT_TIME, getCurrentTimestamp())
        .addField("15", "008")
        .addField(constants_1.FieldTag.SYMBOL, "UPP9")
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
        .addField(constants_1.FieldTag.TRADING_SESSION_ID, "REG")
        .addField(constants_1.FieldTag.PRODUCT, "4")
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
        .addField(constants_1.FieldTag.APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID);
    return builder;
}
/**
 * Creates a Security List Request message builder for FUT Index
 */
function createSecurityListRequestForFutIndexBuilder(options, sequenceManager, requestId) {
    return createMessageBuilder()
        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST) // Message Type
        .setSenderCompID(options.senderCompId) // Sender Comp ID
        .setTargetCompID(options.targetCompId) // Target Comp ID
        .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement()) // Sequence number
        .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId) // Security Request ID
        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '4') // 4 = All Securities
        .addField(constants_1.FieldTag.SYMBOL, 'NA') // Symbol is required
        .addField(constants_1.FieldTag.PRODUCT, constants_1.ProductType.INDEX) // 4 = EQUITY as in fixpkf-50
        .addField(constants_1.FieldTag.SECURITY_TYPE, constants_1.SecurityType.FUTURE) // FUT session
        .addField(constants_1.FieldTag.SECURITY_EXCHANGE, 'PSX') // SecurityExchange = Pakistan Stock Exchange
        .addField(constants_1.FieldTag.APPL_VER_ID, constants_1.DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID);
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
/**
 * Creates a News message builder
 *
 * The News (B) message is a general free format message used for abnormal situations.
 *
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param headline News headline
 * @param text News text body
 * @param origTime Message originating time (optional, defaults to current time)
 * @param urgency News urgency (optional, defaults to '1' Flash)
 * @returns Message builder for News message
 */
function createNewsMessageBuilder(options, sequenceManager, headline, text, origTime, urgency = '1') {
    const builder = createMessageBuilder()
        .setMsgType(constants_1.MessageType.NEWS)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .addField(constants_1.FieldTag.MSG_SEQ_NUM, "2")
        .addField(constants_1.FieldTag.HEADLINE, headline)
        .addField(constants_1.FieldTag.URGENCY, urgency)
        .addField(constants_1.FieldTag.LINES_OF_TEXT, '1') // Just using 1 line of text for simplicity
        .addField(constants_1.FieldTag.TEXT, text);
    // Add origination time if provided, otherwise it will use the standard sending time
    if (origTime) {
        builder.addField(constants_1.FieldTag.ORIG_TIME, origTime);
    }
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
