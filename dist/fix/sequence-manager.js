"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceManager = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Manages sequence numbers for FIX protocol communication
 */
class SequenceManager {
    constructor() {
        this.msgSeqNum = 1;
        this.serverSeqNum = 1;
        this.marketDataSeqNum = 1;
        // SecurityList uses 3 as specified by PSX - this needs to be higher than 2
        this.securityListSeqNum = 2;
        // Trading status uses 3 as well - typically same as security list
        this.tradingStatusSeqNum = 2;
    }
    /**
     * Reset sequence numbers to a specific value
     * Used when the server expects a specific sequence number
     */
    forceReset(newSeq = 2) {
        const oldMain = this.msgSeqNum;
        this.msgSeqNum = newSeq;
        this.serverSeqNum = newSeq - 1;
        // If the new sequence is higher than 3, use it for security list too
        if (newSeq > 3) {
            this.securityListSeqNum = newSeq;
            this.tradingStatusSeqNum = newSeq;
            logger_1.default.info(`[SEQUENCE] Setting security list/trading status sequence to ${newSeq} (higher than default 3)`);
        }
        else {
            // Otherwise use 3 as default for PSX security list messages
            this.securityListSeqNum = 2;
            this.tradingStatusSeqNum = 2;
        }
        this.marketDataSeqNum = newSeq;
        logger_1.default.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldMain} to ${this.msgSeqNum} (server: ${this.serverSeqNum})`);
        logger_1.default.info(`[SEQUENCE] Security list sequence: ${this.securityListSeqNum}, Trading status: ${this.tradingStatusSeqNum}, Market data: ${this.marketDataSeqNum}`);
    }
    /**
     * Get the next main sequence number and increment it
     */
    getNextAndIncrement() {
        return this.msgSeqNum++;
    }
    /**
     * Get the next market data sequence number and increment it
     */
    getNextMarketDataAndIncrement() {
        return this.marketDataSeqNum++;
    }
    /**
     * Get the security list sequence number
     * Starts at 3 for PSX, but can be higher if server has rejected previous messages
     */
    getSecurityListSeqNum() {
        logger_1.default.info(`[SEQUENCE] Getting security list sequence: ${this.securityListSeqNum}`);
        return this.securityListSeqNum;
    }
    /**
     * Get trading status sequence number
     * Starts at 3 for PSX, but can be higher if server has rejected previous messages
     */
    getTradingStatusSeqNum() {
        logger_1.default.info(`[SEQUENCE] Getting trading status sequence: ${this.tradingStatusSeqNum}`);
        return this.tradingStatusSeqNum;
    }
    /**
     * Get security list sequence number for incrementing
     * This should be used when sending security list requests
     */
    getNextSecurityListAndIncrement() {
        // If the main sequence number is higher than 3, use it instead
        // This happens when the server has rejected our sequence 3 messages
        if (this.msgSeqNum > this.securityListSeqNum) {
            const seqNum = this.msgSeqNum;
            this.securityListSeqNum = this.msgSeqNum + 1;
            this.msgSeqNum++;
            logger_1.default.info(`[SEQUENCE] Security list sequence requested - using aligned with main: ${seqNum}`);
            return seqNum;
        }
        logger_1.default.info(`[SEQUENCE] Security list sequence requested - using: ${this.securityListSeqNum}`);
        return this.securityListSeqNum++;
    }
    /**
     * Get trading status sequence number for incrementing
     * This should be used when sending trading status requests
     */
    getNextTradingStatusAndIncrement() {
        // If the main sequence number is higher than our trading status number, use it
        if (this.msgSeqNum > this.tradingStatusSeqNum) {
            const seqNum = this.msgSeqNum;
            this.tradingStatusSeqNum = this.msgSeqNum + 1;
            this.msgSeqNum++;
            logger_1.default.info(`[SEQUENCE] Trading status sequence requested - using aligned with main: ${seqNum}`);
            return seqNum;
        }
        logger_1.default.info(`[SEQUENCE] Trading status sequence requested - using: ${this.tradingStatusSeqNum}`);
        return this.tradingStatusSeqNum++;
    }
    /**
     * Get the current main sequence number
     */
    getMainSeqNum() {
        return this.msgSeqNum;
    }
    /**
     * Get the current server sequence number
     */
    getServerSeqNum() {
        return this.serverSeqNum;
    }
    /**
     * Get the current market data sequence number
     */
    getMarketDataSeqNum() {
        return this.marketDataSeqNum;
    }
    /**
     * Set the market data sequence number
     */
    setMarketDataSeqNum(seqNum) {
        const oldSeq = this.marketDataSeqNum;
        this.marketDataSeqNum = seqNum;
        logger_1.default.info(`[SEQUENCE] Set market data sequence number: ${oldSeq} -> ${this.marketDataSeqNum}`);
    }
    /**
     * Set the security list sequence number
     */
    setSecurityListSeqNum(seqNum) {
        const oldSeq = this.securityListSeqNum;
        this.securityListSeqNum = seqNum;
        logger_1.default.info(`[SEQUENCE] Set security list sequence number: ${oldSeq} -> ${this.securityListSeqNum}`);
        // Also update the main sequence if needed
        if (seqNum > this.msgSeqNum) {
            logger_1.default.info(`[SEQUENCE] Also updating main sequence to ${seqNum} to maintain alignment`);
            this.msgSeqNum = seqNum;
        }
    }
    /**
     * Set the trading status sequence number
     */
    setTradingStatusSeqNum(seqNum) {
        const oldSeq = this.tradingStatusSeqNum;
        this.tradingStatusSeqNum = seqNum;
        logger_1.default.info(`[SEQUENCE] Set trading status sequence number: ${oldSeq} -> ${this.tradingStatusSeqNum}`);
        // Also update the main sequence if needed
        if (seqNum > this.msgSeqNum) {
            logger_1.default.info(`[SEQUENCE] Also updating main sequence to ${seqNum} to maintain alignment`);
            this.msgSeqNum = seqNum;
        }
    }
    /**
     * Handle sequence number setup after logon
     */
    setupAfterLogon(serverSeqNumParam, resetFlag) {
        this.serverSeqNum = serverSeqNumParam;
        // If reset sequence number flag is Y, we should reset our sequence counter to 2
        // (1 for the server's logon acknowledgment, and our next message will be 2)
        if (resetFlag) {
            this.msgSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
            // Security list and trading status start at 3 for PSX
            this.securityListSeqNum = 2;
            this.tradingStatusSeqNum = 2;
            this.marketDataSeqNum = 2; // MarketData starts at 2
            logger_1.default.info(`[SEQUENCE] Reset sequence flag is Y, setting sequence numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
        else {
            // Otherwise, set our next sequence to be one more than the server's
            this.msgSeqNum = this.serverSeqNum + 1;
            // Security list and trading status start at 3 for PSX, but use higher if needed
            this.securityListSeqNum = Math.max(2, this.msgSeqNum);
            this.tradingStatusSeqNum = Math.max(2, this.msgSeqNum);
            this.marketDataSeqNum = this.msgSeqNum;
            logger_1.default.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
    }
    /**
     * Update server sequence number based on incoming message
     * Returns true if the sequence was updated
     */
    updateServerSequence(incomingSeqNum) {
        // For normal messages, track the server's sequence
        this.serverSeqNum = incomingSeqNum;
        logger_1.default.info(`Server sequence number updated to: ${this.serverSeqNum}`);
        // Our next message should be one more than what the server expects
        // The server expects our next message to have a sequence number of serverSeqNum + 1
        if (this.msgSeqNum <= this.serverSeqNum) {
            this.msgSeqNum = this.serverSeqNum + 1;
            logger_1.default.info(`Updated our next sequence number to: ${this.msgSeqNum}`);
            // Make sure security list and trading status are at least 3 and aligned with main if higher
            this.securityListSeqNum = Math.max(2, this.msgSeqNum);
            this.tradingStatusSeqNum = Math.max(2, this.msgSeqNum);
            logger_1.default.info(`Aligned security list (${this.securityListSeqNum}) and trading status (${this.tradingStatusSeqNum}) with main sequence`);
            return true;
        }
        return false;
    }
    /**
     * Reset all sequence numbers to initial values
     */
    resetAll() {
        this.msgSeqNum = 1;
        this.serverSeqNum = 1;
        this.marketDataSeqNum = 1;
        // Security list and trading status use 3 for PSX
        this.securityListSeqNum = 2;
        this.tradingStatusSeqNum = 2;
        logger_1.default.info('[SEQUENCE] All sequence numbers reset to initial values');
        logger_1.default.info(`[SEQUENCE] Main=${this.msgSeqNum}, Server=${this.serverSeqNum}, MarketData=${this.marketDataSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}`);
    }
    /**
     * Get all sequence numbers
     */
    getAll() {
        return {
            main: this.msgSeqNum,
            server: this.serverSeqNum,
            marketData: this.marketDataSeqNum,
            securityList: this.securityListSeqNum,
            tradingStatus: this.tradingStatusSeqNum
        };
    }
}
exports.SequenceManager = SequenceManager;
