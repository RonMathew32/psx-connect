"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMarketDataSnapshot = handleMarketDataSnapshot;
exports.handleMarketDataIncremental = handleMarketDataIncremental;
exports.handleSecurityList = handleSecurityList;
exports.handleTradingSessionStatus = handleTradingSessionStatus;
exports.handleReject = handleReject;
exports.handleLogout = handleLogout;
exports.handleMarketDataRequestReject = handleMarketDataRequestReject;
exports.handleTradingStatus = handleTradingStatus;
exports.handleLogon = handleLogon;
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("./constants");
/**
 * Handle a market data snapshot message
 */
function handleMarketDataSnapshot(message, emitter) {
    try {
        // Extract the request ID to identify which request this is responding to
        const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
        const symbol = message[constants_1.FieldTag.SYMBOL];
        logger_1.default.info(`[MARKET_DATA] Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);
        // Process market data entries
        const marketDataItems = [];
        // Check if we have entries
        const noEntries = parseInt(message[constants_1.FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);
        if (noEntries > 0) {
            // Extract entries - in a real implementation, this would be more robust
            // and handle multiple entries properly by parsing groups
            for (let i = 0; i < 100; i++) { // Safe upper limit
                const entryType = message[`${constants_1.FieldTag.MD_ENTRY_TYPE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_TYPE];
                const price = message[`${constants_1.FieldTag.MD_ENTRY_PX}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_PX];
                const size = message[`${constants_1.FieldTag.MD_ENTRY_SIZE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_SIZE];
                if (!entryType)
                    break; // No more entries
                marketDataItems.push({
                    symbol: symbol || '',
                    entryType,
                    price: price ? parseFloat(price) : undefined,
                    size: size ? parseFloat(size) : undefined,
                    timestamp: message[constants_1.FieldTag.SENDING_TIME]
                });
            }
        }
        // Once we've properly parsed the data, emit it
        if (marketDataItems.length > 0) {
            logger_1.default.info(`[MARKET_DATA] Extracted ${marketDataItems.length} market data items for ${symbol}`);
            emitter.emit('marketData', marketDataItems);
            // Check if this is KSE data
            const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
            if (isKseData) {
                logger_1.default.info(`[MARKET_DATA] Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
                emitter.emit('kseData', marketDataItems);
            }
        }
        else {
            // Even if no items were found, emit the raw message for debugging
            logger_1.default.info(`[MARKET_DATA] No market data items extracted, emitting raw message`);
            emitter.emit('marketData', message);
        }
    }
    catch (error) {
        logger_1.default.error(`[MARKET_DATA] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Handle a market data incremental refresh message
 */
function handleMarketDataIncremental(message, emitter) {
    try {
        const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
        logger_1.default.info(`Received market data incremental refresh for request: ${mdReqId}`);
        // Process incremental updates - simplified version
        const marketDataItems = [];
        // Parse the incremental updates and emit an event
        // Real implementation would be more robust
        if (marketDataItems.length > 0) {
            emitter.emit('marketData', marketDataItems);
        }
    }
    catch (error) {
        logger_1.default.error(`Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Handle a security list message
 */
function handleSecurityList(message, emitter, securityCache) {
    logger_1.default.info('[SECURITY_LIST] ===================== SECURITY LIST RESPONSE RECEIVED =====================');
    try {
        // Extract key information
        const reqId = message[constants_1.FieldTag.SECURITY_REQ_ID] || 'unknown';
        const securityReqType = message[constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE];
        const securityType = message[constants_1.FieldTag.SECURITY_TYPE];
        const productType = message['460']; // Product type field
        const securityCount = parseInt(message[constants_1.FieldTag.NO_RELATED_SYM] || '0', 10);
        const messageSeqNum = message[constants_1.FieldTag.MSG_SEQ_NUM] || 'unknown';
        // Log basic information
        logger_1.default.info(`[SECURITY_LIST] Message Sequence Number: ${messageSeqNum}`);
        logger_1.default.info(`[SECURITY_LIST] Request ID: ${reqId}`);
        logger_1.default.info(`[SECURITY_LIST] Product Type: ${productType || 'not specified'}`);
        logger_1.default.info(`[SECURITY_LIST] Security Type: ${securityType || 'not specified'}`);
        logger_1.default.info(`[SECURITY_LIST] Number of Securities: ${securityCount}`);
        // Create security list
        const securities = [];
        // Extract securities using simplified approach
        for (let i = 0; i < 1000; i++) {
            const symbolKey = i === 0 ? constants_1.FieldTag.SYMBOL : `${constants_1.FieldTag.SYMBOL}.${i}`;
            const symbol = message[symbolKey];
            if (!symbol) {
                if (i > 0)
                    break;
                continue;
            }
            const secTypeKey = i === 0 ? constants_1.FieldTag.SECURITY_TYPE : `${constants_1.FieldTag.SECURITY_TYPE}.${i}`;
            const secDescKey = i === 0 ? constants_1.FieldTag.SECURITY_DESC : `${constants_1.FieldTag.SECURITY_DESC}.${i}`;
            const marketIdKey = i === 0 ? constants_1.FieldTag.MARKET_ID : `${constants_1.FieldTag.MARKET_ID}.${i}`;
            const securityInfo = {
                symbol,
                securityType: message[secTypeKey] || '',
                securityDesc: message[secDescKey] || '',
                marketId: message[marketIdKey] || '',
                productType: productType || ''
            };
            securities.push(securityInfo);
        }
        // Look for fields with numeric suffix
        for (const key in message) {
            if (key.startsWith('55.') || key.startsWith('55_')) {
                const symbol = message[key];
                if (!symbol || typeof symbol !== 'string')
                    continue;
                const parts = key.split(/[._]/);
                const index = parts[1];
                if (!index)
                    continue;
                const secTypeKey = `167.${index}` || `167_${index}`;
                const secDescKey = `107.${index}` || `107_${index}`;
                const marketIdKey = `1301.${index}` || `1301_${index}`;
                const securityInfo = {
                    symbol,
                    securityType: message[secTypeKey] || '',
                    securityDesc: message[secDescKey] || '',
                    marketId: message[marketIdKey] || '',
                    productType: productType || ''
                };
                securities.push(securityInfo);
            }
        }
        // Remove duplicates
        const uniqueSecurities = Array.from(new Map(securities.map(s => [s.symbol, s])).values());
        logger_1.default.info(`[SECURITY_LIST] Total unique securities found: ${uniqueSecurities.length}`);
        // Determine list type and store in appropriate cache
        const isEquityList = productType === '4';
        const isIndexList = productType === '5';
        if (uniqueSecurities.length > 0) {
            // Store securities in our cache
            if (isEquityList) {
                logger_1.default.info(`[SECURITY_LIST] Storing ${uniqueSecurities.length} EQUITY securities in cache`);
                securityCache.EQUITY = [...securityCache.EQUITY, ...uniqueSecurities];
                emitter.emit('equitySecurityList', uniqueSecurities);
            }
            else if (isIndexList) {
                logger_1.default.info(`[SECURITY_LIST] Storing ${uniqueSecurities.length} INDEX securities in cache`);
                securityCache.INDEX = [...securityCache.INDEX, ...uniqueSecurities];
                emitter.emit('indexSecurityList', uniqueSecurities);
            }
            // Always emit generic event
            logger_1.default.info(`[SECURITY_LIST] Emitting generic security list event`);
            emitter.emit('securityList', uniqueSecurities);
        }
        else {
            logger_1.default.warn(`[SECURITY_LIST] No securities found in the response`);
            emitter.emit('securityList', []);
        }
    }
    catch (error) {
        logger_1.default.error(`[SECURITY_LIST] Error processing security list: ${error instanceof Error ? error.message : String(error)}`);
        emitter.emit('securityList', []);
    }
    logger_1.default.info('[SECURITY_LIST] ===================== END SECURITY LIST RESPONSE =====================');
}
/**
 * Handle a trading session status message
 */
function handleTradingSessionStatus(message, emitter) {
    try {
        // Log the entire message for debugging
        logger_1.default.info(`[TRADING_STATUS] Raw message content: ${JSON.stringify(message)}`);
        // Extract standard fields
        const reqId = message[constants_1.FieldTag.TRAD_SES_REQ_ID];
        const sessionId = message[constants_1.FieldTag.TRADING_SESSION_ID];
        const status = message[constants_1.FieldTag.TRAD_SES_STATUS];
        const startTime = message[constants_1.FieldTag.START_TIME];
        const endTime = message[constants_1.FieldTag.END_TIME];
        // Detailed logging to troubleshoot missing data
        logger_1.default.info(`[TRADING_STATUS] Received trading session status for request: ${reqId || 'unknown'}`);
        logger_1.default.info(`[TRADING_STATUS] Session ID (Tag 336): ${sessionId || 'undefined'}`);
        logger_1.default.info(`[TRADING_STATUS] Status (Tag 340): ${status || 'undefined'}`);
        logger_1.default.info(`[TRADING_STATUS] Start Time (Tag 341): ${startTime || 'undefined'}`);
        logger_1.default.info(`[TRADING_STATUS] End Time (Tag 342): ${endTime || 'undefined'}`);
        // Add more comprehensive search for fields in different possible locations
        // Alternative field names for PSX-specific formats
        // Some exchanges use non-standard field tags or field locations
        let resolvedSessionId = sessionId;
        let resolvedStatus = status;
        let resolvedStartTime = startTime;
        let resolvedEndTime = endTime;
        // Check all possible tags that might contain session information
        logger_1.default.info(`[TRADING_STATUS] Searching for alternative session status fields...`);
        // Systematically check all fields for relevant information
        for (const [tag, value] of Object.entries(message)) {
            logger_1.default.info(`[TRADING_STATUS] Checking tag ${tag}: ${value}`);
            // Look for session ID in alternative tags
            if (!resolvedSessionId &&
                (tag === '1151' || tag === '1300' || tag === '1301' || tag === '625' ||
                    tag === '336' || tag === '335' || tag === '207')) {
                logger_1.default.info(`[TRADING_STATUS] Found potential session ID in tag ${tag}: ${value}`);
                resolvedSessionId = value;
            }
            // Look for status in alternative tags
            if (!resolvedStatus &&
                (tag === '325' || tag === '326' || tag === '327' || tag === '328' ||
                    tag === '329' || tag === '332' || tag === '339' || tag === '340' ||
                    tag === '5840' || tag === '5841' || tag === '865' || tag === '102')) {
                logger_1.default.info(`[TRADING_STATUS] Found potential status in tag ${tag}: ${value}`);
                resolvedStatus = value;
            }
            // Look for times in alternative tags
            if (!resolvedStartTime &&
                (tag === '341' || tag === '343' || tag === '345' || tag === '345' ||
                    tag === '5894' || tag === '5895' || tag === '5898')) {
                logger_1.default.info(`[TRADING_STATUS] Found potential start time in tag ${tag}: ${value}`);
                resolvedStartTime = value;
            }
            if (!resolvedEndTime &&
                (tag === '342' || tag === '344' || tag === '346' || tag === '347' ||
                    tag === '5899' || tag === '5900' || tag === '5901')) {
                logger_1.default.info(`[TRADING_STATUS] Found potential end time in tag ${tag}: ${value}`);
                resolvedEndTime = value;
            }
        }
        // If Session ID is still missing, try more aggressive approaches
        if (!resolvedSessionId) {
            // Check if we have a MarketID field
            const marketId = message[constants_1.FieldTag.MARKET_ID];
            if (marketId) {
                logger_1.default.info(`[TRADING_STATUS] Using market ID as session ID: ${marketId}`);
                resolvedSessionId = marketId;
            }
            else {
                // Look for any tag with "session" in its name (for debugging)
                const sessionTags = Object.entries(message)
                    .filter(([k, v]) => k.toLowerCase().includes('session') || v.toString().toLowerCase().includes('session'));
                if (sessionTags.length > 0) {
                    logger_1.default.info(`[TRADING_STATUS] Found ${sessionTags.length} tags related to session: ${JSON.stringify(sessionTags)}`);
                    // Use the first one as a last resort
                    if (!resolvedSessionId && sessionTags[0]) {
                        resolvedSessionId = sessionTags[0][1];
                        logger_1.default.info(`[TRADING_STATUS] Using ${sessionTags[0][0]} as session ID: ${resolvedSessionId}`);
                    }
                }
                else {
                    // Last resort - if session ID is '05', we need to extract status properly
                    if (sessionId === '05') {
                        logger_1.default.info(`[TRADING_STATUS] Session ID is '05', which might be a special PSX format`);
                        // For PSX, session ID '05' might indicate a specific market state
                        resolvedSessionId = 'REG'; // Default to Regular market
                        // In this case, the session ID itself might indicate status
                        if (!resolvedStatus) {
                            // "05" might represent a specific session status code in PSX
                            // Map it to a standard FIX session status code
                            logger_1.default.info(`[TRADING_STATUS] Mapping session ID ${sessionId} to status code`);
                            // Use a map to avoid type comparison issues
                            const sessionStatusMap = {
                                '01': '1', // Halted
                                '02': '2', // Open
                                '03': '3', // Closed
                                '04': '4', // Pre-Open
                                '05': '2' // Assume '05' means Open
                            };
                            resolvedStatus = sessionStatusMap[sessionId] || '2'; // Default to Open
                            logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from session ID: ${sessionId}`);
                        }
                    }
                    else {
                        // If all else fails, default to 'REG'
                        logger_1.default.warn(`[TRADING_STATUS] No session ID found, defaulting to 'REG'`);
                        resolvedSessionId = 'REG';
                    }
                }
            }
        }
        // If Status is still missing, try more aggressive approaches
        if (!resolvedStatus) {
            // If TradingSessionSubID exists, try to derive status from it
            const tradingSessionSubID = message['625'];
            if (tradingSessionSubID) {
                if (tradingSessionSubID.includes('OPEN'))
                    resolvedStatus = '2';
                else if (tradingSessionSubID.includes('CLOS'))
                    resolvedStatus = '3';
                else if (tradingSessionSubID.includes('PRE'))
                    resolvedStatus = '4';
                if (resolvedStatus) {
                    logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from TradingSessionSubID: ${tradingSessionSubID}`);
                }
            }
            // Check if text field might indicate status
            const text = message[constants_1.FieldTag.TEXT];
            if (text) {
                if (text.includes('OPEN'))
                    resolvedStatus = '2';
                else if (text.includes('CLOSE'))
                    resolvedStatus = '3';
                else if (text.includes('HALT'))
                    resolvedStatus = '1';
                if (resolvedStatus) {
                    logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from text: ${text}`);
                }
            }
            // Special case for PSX - session ID 05 typically means market is open
            if (sessionId === '05' && !resolvedStatus) {
                logger_1.default.info(`[TRADING_STATUS] Session ID is '05', assuming status is 'Open' (2)`);
                resolvedStatus = '2'; // Assume Open
            }
            // If no status found after all attempts, default to Open (2)
            if (!resolvedStatus) {
                logger_1.default.warn(`[TRADING_STATUS] No status found after all checks, defaulting to 'Open' (2)`);
                resolvedStatus = '2'; // Default to Open
            }
        }
        // Construct session info with resolved values
        const sessionInfo = {
            sessionId: resolvedSessionId || sessionId || 'REG',
            status: resolvedStatus || '2', // Default to Open if still undefined
            startTime: resolvedStartTime,
            endTime: resolvedEndTime
        };
        logger_1.default.info(`[TRADING_STATUS] Final resolved session info: ${JSON.stringify(sessionInfo)}`);
        emitter.emit('tradingSessionStatus', sessionInfo);
        // Log the complete raw message for debugging
        logger_1.default.info(`[TRADING_STATUS] Complete raw message: ${JSON.stringify(message)}`);
    }
    catch (error) {
        logger_1.default.error(`[TRADING_STATUS] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
        // Even if there's an error, try to emit some data
        try {
            const fallbackSessionInfo = {
                sessionId: 'REG',
                status: '2', // Default to Open
                startTime: undefined,
                endTime: undefined
            };
            logger_1.default.warn(`[TRADING_STATUS] Emitting fallback session info due to error: ${JSON.stringify(fallbackSessionInfo)}`);
            emitter.emit('tradingSessionStatus', fallbackSessionInfo);
        }
        catch (fallbackError) {
            logger_1.default.error(`[TRADING_STATUS] Even fallback emission failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
    }
}
/**
 * Handle a reject message from the server
 */
