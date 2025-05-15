"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAllSequenceNumbers = resetAllSequenceNumbers;
exports.getSequenceNumbers = getSequenceNumbers;
exports.forceResetSequenceNumbers = forceResetSequenceNumbers;
exports.setupSequenceNumbersAfterLogon = setupSequenceNumbersAfterLogon;
exports.updateSequenceNumbersFromServer = updateSequenceNumbersFromServer;
exports.getNextMainSeqNum = getNextMainSeqNum;
exports.getNextMarketDataSeqNum = getNextMarketDataSeqNum;
exports.getNextSecurityListSeqNum = getNextSecurityListSeqNum;
exports.setMarketDataSeqNum = setMarketDataSeqNum;
exports.setSecurityListSeqNum = setSecurityListSeqNum;
exports.getMainSeqNum = getMainSeqNum;
exports.getMarketDataSeqNum = getMarketDataSeqNum;
exports.getSecurityListSeqNum = getSecurityListSeqNum;
exports.getServerSeqNum = getServerSeqNum;
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Helper functions for FIX sequence number management
 */
let mainSeqNum = 1;
let serverSeqNum = 1;
let marketDataSeqNum = 1;
let securityListSeqNum = 2; // Initialize security list with a different number
/**
 * Reset all sequence numbers to their initial values
 */
function resetAllSequenceNumbers() {
    mainSeqNum = 1;
    serverSeqNum = 1;
    marketDataSeqNum = 1;
    securityListSeqNum = 2;
    logger_1.default.info('[SEQUENCE] All sequence numbers reset to initial values');
}
/**
 * Get all current sequence numbers
 */
function getSequenceNumbers() {
    return {
        main: mainSeqNum,
        server: serverSeqNum,
        marketData: marketDataSeqNum,
        securityList: securityListSeqNum
    };
}
/**
 * Force reset of sequence numbers to a specific value
 */
function forceResetSequenceNumbers(newSeq = 2) {
    const oldSeq = mainSeqNum;
    mainSeqNum = newSeq;
    serverSeqNum = newSeq - 1;
    // Ensure security list always has a different sequence number than market data
    securityListSeqNum = newSeq + 1;
    marketDataSeqNum = newSeq;
    logger_1.default.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldSeq} to ${mainSeqNum} (server: ${serverSeqNum})`);
    logger_1.default.info(`[SEQUENCE] Security list sequence set to ${securityListSeqNum}, market data sequence set to ${marketDataSeqNum}`);
}
/**
 * Set up sequence numbers after logon
 */
function setupSequenceNumbersAfterLogon(serverMsgSeqNum, resetFlag) {
    serverSeqNum = serverMsgSeqNum;
    // If reset sequence number flag is Y, we should reset our sequence counter to 2
    // (1 for the server's logon acknowledgment, and our next message will be 2)
    if (resetFlag) {
        mainSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
        // IMPORTANT: Keep SecurityList and MarketData sequence numbers separate
        securityListSeqNum = 3; // SecurityList starts at 3 (different from MarketData)
        marketDataSeqNum = 2; // MarketData starts at 2
        logger_1.default.info(`[SEQUENCE] Reset flag is Y, setting sequence numbers: Main=${mainSeqNum}, SecurityList=${securityListSeqNum}, MarketData=${marketDataSeqNum}`);
    }
    else {
        // Otherwise, set our next sequence to be one more than the server's
        mainSeqNum = serverSeqNum + 1;
        // Ensure SecurityList and MarketData sequence numbers are distinct
        securityListSeqNum = mainSeqNum + 1;
        marketDataSeqNum = mainSeqNum;
        logger_1.default.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${mainSeqNum}, SecurityList=${securityListSeqNum}, MarketData=${marketDataSeqNum}`);
    }
}
/**
 * Update sequence numbers based on an incoming message's sequence number
 */
function updateSequenceNumbersFromServer(incomingSeqNum) {
    // For normal messages, track the server's sequence
    serverSeqNum = incomingSeqNum;
    logger_1.default.info(`Server sequence number updated to: ${serverSeqNum}`);
    // Our next message should be one more than what the server expects
    // The server expects our next message to have a sequence number of serverSeqNum + 1
    if (mainSeqNum <= serverSeqNum) {
        mainSeqNum = serverSeqNum + 1;
        logger_1.default.info(`Updated our next sequence number to: ${mainSeqNum}`);
        return true;
    }
    return false;
}
/**
 * Get main sequence number and increment it
 */
function getNextMainSeqNum() {
    return mainSeqNum++;
}
/**
 * Get market data sequence number and increment it
 */
function getNextMarketDataSeqNum() {
    return marketDataSeqNum++;
}
/**
 * Get security list sequence number and increment it
 */
function getNextSecurityListSeqNum() {
    return securityListSeqNum++;
}
/**
 * Set the market data sequence number
 */
function setMarketDataSeqNum(seqNum) {
    marketDataSeqNum = seqNum;
    logger_1.default.info(`[SEQUENCE] Market data sequence number set to ${marketDataSeqNum}`);
}
/**
 * Set the security list sequence number
 */
function setSecurityListSeqNum(seqNum) {
    securityListSeqNum = seqNum;
    logger_1.default.info(`[SEQUENCE] Security list sequence number set to ${securityListSeqNum}`);
}
/**
 * Get main sequence number without incrementing
 */
function getMainSeqNum() {
    return mainSeqNum;
}
/**
 * Get market data sequence number without incrementing
 */
function getMarketDataSeqNum() {
    return marketDataSeqNum;
}
/**
 * Get security list sequence number without incrementing
 */
function getSecurityListSeqNum() {
    return securityListSeqNum;
}
/**
 * Get server sequence number
 */
function getServerSeqNum() {
    return serverSeqNum;
}
