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
        this.securityListSeqNum = 2; // Initialize with different number for security list
    }
    /**
     * Reset sequence numbers to a specific value
     * Used when the server expects a specific sequence number
     */
    forceReset(newSeq = 2) {
        const oldMain = this.msgSeqNum;
        this.msgSeqNum = newSeq;
        this.serverSeqNum = newSeq - 1;
        // CRITICAL FIX: Always start security list with 2 after reset
        // This ensures it matches server expectations
        this.securityListSeqNum = 2;
        this.marketDataSeqNum = newSeq;
        logger_1.default.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldMain} to ${this.msgSeqNum} (server: ${this.serverSeqNum})`);
        logger_1.default.info(`[SEQUENCE] Security list sequence FIXED to ${this.securityListSeqNum}, market data sequence set to ${this.marketDataSeqNum}`);
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
     * Get the next security list sequence number and increment it
     */
    getNextSecurityListAndIncrement() {
        // CRITICAL FIX: Ensure security list sequence never exceeds msgSeqNum
        // This prevents "sequence too large" errors
        if (this.securityListSeqNum > this.msgSeqNum) {
            logger_1.default.warn(`[SEQUENCE] Fixing security list sequence number (${this.securityListSeqNum}) to match main sequence (${this.msgSeqNum})`);
            this.securityListSeqNum = this.msgSeqNum;
        }
        return this.securityListSeqNum++;
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
     * Get the current security list sequence number
     */
    getSecurityListSeqNum() {
        return this.securityListSeqNum;
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
            // CRITICAL FIX: Always use 2 for securityList
            this.securityListSeqNum = 2; // SecurityList ALWAYS starts at 2 (required by PSX)
            this.marketDataSeqNum = 2; // MarketData starts at 2
            logger_1.default.info(`[SEQUENCE] Reset sequence flag is Y, setting sequence numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
        else {
            // Otherwise, set our next sequence to be one more than the server's
            this.msgSeqNum = this.serverSeqNum + 1;
            // CRITICAL FIX: SecurityList should always be 2 after reset
            this.securityListSeqNum = 2;
            this.marketDataSeqNum = this.msgSeqNum;
            logger_1.default.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, MarketData=${this.marketDataSeqNum}`);
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
        this.securityListSeqNum = 2; // CRITICAL FIX: SecurityList ALWAYS uses 2 as specified by PSX
        logger_1.default.info('[SEQUENCE] All sequence numbers reset to initial values');
        logger_1.default.info(`[SEQUENCE] Main=${this.msgSeqNum}, Server=${this.serverSeqNum}, MarketData=${this.marketDataSeqNum}, SecurityList=${this.securityListSeqNum}`);
    }
    /**
     * Get all sequence numbers
     */
    getAll() {
        return {
            main: this.msgSeqNum,
            server: this.serverSeqNum,
            marketData: this.marketDataSeqNum,
            securityList: this.securityListSeqNum
        };
    }
}
exports.SequenceManager = SequenceManager;
