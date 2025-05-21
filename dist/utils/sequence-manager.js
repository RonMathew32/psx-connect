"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceManager = void 0;
const logger_1 = require("../utils/logger");
const sequence_store_1 = require("./sequence-store");
/**
 * Manages sequence numbers for FIX protocol communication
 */
class SequenceManager {
    constructor(initialSeq) {
        this.serverSeqNum = 1;
        this.sequenceStore = new sequence_store_1.SequenceStore();
        // Try to load sequence numbers from stored file if it exists
        const storedSequences = this.sequenceStore.loadSequences();
        if (storedSequences) {
            logger_1.logger.info('[SEQUENCE] Loaded sequence numbers from store for current day');
            this.mainSeqNum = storedSequences.main;
            this.serverSeqNum = storedSequences.server;
            this.marketDataSeqNum = storedSequences.marketData;
            this.securityListSeqNum = storedSequences.securityList;
            this.tradingStatusSeqNum = storedSequences.tradingStatus;
        }
        else {
            // If no stored sequences or explicitly provided, use defaults or provided values
            this.mainSeqNum = initialSeq?.main ?? 1;
            this.marketDataSeqNum = initialSeq?.marketData ?? 1;
            this.securityListSeqNum = initialSeq?.securityList ?? 2;
            this.tradingStatusSeqNum = initialSeq?.tradingStatus ?? 2;
        }
        logger_1.logger.info('[SEQUENCE] Initializing sequence manager with:', this.getAll());
    }
    /**
     * Reset sequence numbers to a specific value
     * Used when the server expects a specific sequence number
     */
    forceReset(newSeq = 1) {
        logger_1.logger.info(`[SEQUENCE] Force resetting all sequence numbers to ${newSeq}`);
        this.mainSeqNum = newSeq;
        this.serverSeqNum = newSeq;
        this.marketDataSeqNum = newSeq; // Changed from 1 to newSeq
        this.securityListSeqNum = newSeq; // Align security list with main sequence
        this.tradingStatusSeqNum = newSeq; // Align trading status with main sequence
        // Store the updated sequence numbers
        this.saveToStore();
    }
    /**
     * Get the next main sequence number and increment it
     */
    getNextAndIncrement() {
        const current = this.mainSeqNum;
        this.mainSeqNum++;
        logger_1.logger.debug(`[SEQUENCE] Main sequence incremented to ${this.mainSeqNum}`);
        // Store updated sequence numbers after increment
        this.saveToStore();
        return current;
    }
    /**
     * Get the next market data sequence number and increment it
     */
    getNextMarketDataAndIncrement() {
        const current = this.marketDataSeqNum;
        this.marketDataSeqNum++;
        logger_1.logger.debug(`[SEQUENCE] Market data sequence incremented to ${this.marketDataSeqNum}`);
        // Store updated sequence numbers after increment
        this.saveToStore();
        return current;
    }
    /**
     * Get the security list sequence number
     * This should be used when sending security list requests
     */
    getSecurityListSeqNum() {
        logger_1.logger.info(`[SEQUENCE] Getting security list sequence: ${this.securityListSeqNum}`);
        return this.securityListSeqNum;
    }
    /**
     * Get trading status sequence number
     */
    getTradingStatusSeqNum() {
        logger_1.logger.info(`[SEQUENCE] Getting trading status sequence: ${this.tradingStatusSeqNum}`);
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
        logger_1.logger.debug(`[SEQUENCE] Security list sequence incremented to ${this.securityListSeqNum}`);
        // Store updated sequence numbers after increment
        this.saveToStore();
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
        logger_1.logger.debug(`[SEQUENCE] Trading status sequence incremented to ${this.tradingStatusSeqNum}`);
        // Store updated sequence numbers after increment
        this.saveToStore();
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
        logger_1.logger.debug(`[SEQUENCE] Set market data sequence number to ${value}`);
        // Store updated sequence numbers
        this.saveToStore();
    }
    /**
     * Set the security list sequence number
     */
    setSecurityListSeqNum(value) {
        const oldSeq = this.securityListSeqNum;
        this.securityListSeqNum = value;
        logger_1.logger.debug(`[SEQUENCE] Set security list sequence number to ${value}`);
        // Also update the main sequence if needed
        if (value > this.mainSeqNum) {
            logger_1.logger.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
            this.mainSeqNum = value;
        }
        // Store updated sequence numbers
        this.saveToStore();
    }
    /**
     * Set the trading status sequence number
     */
    setTradingStatusSeqNum(value) {
        const oldSeq = this.tradingStatusSeqNum;
        this.tradingStatusSeqNum = value;
        logger_1.logger.debug(`[SEQUENCE] Set trading status sequence number to ${value}`);
        // Also update the main sequence if needed
        if (value > this.mainSeqNum) {
            logger_1.logger.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
            this.mainSeqNum = value;
        }
        // Store updated sequence numbers
        this.saveToStore();
    }
    /**
     * Handle sequence number setup after logon
     */
    processLogon(serverSeqNum, resetFlag) {
        this.serverSeqNum = serverSeqNum;
        if (resetFlag) {
            // If reset flag is Y, set our next sequence number to 1
            this.mainSeqNum = 1;
            this.securityListSeqNum = 2;
            this.tradingStatusSeqNum = 2;
            this.marketDataSeqNum = 1;
            logger_1.logger.info(`[SEQUENCE] Reset sequence flag is Y, setting all sequence numbers to 1`);
        }
        else {
            // If no reset flag, align with server's sequence
            this.mainSeqNum = serverSeqNum + 1;
            this.securityListSeqNum = this.mainSeqNum;
            this.tradingStatusSeqNum = this.mainSeqNum;
            this.marketDataSeqNum = 1; // Always start marketData at 1 after logon
            logger_1.logger.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
        }
        // Store updated sequence numbers after logon
        this.saveToStore();
    }
    /**
     * Update server sequence number based on incoming message
     * Returns true if the sequence was updated
     */
    updateServerSequence(newValue) {
        if (newValue > this.serverSeqNum) {
            logger_1.logger.debug(`[SEQUENCE] Updating server sequence from ${this.serverSeqNum} to ${newValue}`);
            this.serverSeqNum = newValue;
            // If server sequence is higher than our sequences, update them
            if (newValue >= this.mainSeqNum) {
                this.mainSeqNum = newValue + 1;
                this.securityListSeqNum = this.mainSeqNum;
                this.tradingStatusSeqNum = this.mainSeqNum;
                logger_1.logger.info(`[SEQUENCE] Aligning sequences with server: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}`);
            }
            // Store updated sequence numbers
            this.saveToStore();
        }
    }
    /**
     * Reset all sequence numbers to initial values (1)
     */
    resetAll() {
        logger_1.logger.info('[SEQUENCE] Resetting all sequence numbers to 1');
        this.mainSeqNum = 1;
        this.serverSeqNum = 1;
        this.marketDataSeqNum = 1;
        this.securityListSeqNum = 2;
        this.tradingStatusSeqNum = 2;
        // Store reset sequence numbers
        this.saveToStore();
    }
    /**
     * Reset regular sequence without affecting other streams
     */
    resetRegularSequence(mainSeq = 1, serverSeq = 1) {
        logger_1.logger.info(`[SEQUENCE] Resetting regular sequence: main=${mainSeq}, server=${serverSeq}`);
        this.mainSeqNum = mainSeq;
        this.serverSeqNum = serverSeq;
        this.saveToStore();
    }
    /**
     * Reset market data sequence without affecting other streams
     */
    resetMarketDataSequence(seqNum = 1, serverSeq = 1) {
        logger_1.logger.info(`[SEQUENCE] Resetting market data sequence to ${seqNum}`);
        this.marketDataSeqNum = seqNum;
        this.saveToStore();
    }
    /**
     * Reset security list sequence without affecting other streams
     */
    resetSecurityListSequence(seqNum = 1, serverSeq = 1) {
        logger_1.logger.info(`[SEQUENCE] Resetting security list sequence to ${seqNum}`);
        this.securityListSeqNum = seqNum;
        // Also update main sequence if needed
        if (seqNum > this.mainSeqNum) {
            logger_1.logger.info(`[SEQUENCE] Also updating main sequence to ${seqNum} to maintain alignment`);
            this.mainSeqNum = seqNum;
        }
        this.saveToStore();
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
    /**
     * Save current sequence numbers to persistent store
     */
    saveToStore() {
        this.sequenceStore.saveSequences(this.getAll());
    }
}
exports.SequenceManager = SequenceManager;
