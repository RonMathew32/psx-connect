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
        this.securityListSeqNum = options?.securityListSeqNum ?? 2;
        logger_1.default.info(`[SEQUENCE] Initialized with outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum}, securityList=${this.securityListSeqNum}`);
    }
    /**
     * Get the next outgoing sequence number
     */
    getNextOutgoingSeqNum() {
        if (this.inSecurityListMode) {
            logger_1.default.info(`[SEQUENCE] In security list mode, using fixed sequence number: ${this.securityListSeqNum}`);
            return this.securityListSeqNum;
        }
        return this.outgoingSeqNum;
    }
    /**
     * Increment the outgoing sequence number and return the new value
     */
    incrementOutgoingSeqNum() {
        if (this.inSecurityListMode) {
            logger_1.default.info(`[SEQUENCE] In security list mode, not incrementing sequence number`);
            return this.securityListSeqNum;
        }
        this.outgoingSeqNum++;
        logger_1.default.debug(`[SEQUENCE] Incremented outgoing sequence number to: ${this.outgoingSeqNum}`);
        return this.outgoingSeqNum;
    }
    /**
     * Update the incoming sequence number based on received message
     */
    updateIncomingSeqNum(seqNum) {
        // Only update if the new sequence number is higher
        if (seqNum > this.incomingSeqNum) {
            const oldSeq = this.incomingSeqNum;
            this.incomingSeqNum = seqNum;
            logger_1.default.debug(`[SEQUENCE] Updated incoming sequence number: ${oldSeq} -> ${this.incomingSeqNum}`);
        }
        else if (seqNum < this.incomingSeqNum) {
            // Lower sequence number could indicate a sequence reset or duplicate
            logger_1.default.warn(`[SEQUENCE] Received out-of-order sequence number: ${seqNum} (current: ${this.incomingSeqNum})`);
        }
    }
    /**
     * Enter security list request mode, which uses a fixed sequence number
     */
    enterSecurityListMode() {
        // Remember current sequence number for later restoration
        logger_1.default.info(`[SEQUENCE] Entering security list mode, using fixed sequence ${this.securityListSeqNum}`);
        this.inSecurityListMode = true;
    }
    /**
     * Exit security list request mode, returning to normal sequence numbering
     */
    exitSecurityListMode() {
        logger_1.default.info(`[SEQUENCE] Exiting security list mode, returning to normal sequence numbering (${this.outgoingSeqNum})`);
        this.inSecurityListMode = false;
    }
    /**
     * Check if a received sequence number matches expectations
     */
    isValidIncomingSeqNum(seqNum) {
        // For most general cases, we expect the next sequence number or higher
        return seqNum >= this.incomingSeqNum;
    }
    /**
     * Force reset both incoming and outgoing sequence numbers
     */
    reset(outgoingSeqNum = 1, incomingSeqNum = 0) {
        const oldOutgoing = this.outgoingSeqNum;
        const oldIncoming = this.incomingSeqNum;
        this.outgoingSeqNum = outgoingSeqNum;
        this.incomingSeqNum = incomingSeqNum;
        this.inSecurityListMode = false;
        logger_1.default.info(`[SEQUENCE] Reset sequence numbers: outgoing ${oldOutgoing}->${this.outgoingSeqNum}, incoming ${oldIncoming}->${this.incomingSeqNum}`);
    }
    /**
     * Force set a specific outgoing sequence number
     */
    setOutgoingSeqNum(seqNum) {
        const oldSeq = this.outgoingSeqNum;
        this.outgoingSeqNum = seqNum;
        logger_1.default.info(`[SEQUENCE] Manually set outgoing sequence number: ${oldSeq} -> ${this.outgoingSeqNum}`);
    }
    /**
     * Get the current state of sequence numbers
     */
    getState() {
        return {
            outgoing: this.outgoingSeqNum,
            incoming: this.incomingSeqNum,
            inSecurityListMode: this.inSecurityListMode
        };
    }
}
exports.SequenceManager = SequenceManager;
exports.default = SequenceManager;