function handleReject(message, emitter) {
    try {
        const refSeqNum = message[constants_1.FieldTag.REF_SEQ_NUM];
        const refTagId = message[constants_1.FieldTag.REF_TAG_ID];
        const text = message[constants_1.FieldTag.TEXT];
        const msgType = message[constants_1.FieldTag.MSG_TYPE];
        logger_1.default.error(`Received REJECT message for sequence number ${refSeqNum}`);
        logger_1.default.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);
        // If it's a sequence number issue, reset the connection
        const isSequenceError = refTagId === '34' ||
            text?.includes('MsgSeqNum') ||
            text?.includes('too large') ||
            text?.includes('sequence');
        let expectedSeqNum = undefined;
        if (isSequenceError) {
            logger_1.default.info('Sequence number mismatch detected, handling sequence reset...');
            // If text contains specific sequence number information, try to parse it
            const expectedSeqNumMatch = text?.match(/expected ['"]?(\d+)['"]?/);
            if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
                expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
                if (!isNaN(expectedSeqNum)) {
                    logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
                }
            }
        }
        // Emit reject event
        emitter.emit('reject', {
            refSeqNum,
            refTagId,
            text,
            msgType
        });
        return {
            isSequenceError,
            expectedSeqNum
        };
    }
    catch (error) {
        logger_1.default.error(`Error handling reject message: ${error instanceof Error ? error.message : String(error)}`);
        return { isSequenceError: false };
    }
}
/**
 * Handle a logout message from the server
 */
