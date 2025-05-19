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
        this.mainSeqNum = 1;
        this.serverSeqNum = 1;
        this.marketDataSeqNum = 1;
        this.securityListSeqNum = 2;
        this.tradingStatusSeqNum = 2;
        logger_1.default.info('[SEQUENCE] Initializing sequence manager with:');
        logger_1.default.info(`[SEQUENCE] Main seq: ${this.mainSeqNum}, Server seq: ${this.serverSeqNum}`);
        logger_1.default.info(`[SEQUENCE] Market data seq: ${this.marketDataSeqNum}, Security list seq: ${this.securityListSeqNum}, Trading status seq: ${this.tradingStatusSeqNum}`);
    }
    /**
     * Reset sequence numbers to a specific value
     * Used when the server expects a specific sequence number
     */
    forceReset(newSeq = 1) {
        logger_1.default.info(`[SEQUENCE] Force resetting all sequence numbers to ${newSeq}`);
        this.mainSeqNum = newSeq;
        this.serverSeqNum = newSeq;
        this.marketDataSeqNum = 1; // Market data always starts at 1
        this.securityListSeqNum = newSeq; // Align security list with main sequence
        this.tradingStatusSeqNum = newSeq; // Align trading status with main sequence
    }
    /**
     * Get the next main sequence number and increment it
     */
    getNextAndIncrement() {
        const current = this.mainSeqNum;
        this.mainSeqNum++;
        logger_1.default.debug(`[SEQUENCE] Main sequence incremented to ${this.mainSeqNum}`);
        return current;
    }
    /**
     * Get the next market data sequence number and increment it
     */
    getNextMarketDataAndIncrement() {
        const current = this.marketDataSeqNum;
        this.marketDataSeqNum++;
        logger_1.default.debug(`[SEQUENCE] Market data sequence incremented to ${this.marketDataSeqNum}`);
        return current;
    }
    /**
     * Get the security list sequence number
     * This should be used when sending security list requests
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
        const current = this.securityListSeqNum;
        this.securityListSeqNum++;
        // Also update main sequence to maintain alignment
        if (this.securityListSeqNum > this.mainSeqNum) {
            this.mainSeqNum = this.securityListSeqNum;
        }
        logger_1.default.debug(`[SEQUENCE] Security list sequence incremented to ${this.securityListSeqNum}`);
        return current;
    }
    /**
     * Get trading status sequence number for incrementing
     * This should be used when sending trading status requests
     */
    getNextTradingStatusAndIncrement() {
        const current = this.tradingStatusSeqNum;
        this.tradingStatusSeqNum++;
        // Also update main sequence to maintain alignment
        if (this.tradingStatusSeqNum > this.mainSeqNum) {
            this.mainSeqNum = this.tradingStatusSeqNum;
        }
        logger_1.default.debug(`[SEQUENCE] Trading status sequence incremented to ${this.tradingStatusSeqNum}`);
        return current;
    }
    /**
     * Get the current main sequence number
     */
    getMainSeqNum() {
        return this.mainSeqNum;
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
    setMarketDataSeqNum(value) {
        const oldSeq = this.marketDataSeqNum;
        this.marketDataSeqNum = value;
        logger_1.default.debug(`[SEQUENCE] Set market data sequence number to ${value}`);
    }
    /**
     * Set the security list sequence number
     */
    setSecurityListSeqNum(value) {
        const oldSeq = this.securityListSeqNum;
        this.securityListSeqNum = value;
        logger_1.default.debug(`[SEQUENCE] Set security list sequence number to ${value}`);
        // Also update the main sequence if needed
        if (value > this.mainSeqNum) {
            logger_1.default.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
            this.mainSeqNum = value;
        }
    }
    /**
     * Set the trading status sequence number
     */
    setTradingStatusSeqNum(value) {
        const oldSeq = this.tradingStatusSeqNum;
        this.tradingStatusSeqNum = value;
        logger_1.default.debug(`[SEQUENCE] Set trading status sequence number to ${value}`);
        // Also update the main sequence if needed
        if (value > this.mainSeqNum) {
            logger_1.default.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
            this.mainSeqNum = value;
        }
    }
    /**
     * Handle sequence number setup after logon
     */
    processLogon(serverSeqNum, resetFlag) {
        this.serverSeqNum = serverSeqNum;
        if (resetFlag) {
            // If reset flag is Y, set our next sequence number to 2
            // (1 for the server's logon acknowledgment, and our next message will be 2)
            this.mainSeqNum = 2;
            this.securityListSeqNum = 2;
            this.tradingStatusSeqNum = 2;
            this.marketDataSeqNum = 1; // MarketData always starts at 1
            logger_1.default.info(`[SEQUENCE] Reset sequence flag is Y, setting sequence numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
        else {
            // If no reset flag, align with server's sequence
            this.mainSeqNum = serverSeqNum + 1;
            this.securityListSeqNum = this.mainSeqNum;
            this.tradingStatusSeqNum = this.mainSeqNum;
            this.marketDataSeqNum = 1; // Always start marketData at 1 after logon
            logger_1.default.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
    }
    /**
     * Update server sequence number based on incoming message
     * Returns true if the sequence was updated
     */
    updateServerSequence(newValue) {
        if (newValue > this.serverSeqNum) {
            logger_1.default.debug(`[SEQUENCE] Updating server sequence from ${this.serverSeqNum} to ${newValue}`);
            this.serverSeqNum = newValue;
            // If server sequence is higher than our sequences, update them
            if (newValue >= this.mainSeqNum) {
                this.mainSeqNum = newValue + 1;
                this.securityListSeqNum = this.mainSeqNum;
                this.tradingStatusSeqNum = this.mainSeqNum;
                logger_1.default.info(`[SEQUENCE] Aligning sequences with server: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}`);
            }
        }
    }
    /**
     * Reset all sequence numbers to initial values
     */
    resetAll() {
        logger_1.default.info('[SEQUENCE] Resetting all sequence numbers to initial values');
        this.mainSeqNum = 1;
        this.serverSeqNum = 1;
        this.marketDataSeqNum = 1;
        this.securityListSeqNum = 2;
        this.tradingStatusSeqNum = 2;
    }
    /**
     * Get all sequence numbers
     */
    getAll() {
        return {
            main: this.mainSeqNum,
            server: this.serverSeqNum,
            marketData: this.marketDataSeqNum,
            securityList: this.securityListSeqNum,
            tradingStatus: this.tradingStatusSeqNum
        };
    }
}
exports.SequenceManager = SequenceManager;
