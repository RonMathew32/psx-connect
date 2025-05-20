"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMarketDataRequestReject = exports.handleReject = exports.handleTradingStatus = exports.handleTradingSessionStatus = exports.handleSecurityList = exports.handleMarketDataIncremental = exports.handleMarketDataSnapshot = exports.handleSequenceError = exports.handleLogout = exports.handleLogon = void 0;
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
function processMarketData(parsedMessage, emitter, type) {
    try {
        logger_1.logger.info(`[MARKET_DATA:${type}] Processing market data...`);
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
        logger_1.logger.info(`[MARKET_DATA:${type}] Processing complete for symbol: ${symbol}`);
    }
    catch (error) {
        logger_1.logger.error(`[MARKET_DATA:${type}] Error handling: ${error instanceof Error ? error.message : String(error)}`);
    }
}
const handleLogon = (message, sequenceManager, emitter, requestedEquitySecurities) => {
    logger_1.logger.info(`[SESSION:LOGON] Processing logon message from server`);
    const wasPreviouslyLoggedIn = requestedEquitySecurities.value;
    requestedEquitySecurities.value = true;
    // Get server's sequence number
    const serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || "1", 10);
    logger_1.logger.info(`[SESSION:LOGON] Server's sequence number: ${serverSeqNum}`);
    // Check if a sequence reset is requested
    const resetFlag = message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === "Y";
    // Process the logon using the sequence manager to ensure correct sequence numbers
    sequenceManager.processLogon(serverSeqNum, resetFlag);
    logger_1.logger.info(`[SESSION:LOGON] Successfully logged in to FIX server with sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
    // Emit event so client can handle login success
    emitter.emit("logon", message);
    // Schedule trading session status request after a short delay
    if (!wasPreviouslyLoggedIn) {
        setTimeout(() => {
            emitter.emit("requestTradingSessionStatus");
        }, 1000);
    }
    logger_1.logger.info(`[SESSION:LOGON] Processing complete`);
};
exports.handleLogon = handleLogon;
const handleLogout = (message, emitter, sequenceManager, requestedEquitySecurities, socket, connect) => {
    logger_1.logger.info(`[SESSION:LOGOUT] Handling logout message`);
    // Get any provided text reason for the logout
    const text = message[constants_1.FieldTag.TEXT];
    // Reset sequence numbers on any logout
    logger_1.logger.info("[SESSION:LOGOUT] Resetting all sequence numbers due to logout");
    sequenceManager.resetAll();
    logger_1.logger.info(`[SESSION:LOGOUT] After reset, sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
    // Reset the requestedEquitySecurities flag so we can request them again after reconnect
    requestedEquitySecurities.value = false;
    logger_1.logger.info("[SESSION:LOGOUT] Reset requestedEquitySecurities flag");
    // Check if this is a sequence number related logout
    if (text &&
        (text.includes("MsgSeqNum") ||
            text.includes("too large") ||
            text.includes("sequence"))) {
        logger_1.logger.warn(`[SESSION:LOGOUT] Received logout due to sequence number issue: ${text}`);
        // Try to parse the expected sequence number from the message
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                logger_1.logger.info(`[SESSION:LOGOUT] Server expects sequence number: ${expectedSeqNum}`);
                // Perform a full disconnect and reconnect with sequence reset
                if (socket) {
                    logger_1.logger.info("[SESSION:LOGOUT] Disconnecting due to sequence number error");
                    socket.destroy();
                    socket = null;
                }
                // Wait a moment before reconnecting
                setTimeout(() => {
                    // Reset sequence numbers to what the server expects
                    sequenceManager.forceReset(expectedSeqNum);
                    logger_1.logger.info(`[SESSION:LOGOUT] Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
                    connect();
                }, 2000);
                return { isSequenceError: true, expectedSeqNum };
            }
            else {
                // If we can't parse the expected sequence number, do a full reset
                logger_1.logger.info("[SESSION:LOGOUT] Cannot parse expected sequence number, performing full reset");
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                setTimeout(() => {
                    // Reset sequence numbers
                    sequenceManager.resetAll();
                    logger_1.logger.info("[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers");
                    connect();
                }, 2000);
                return { isSequenceError: true };
            }
        }
        else {
            // No match found, do a full reset
            logger_1.logger.info("[SESSION:LOGOUT] No expected sequence number found in message, performing full reset");
            if (socket) {
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                // Reset sequence numbers
                sequenceManager.resetAll();
                logger_1.logger.info("[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers");
                connect();
            }, 2000);
            return { isSequenceError: true };
        }
    }
    else {
        // For normal logout (not sequence error), also reset the sequence numbers
        logger_1.logger.info("[SESSION:LOGOUT] Normal logout, sequence numbers reset");
        emitter.emit("logout", message);
        return { isSequenceError: false };
    }
};
exports.handleLogout = handleLogout;
const handleSequenceError = (expectedSeqNum, sequenceManager, socket, connect) => {
    if (expectedSeqNum !== undefined) {
        logger_1.logger.info(`[SEQUENCE:ERROR] Server expects sequence number: ${expectedSeqNum}`);
        // Perform a full disconnect and reconnect with sequence reset
        if (socket) {
            logger_1.logger.info("[SEQUENCE:ERROR] Disconnecting due to sequence number error");
            socket.destroy();
            socket = null;
        }
        // Wait a moment before reconnecting
        setTimeout(() => {
            // Reset sequence numbers to what the server expects for PKF-50 compliance
            logger_1.logger.info(`[SEQUENCE:ERROR] Setting sequence numbers for reconnect:`);
            // For PKF-50, maintain the specialized sequence numbers
            sequenceManager.forceReset(expectedSeqNum);
            // Log all sequence numbers after reset for verification
            const seqNumbers = sequenceManager.getAll();
            logger_1.logger.info(`[SEQUENCE:ERROR] After reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);
            logger_1.logger.info(`[SEQUENCE:ERROR] Reconnecting with adjusted sequence numbers`);
            connect();
        }, 2000);
    }
    else {
        // If we can't parse the expected sequence number, do a full reset
        logger_1.logger.info("[SEQUENCE:ERROR] Cannot determine expected sequence number, performing full reset");
        if (socket) {
            socket.destroy();
            socket = null;
        }
        setTimeout(() => {
            // Reset all sequence numbers to defaults per PKF-50
            sequenceManager.resetAll();
            // Log all sequence numbers after reset for verification
            const seqNumbers = sequenceManager.getAll();
            logger_1.logger.info(`[SEQUENCE:ERROR] After full reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);
            logger_1.logger.info("[SEQUENCE:ERROR] Reconnecting with fully reset sequence numbers");
            connect();
        }, 2000);
    }
};
exports.handleSequenceError = handleSequenceError;
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
        logger_1.logger.info("[SECURITY_LIST] Processing security list...");
        const securities = [];
        const noRelatedSym = parseInt(parsedMessage[constants_1.FieldTag.NO_RELATED_SYM] || "0", 10);
        const product = parsedMessage["460"] || "4"; // Default to EQUITY if not specified
        for (let i = 1; i <= noRelatedSym; i++) {
            const symPrefix = `RELATED SYM ${i}`;
            const symbol = parsedMessage[`${symPrefix}:${constants_1.FieldTag.SYMBOL}`];
            const securityDesc = parsedMessage[`${symPrefix}:${constants_1.FieldTag.SECURITY_DESC}`];
            if (symbol) {
                securities.push({
                    symbol,
                    securityDesc: securityDesc || "",
                    product: product === "5" ? "INDEX" : "EQUITY",
                });
            }
        }
        // Update cache based on product type
        const securityType = product === "5" ? "INDEX" : "EQUITY";
        securityCache[securityType] = securities;
        // Emit events
        emitter.emit("securityList", securities);
        emitter.emit(`${securityType.toLowerCase()}SecurityList`, securities);
        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "SECURITY_LIST",
            type: securityType,
            count: noRelatedSym,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
        logger_1.logger.info(`[SECURITY_LIST:${securityType}] Processing complete for ${noRelatedSym} securities`);
    }
    catch (error) {
        logger_1.logger.error(`[SECURITY_LIST] Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleSecurityList = handleSecurityList;
const handleTradingSessionStatus = (parsedMessage, emitter) => {
    try {
        logger_1.logger.info("[TRADING_STATUS:SESSION] Processing trading session status...");
        const sessionInfo = {
            tradingSessionID: parsedMessage[constants_1.FieldTag.TRADING_SESSION_ID] || "UNKNOWN",
            status: parsedMessage["340"] || "UNKNOWN", // TradSesStatus
            timestamp: parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
        };
        emitter.emit("tradingSessionStatus", sessionInfo);
        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SESSION",
            session: sessionInfo.tradingSessionID,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
        logger_1.logger.info(`[TRADING_STATUS:SESSION] Processing complete for session: ${sessionInfo.tradingSessionID}`);
    }
    catch (error) {
        logger_1.logger.error(`[TRADING_STATUS:SESSION] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleTradingSessionStatus = handleTradingSessionStatus;
const handleTradingStatus = (parsedMessage, emitter) => {
    try {
        logger_1.logger.info("[TRADING_STATUS:SYMBOL] Processing trading status...");
        const statusInfo = {
            symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || "UNKNOWN",
            status: parsedMessage["326"] || "UNKNOWN", // TradingStatus
            timestamp: parsedMessage[constants_1.FieldTag.SENDING_TIME] || new Date().toISOString(),
            origTime: parsedMessage["60"], // TransactTime
        };
        emitter.emit("kseTradingStatus", statusInfo);
        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SYMBOL",
            symbol: statusInfo.symbol,
            status: statusInfo.status,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });
        logger_1.logger.info(`[TRADING_STATUS:SYMBOL] Processing complete for symbol: ${statusInfo.symbol}`);
    }
    catch (error) {
        logger_1.logger.error(`[TRADING_STATUS:SYMBOL] Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
};
exports.handleTradingStatus = handleTradingStatus;
const handleReject = (parsedMessage) => {
    const text = parsedMessage[constants_1.FieldTag.TEXT] || "";
    const isSequenceError = text.includes("MsgSeqNum") ||
        text.includes("too large") ||
        text.includes("sequence");
    if (isSequenceError) {
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                return { isSequenceError: true, expectedSeqNum };
            }
        }
        return { isSequenceError: true };
    }
    return { isSequenceError: false };
};
exports.handleReject = handleReject;
const handleMarketDataRequestReject = (parsedMessage, emitter) => {
    const rejectInfo = {
        requestId: parsedMessage[constants_1.FieldTag.MD_REQ_ID] || "UNKNOWN",
        reason: parsedMessage["58"] || "UNKNOWN", // Text
        text: parsedMessage[constants_1.FieldTag.TEXT],
    };
    emitter.emit("marketDataReject", rejectInfo);
};
exports.handleMarketDataRequestReject = handleMarketDataRequestReject;