function handleLogout(message, emitter) {
    // Get any provided text reason for the logout
    const text = message[constants_1.FieldTag.TEXT];
    // Check if this is a sequence number related logout
    const isSequenceError = Boolean(text && (text.includes('MsgSeqNum') ||
        text.includes('too large') ||
        text.includes('sequence')));
    let expectedSeqNum = undefined;
    if (isSequenceError) {
        logger_1.default.warn(`Received logout due to sequence number issue: ${text}`);
        // Try to parse the expected sequence number from the message
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
            }
        }
    }
    else {
        // Emit logout event for normal logouts
        emitter.emit('logout', message);
    }
    logger_1.default.info('Logged out from FIX server');
    return {
        isSequenceError,
        expectedSeqNum
    };
}
/**
 * Handle market data request reject
 */
function handleMarketDataRequestReject(message, emitter) {
    try {
        const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
        const rejectReason = message[constants_1.FieldTag.MD_REJECT_REASON];
        const text = message[constants_1.FieldTag.TEXT];
        logger_1.default.error(`Market data request rejected for ID: ${mdReqId}`);
        logger_1.default.error(`Reject reason: ${rejectReason}`);
        if (text) {
            logger_1.default.error(`Text: ${text}`);
        }
        // Emit an event so client can handle this
        emitter.emit('marketDataReject', {
            requestId: mdReqId,
            reason: rejectReason,
            text: text
        });
    }
    catch (error) {
        logger_1.default.error(`Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Handle a trading status message - specific format for PSX
 */
function handleTradingStatus(message, emitter) {
    try {
        const symbol = message[constants_1.FieldTag.SYMBOL];
        const sendingTime = message[constants_1.FieldTag.SENDING_TIME];
        const origTime = message['42']; // OrigTime
        const tradingStatus = message['102']; // Trading Status
        logger_1.default.info(`Received TRADING STATUS for ${symbol}:`);
        logger_1.default.info(`  Status: ${tradingStatus}`);
        logger_1.default.info(`  Time: ${sendingTime} (Orig: ${origTime})`);
        // Check if this is KSE data
        const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
        if (isKseData) {
            // Emit a KSE trading status event
            emitter.emit('kseTradingStatus', {
                symbol,
                status: tradingStatus,
                timestamp: sendingTime,
                origTime
            });
            // Convert to a market data item format for compatibility
            const marketDataItems = [{
                    symbol: symbol || '',
                    entryType: 'f', // Trading status as entry type
                    price: tradingStatus ? parseFloat(tradingStatus) : undefined,
                    timestamp: sendingTime
                }];
            // Also emit as KSE data for backward compatibility
            emitter.emit('kseData', marketDataItems);
        }
    }
    catch (error) {
        logger_1.default.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Handle a logon message from the server
 */
function handleLogon(message, seqManager, emitter) {
    // Get server's sequence number
    const serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
    // Setup sequence numbers based on whether reset flag is set
    const resetFlag = message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === 'Y';
    seqManager.processLogon(serverSeqNum, resetFlag);
    logger_1.default.info(`Successfully logged in to FIX server. Server sequence: ${serverSeqNum}, Next sequence: ${seqManager.getAll().main}`);
    // Emit event so client can handle login success
    emitter.emit('logon', message);
}
