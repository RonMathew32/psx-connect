"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleNews = exports.handleMarketDataRequestReject = exports.handleReject = exports.handleTradingStatus = exports.handleTradingSessionStatus = exports.handleSecurityList = exports.handleMarketDataIncremental = exports.handleMarketDataSnapshot = exports.handleLogout = exports.handleLogon = void 0;
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
function processMarketData(parsedMessage, emitter, type) {
    try {
        const marketData = [];
        const symbol = parsedMessage[constants_1.FieldTag.SYMBOL] || 'UNKNOWN';
        const noMDEntries = parseInt(parsedMessage[constants_1.FieldTag.NO_MD_ENTRIES] || '0', 10);
        for (let i = 1; i <= noMDEntries; i++) {
            const entryPrefix = `MD ENTRY ${i}`;
            const entryType = parsedMessage[`${entryPrefix}:${constants_1.FieldTag.MD_ENTRY_TYPE}`];
            const entryPx = parsedMessage[`${entryPrefix}:${constants_1.FieldTag.MD_ENTRY_PX}`];
            const entrySize = parsedMessage[`${entryPrefix}:${constants_1.FieldTag.MD_ENTRY_SIZE}`];
            if (entryType && entryPx) {
                marketData.push({
                    symbol,
                    entryType,
                    price: parseFloat(entryPx),
                    size: entrySize ? parseInt(entrySize, 10) : undefined,
                    timestamp: parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
                });
            }
        }
        if (marketData.length > 0) {
            emitter.emit('marketData', marketData);
            emitter.emit('kseData', marketData);
        }
        emitter.emit('categorizedData', {
            category: 'MARKET_DATA',
            type,
            symbol,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        logger_1.logger.error(`Error handling market data: ${error instanceof Error ? error.message : String(error)}`);
    }
}
const handleLogon = (message, sequenceManager, emitter, requestedEquitySecurities) => {
    logger_1.logger.info(`Processing logon message from server`);
    const wasPreviouslyLoggedIn = requestedEquitySecurities.value;
    requestedEquitySecurities.value = true;
    const serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || "1", 10);
    const resetFlag = message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === "Y";
    sequenceManager.processLogon(serverSeqNum, resetFlag);
    emitter.emit("logon", message);
    if (!wasPreviouslyLoggedIn) {
        setTimeout(() => {
            emitter.emit("requestTradingSessionStatus");
        }, 1000);
    }
};
exports.handleLogon = handleLogon;
const handleLogout = (message, emitter, sequenceManager, requestedEquitySecurities, socket, connect) => {
    logger_1.logger.info(`Handling logout message`);
    const text = message[constants_1.FieldTag.TEXT];
    sequenceManager.resetAll();
    requestedEquitySecurities.value = false;
    if (text &&
        (text.includes("MsgSeqNum") ||
            text.includes("too large") ||
            text.includes("sequence"))) {
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                setTimeout(() => {
                    sequenceManager.forceReset(expectedSeqNum);
                    connect();
                }, 2000);
                return { isSequenceError: true, expectedSeqNum };
            }
        }
        if (socket) {
            socket.destroy();
            socket = null;
        }
        setTimeout(() => {
            sequenceManager.resetAll();
            connect();
        }, 2000);
        return { isSequenceError: true };
    }
    else {
        emitter.emit("logout", message);
        return { isSequenceError: false };
    }
};
exports.handleLogout = handleLogout;
const handleMarketDataSnapshot = (parsedMessage, emitter) => {
    processMarketData(parsedMessage, emitter, 'SNAPSHOT');
};
exports.handleMarketDataSnapshot = handleMarketDataSnapshot;
const handleMarketDataIncremental = (parsedMessage, emitter) => {
    processMarketData(parsedMessage, emitter, 'INCREMENTAL');
};
exports.handleMarketDataIncremental = handleMarketDataIncremental;
const handleSecurityList = (parsedMessage, emitter, securityCache) => {
    try {
        const securities = [];
        const noRelatedSym = parseInt(parsedMessage[constants_1.FieldTag.NO_RELATED_SYM] || "0", 10);
        const product = parsedMessage["460"] || "4";
        const productType = product === "5" ? "INDEX" : "EQUITY";
        const isFinalFragment = parsedMessage[constants_1.FieldTag.LAST_FRAGMENT] === "Y";
        for (let i = 1; i <= noRelatedSym; i++) {
            const symPrefix = `RELATED SYM ${i}`;
            const symbol = parsedMessage[`${symPrefix}:${constants_1.FieldTag.SYMBOL}`];
            const securityDesc = parsedMessage[`${symPrefix}:${constants_1.FieldTag.SECURITY_DESC}`];
            const isin = parsedMessage[`${symPrefix}:${constants_1.FieldTag.ISIN}`] || "";
            const securityId = parsedMessage[`${symPrefix}:${constants_1.FieldTag.SECURITY_ID}`] || "";
            const currency = parsedMessage[`${symPrefix}:${constants_1.FieldTag.CURRENCY}`] || "PKR";
            const issuer = parsedMessage[`${symPrefix}:${constants_1.FieldTag.ISSUER}`] || "";
            const cfiCode = parsedMessage[`${symPrefix}:${constants_1.FieldTag.CFI_CODE}`] || "";
            const securityType = parsedMessage[`${symPrefix}:167`] || "";
            let tradingSessionId = "REG";
            const noTradingSessionRules = parseInt(parsedMessage[`${symPrefix}:1309`] || "0", 10);
            if (noTradingSessionRules > 0) {
                tradingSessionId = parsedMessage[`${symPrefix}:TRD SESS RULES 1:${constants_1.FieldTag.TRADING_SESSION_ID}`] || "REG";
            }
            if (symbol) {
                securities.push({
                    symbol,
                    securityDesc: securityDesc || "",
                    product: productType,
                    isin,
                    securityId,
                    currency,
                    issuer,
                    cfiCode,
                    securityType,
                    tradingSessionId
                });
            }
        }
        if (securities.length > 0) {
            if (isFinalFragment || securityCache[productType].length === 0) {
                securityCache[productType] = securities;
            }
            else {
                securityCache[productType] = [...securityCache[productType], ...securities];
            }
        }
        emitter.emit("securityList", securities);
        emitter.emit(`${productType.toLowerCase()}SecurityList`, securities);
        emitter.emit("categorizedData", {
            category: "SECURITY_LIST",
            type: productType,
            count: noRelatedSym,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        logger_1.logger.error(`Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleSecurityList = handleSecurityList;
const handleTradingSessionStatus = (parsedMessage, emitter) => {
    try {
        const sessionInfo = {
            tradingSessionID: parsedMessage[constants_1.FieldTag.TRADING_SESSION_ID] || "UNKNOWN",
            status: parsedMessage["340"] || "UNKNOWN",
            timestamp: parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
        };
        emitter.emit("tradingSessionStatus", sessionInfo);
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SESSION",
            session: sessionInfo.tradingSessionID,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        logger_1.logger.error(`Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleTradingSessionStatus = handleTradingSessionStatus;
const handleTradingStatus = (parsedMessage, emitter) => {
    try {
        const statusInfo = {
            symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || "UNKNOWN",
            status: parsedMessage["326"] || "UNKNOWN",
            timestamp: parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
            origTime: parsedMessage["60"],
        };
        emitter.emit("kseTradingStatus", statusInfo);
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SYMBOL",
            symbol: statusInfo.symbol,
            status: statusInfo.status,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        logger_1.logger.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleTradingStatus = handleTradingStatus;
const handleReject = (parsedMessage) => {
    const text = parsedMessage[constants_1.FieldTag.TEXT] || "";
    const rejectReasonCode = parsedMessage["373"];
    const refTagId = parsedMessage[constants_1.FieldTag.REF_TAG_ID];
    const refSeqNum = parsedMessage[constants_1.FieldTag.REF_SEQ_NUM];
    let rejectReason = "Unknown reject reason";
    if (rejectReasonCode) {
        switch (rejectReasonCode) {
            case "0":
                rejectReason = "Invalid tag number";
                break;
            case "1":
                rejectReason = "Required tag missing";
                break;
            case "2":
                rejectReason = "Tag not defined for this message type";
                break;
            case "3":
                rejectReason = "Undefined Tag";
                break;
            case "4":
                rejectReason = "Tag specified without a value";
                break;
            case "5":
                rejectReason = "Value is incorrect (out of range) for this tag";
                break;
            case "6":
                rejectReason = "Incorrect data format for value";
                break;
            case "7":
                rejectReason = "Decryption problem";
                break;
            case "8":
                rejectReason = "Signature problem";
                break;
            case "9":
                rejectReason = "CompID problem";
                break;
            case "10":
                rejectReason = "SendingTime accuracy problem";
                break;
            default: rejectReason = `Unknown reject reason code: ${rejectReasonCode}`;
        }
    }
    const isSequenceError = text.includes("MsgSeqNum") ||
        text.includes("too large") ||
        text.includes("sequence");
    if (isSequenceError) {
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                return { isSequenceError: true, expectedSeqNum, rejectReason };
            }
        }
        return { isSequenceError: true, rejectReason };
    }
    return { isSequenceError: false, rejectReason };
};
exports.handleReject = handleReject;
const handleMarketDataRequestReject = (parsedMessage, emitter) => {
    const mdReqId = parsedMessage[constants_1.FieldTag.MD_REQ_ID] || "UNKNOWN";
    const rejReasonCode = parsedMessage[constants_1.FieldTag.MD_REQ_REJ_REASON];
    const text = parsedMessage[constants_1.FieldTag.TEXT];
    let rejReason = "Unknown rejection reason";
    if (rejReasonCode) {
        switch (rejReasonCode) {
            case "0":
                rejReason = "Unknown symbol";
                break;
            case "1":
                rejReason = "Duplicate MDReqID";
                break;
            case "2":
                rejReason = "Insufficient bandwidth";
                break;
            case "3":
                rejReason = "Insufficient permissions";
                break;
            case "4":
                rejReason = "Unsupported SubscriptionRequestType";
                break;
            case "5":
                rejReason = "Unsupported MarketDepth";
                break;
            case "6":
                rejReason = "Unsupported MDUpdateType";
                break;
            case "7":
                rejReason = "Unsupported AggregatedBook";
                break;
            case "8":
                rejReason = "Unsupported MDEntryType";
                break;
            case "9":
                rejReason = "Unsupported TradingSessionID";
                break;
            case "A":
                rejReason = "Unsupported Scope";
                break;
            case "B":
                rejReason = "Unsupported OpenCloseSettleFlag";
                break;
            case "C":
                rejReason = "Unsupported MDImplicitDelete";
                break;
            default: rejReason = `Unknown rejection code: ${rejReasonCode}`;
        }
    }
    const rejectInfo = {
        requestId: mdReqId,
        reasonCode: rejReasonCode,
        reason: rejReason,
        text: text || ""
    };
    emitter.emit("marketDataReject", rejectInfo);
};
exports.handleMarketDataRequestReject = handleMarketDataRequestReject;
const handleNews = (parsedMessage, emitter) => {
    try {
        const newsInfo = {
            headline: parsedMessage[constants_1.FieldTag.HEADLINE] || 'No headline',
            text: parsedMessage[constants_1.FieldTag.TEXT] || 'No text provided',
            urgency: parsedMessage[constants_1.FieldTag.URGENCY] || '1',
            origTime: parsedMessage[constants_1.FieldTag.ORIG_TIME] || parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
            timestamp: new Date().toISOString()
        };
        emitter.emit('news', newsInfo);
        emitter.emit('categorizedData', {
            category: 'NEWS',
            type: 'GENERAL',
            urgency: newsInfo.urgency,
            headline: newsInfo.headline,
            data: parsedMessage,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger_1.logger.error(`Error handling news message: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleNews = handleNews;
