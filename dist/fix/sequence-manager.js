"use strict";
/**
 * Sequence number manager for FIX protocol
 *
 * This class manages sequence numbers for FIX protocol messages, providing
 * tracking of both outgoing and incoming sequence numbers, with special handling
 * for security list requests that need fixed sequence numbers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceManager = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
class SequenceManager {
    constructor(options) {
        // Track if we're in a special state
        this.inSecurityListMode = false;
        this.outgoingSeqNum = options?.initialOutgoingSeqNum ?? 1;
        this.incomingSeqNum = options?.initialIncomingSeqNum ?? 0;
        // Initialize separate security list sequence numbers
        this.securityListOutgoingSeqNum = options?.securityListSeqNum ?? 2;
        this.securityListIncomingSeqNum = 1; // Usually server expects response to sequence 2 to be 2
        logger_1.default.info(`[SEQUENCE] Initialized with outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] Security list sequence numbers initialized to outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
    }
    /**
     * Get the next outgoing sequence number based on current mode
     */
    getNextOutgoingSeqNum() {
        if (this.inSecurityListMode) {
            logger_1.default.info(`[SEQUENCE] In security list mode, using security list sequence number: ${this.securityListOutgoingSeqNum}`);
            return this.securityListOutgoingSeqNum;
        }
        return this.outgoingSeqNum;
    }
    /**
     * Increment the outgoing sequence number and return the new value
     */
    incrementOutgoingSeqNum() {
        if (this.inSecurityListMode) {
            this.securityListOutgoingSeqNum++;
            logger_1.default.debug(`[SEQUENCE] Incremented security list outgoing sequence number to: ${this.securityListOutgoingSeqNum}`);
            return this.securityListOutgoingSeqNum;
        }
        this.outgoingSeqNum++;
        logger_1.default.debug(`[SEQUENCE] Incremented regular outgoing sequence number to: ${this.outgoingSeqNum}`);
        return this.outgoingSeqNum;
    }
    /**
     * Update the incoming sequence number based on received message
     */
    updateIncomingSeqNum(seqNum) {
        if (this.inSecurityListMode) {
            // Update security list incoming sequence
            if (seqNum > this.securityListIncomingSeqNum) {
                const oldSeq = this.securityListIncomingSeqNum;
                this.securityListIncomingSeqNum = seqNum;
                logger_1.default.debug(`[SEQUENCE] Updated security list incoming sequence number: ${oldSeq} -> ${this.securityListIncomingSeqNum}`);
            }
            else if (seqNum < this.securityListIncomingSeqNum) {
                logger_1.default.warn(`[SEQUENCE] Received out-of-order security list sequence number: ${seqNum} (current: ${this.securityListIncomingSeqNum})`);
            }
        }
        else {
            // Update regular incoming sequence
            if (seqNum > this.incomingSeqNum) {
                const oldSeq = this.incomingSeqNum;
                this.incomingSeqNum = seqNum;
                logger_1.default.debug(`[SEQUENCE] Updated regular incoming sequence number: ${oldSeq} -> ${this.incomingSeqNum}`);
            }
            else if (seqNum < this.incomingSeqNum) {
                logger_1.default.warn(`[SEQUENCE] Received out-of-order regular sequence number: ${seqNum} (current: ${this.incomingSeqNum})`);
            }
        }
    }
    /**
     * Enter security list request mode, which uses separate sequence number tracking
     */
    enterSecurityListMode() {
        logger_1.default.info(`[SEQUENCE] Entering security list mode with dedicated sequence numbers: outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
        this.inSecurityListMode = true;
    }
    /**
     * Exit security list request mode, returning to normal sequence numbering
     */
    exitSecurityListMode() {
        logger_1.default.info(`[SEQUENCE] Exiting security list mode, returning to regular sequence numbering (outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum})`);
        this.inSecurityListMode = false;
    }
    /**
     * Check if a received sequence number matches expectations based on current mode
     */
    isValidIncomingSeqNum(seqNum) {
        if (this.inSecurityListMode) {
            return seqNum >= this.securityListIncomingSeqNum;
        }
        return seqNum >= this.incomingSeqNum;
    }
    /**
     * Reset all sequence numbers (both regular and security list)
     */
    reset(outgoingSeqNum = 1, incomingSeqNum = 0) {
        const oldOutgoing = this.outgoingSeqNum;
        const oldIncoming = this.incomingSeqNum;
        const oldSlOutgoing = this.securityListOutgoingSeqNum;
        const oldSlIncoming = this.securityListIncomingSeqNum;
        this.outgoingSeqNum = outgoingSeqNum;
        this.incomingSeqNum = incomingSeqNum;
        this.securityListOutgoingSeqNum = 2; // Always reset to 2 for security list
        this.securityListIncomingSeqNum = 1;
        this.inSecurityListMode = false;
        logger_1.default.info(`[SEQUENCE] Reset regular sequence numbers: outgoing ${oldOutgoing}->${this.outgoingSeqNum}, incoming ${oldIncoming}->${this.incomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] Reset security list sequence numbers: outgoing ${oldSlOutgoing}->${this.securityListOutgoingSeqNum}, incoming ${oldSlIncoming}->${this.securityListIncomingSeqNum}`);
    }
    /**
     * Force set a specific outgoing sequence number for current mode
     */
    setOutgoingSeqNum(seqNum) {
        if (this.inSecurityListMode) {
            const oldSeq = this.securityListOutgoingSeqNum;
            this.securityListOutgoingSeqNum = seqNum;
            logger_1.default.info(`[SEQUENCE] Manually set security list outgoing sequence number: ${oldSeq} -> ${this.securityListOutgoingSeqNum}`);
        }
        else {
            const oldSeq = this.outgoingSeqNum;
            this.outgoingSeqNum = seqNum;
            logger_1.default.info(`[SEQUENCE] Manually set regular outgoing sequence number: ${oldSeq} -> ${this.outgoingSeqNum}`);
        }
    }
    /**
     * Force set security list sequence numbers specifically
     */
    setSecurityListSequenceNumbers(outgoingSeqNum = 2, incomingSeqNum = 1) {
        const oldOutgoing = this.securityListOutgoingSeqNum;
        const oldIncoming = this.securityListIncomingSeqNum;
        this.securityListOutgoingSeqNum = outgoingSeqNum;
        this.securityListIncomingSeqNum = incomingSeqNum;
        logger_1.default.info(`[SEQUENCE] Explicitly set security list sequence numbers: outgoing ${oldOutgoing}->${this.securityListOutgoingSeqNum}, incoming ${oldIncoming}->${this.securityListIncomingSeqNum}`);
    }
    /**
     * Get the current state of sequence numbers
     */
    getState() {
        return {
            regular: {
                outgoing: this.outgoingSeqNum,
                incoming: this.incomingSeqNum
            },
            securityList: {
                outgoing: this.securityListOutgoingSeqNum,
                incoming: this.securityListIncomingSeqNum
            },
            inSecurityListMode: this.inSecurityListMode
        };
    }
}
exports.SequenceManager = SequenceManager;
exports.default = SequenceManager;
