"use strict";
/**
 * Sequence number manager for FIX protocol
 *
 * This class manages sequence numbers for FIX protocol messages, providing
 * tracking of multiple separate sequence number streams for different message types.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceManager = exports.SequenceStream = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
var SequenceStream;
(function (SequenceStream) {
    SequenceStream["REGULAR"] = "REGULAR";
    SequenceStream["SECURITY_LIST"] = "SECURITY_LIST";
    SequenceStream["MARKET_DATA"] = "MARKET_DATA";
})(SequenceStream || (exports.SequenceStream = SequenceStream = {}));
class SequenceManager {
    constructor(options) {
        // Separate sequence counters for each stream
        this.regularOutgoingSeqNum = 1;
        this.regularIncomingSeqNum = 0;
        this.securityListOutgoingSeqNum = 1;
        this.securityListIncomingSeqNum = 0;
        this.marketDataOutgoingSeqNum = 1;
        this.marketDataIncomingSeqNum = 0;
        // Track which stream is currently active
        this.currentStream = SequenceStream.REGULAR;
        this.regularOutgoingSeqNum = options?.initialRegularSeqNum ?? 1;
        this.securityListOutgoingSeqNum = options?.initialSecurityListSeqNum ?? 1;
        this.marketDataOutgoingSeqNum = options?.initialMarketDataSeqNum ?? 1;
        logger_1.default.info(`[SEQUENCE] Initialized with multiple streams:`);
        logger_1.default.info(`[SEQUENCE] - Regular: outgoing=${this.regularOutgoingSeqNum}, incoming=${this.regularIncomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] - Security List: outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] - Market Data: outgoing=${this.marketDataOutgoingSeqNum}, incoming=${this.marketDataIncomingSeqNum}`);
    }
    /**
     * Get the next outgoing sequence number for the current stream
     */
    getNextOutgoingSeqNum() {
        switch (this.currentStream) {
            case SequenceStream.SECURITY_LIST:
                logger_1.default.debug(`[SEQUENCE] Getting security list sequence number: ${this.securityListOutgoingSeqNum}`);
                return this.securityListOutgoingSeqNum;
            case SequenceStream.MARKET_DATA:
                logger_1.default.debug(`[SEQUENCE] Getting market data sequence number: ${this.marketDataOutgoingSeqNum}`);
                return this.marketDataOutgoingSeqNum;
            case SequenceStream.REGULAR:
            default:
                logger_1.default.debug(`[SEQUENCE] Getting regular sequence number: ${this.regularOutgoingSeqNum}`);
                return this.regularOutgoingSeqNum;
        }
    }
    /**
     * Increment the outgoing sequence number for the current stream and return the new value
     */
    incrementOutgoingSeqNum() {
        switch (this.currentStream) {
            case SequenceStream.SECURITY_LIST:
                this.securityListOutgoingSeqNum++;
                logger_1.default.debug(`[SEQUENCE] Incremented security list outgoing sequence number to: ${this.securityListOutgoingSeqNum}`);
                return this.securityListOutgoingSeqNum;
            case SequenceStream.MARKET_DATA:
                this.marketDataOutgoingSeqNum++;
                logger_1.default.debug(`[SEQUENCE] Incremented market data outgoing sequence number to: ${this.marketDataOutgoingSeqNum}`);
                return this.marketDataOutgoingSeqNum;
            case SequenceStream.REGULAR:
            default:
                this.regularOutgoingSeqNum++;
                logger_1.default.debug(`[SEQUENCE] Incremented regular outgoing sequence number to: ${this.regularOutgoingSeqNum}`);
                return this.regularOutgoingSeqNum;
        }
    }
    /**
     * Update the incoming sequence number for the current stream
     */
    updateIncomingSeqNum(seqNum) {
        switch (this.currentStream) {
            case SequenceStream.SECURITY_LIST:
                if (seqNum > this.securityListIncomingSeqNum) {
                    const oldSeq = this.securityListIncomingSeqNum;
                    this.securityListIncomingSeqNum = seqNum;
                    logger_1.default.debug(`[SEQUENCE] Updated security list incoming sequence number: ${oldSeq} -> ${this.securityListIncomingSeqNum}`);
                }
                else if (seqNum < this.securityListIncomingSeqNum) {
                    logger_1.default.warn(`[SEQUENCE] Received out-of-order security list sequence number: ${seqNum} (current: ${this.securityListIncomingSeqNum})`);
                }
                break;
            case SequenceStream.MARKET_DATA:
                if (seqNum > this.marketDataIncomingSeqNum) {
                    const oldSeq = this.marketDataIncomingSeqNum;
                    this.marketDataIncomingSeqNum = seqNum;
                    logger_1.default.debug(`[SEQUENCE] Updated market data incoming sequence number: ${oldSeq} -> ${this.marketDataIncomingSeqNum}`);
                }
                else if (seqNum < this.marketDataIncomingSeqNum) {
                    logger_1.default.warn(`[SEQUENCE] Received out-of-order market data sequence number: ${seqNum} (current: ${this.marketDataIncomingSeqNum})`);
                }
                break;
            case SequenceStream.REGULAR:
            default:
                if (seqNum > this.regularIncomingSeqNum) {
                    const oldSeq = this.regularIncomingSeqNum;
                    this.regularIncomingSeqNum = seqNum;
                    logger_1.default.debug(`[SEQUENCE] Updated regular incoming sequence number: ${oldSeq} -> ${this.regularIncomingSeqNum}`);
                }
                else if (seqNum < this.regularIncomingSeqNum) {
                    logger_1.default.warn(`[SEQUENCE] Received out-of-order regular sequence number: ${seqNum} (current: ${this.regularIncomingSeqNum})`);
                }
                break;
        }
    }
    /**
     * Switch to a specific sequence number stream
     */
    switchToStream(stream) {
        const oldStream = this.currentStream;
        this.currentStream = stream;
        logger_1.default.info(`[SEQUENCE] Switched from ${oldStream} stream to ${stream} stream`);
        // Log the current sequence numbers for the new stream
        switch (stream) {
            case SequenceStream.SECURITY_LIST:
                logger_1.default.info(`[SEQUENCE] Security list sequence numbers: outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
                break;
            case SequenceStream.MARKET_DATA:
                logger_1.default.info(`[SEQUENCE] Market data sequence numbers: outgoing=${this.marketDataOutgoingSeqNum}, incoming=${this.marketDataIncomingSeqNum}`);
                break;
            case SequenceStream.REGULAR:
            default:
                logger_1.default.info(`[SEQUENCE] Regular sequence numbers: outgoing=${this.regularOutgoingSeqNum}, incoming=${this.regularIncomingSeqNum}`);
                break;
        }
    }
    /**
     * Check if a received sequence number is valid for the current stream
     */
    isValidIncomingSeqNum(seqNum) {
        switch (this.currentStream) {
            case SequenceStream.SECURITY_LIST:
                return seqNum >= this.securityListIncomingSeqNum;
            case SequenceStream.MARKET_DATA:
                return seqNum >= this.marketDataIncomingSeqNum;
            case SequenceStream.REGULAR:
            default:
                return seqNum >= this.regularIncomingSeqNum;
        }
    }
    /**
     * Reset all sequence numbers (for all streams)
     */
    resetAll(seqNum = 1) {
        const oldRegOutgoing = this.regularOutgoingSeqNum;
        const oldRegIncoming = this.regularIncomingSeqNum;
        const oldSlOutgoing = this.securityListOutgoingSeqNum;
        const oldSlIncoming = this.securityListIncomingSeqNum;
        const oldMdOutgoing = this.marketDataOutgoingSeqNum;
        const oldMdIncoming = this.marketDataIncomingSeqNum;
        this.regularOutgoingSeqNum = seqNum;
        this.regularIncomingSeqNum = 0;
        this.securityListOutgoingSeqNum = seqNum;
        this.securityListIncomingSeqNum = 0;
        this.marketDataOutgoingSeqNum = seqNum;
        this.marketDataIncomingSeqNum = 0;
        logger_1.default.info(`[SEQUENCE] Reset ALL sequence numbers to ${seqNum} (incoming=0)`);
        logger_1.default.info(`[SEQUENCE] - Regular: ${oldRegOutgoing}/${oldRegIncoming} -> ${this.regularOutgoingSeqNum}/${this.regularIncomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] - Security List: ${oldSlOutgoing}/${oldSlIncoming} -> ${this.securityListOutgoingSeqNum}/${this.securityListIncomingSeqNum}`);
        logger_1.default.info(`[SEQUENCE] - Market Data: ${oldMdOutgoing}/${oldMdIncoming} -> ${this.marketDataOutgoingSeqNum}/${this.marketDataIncomingSeqNum}`);
    }
    /**
     * Reset sequence numbers for the regular stream only
     */
    resetRegularSequence(outgoingSeqNum = 1, incomingSeqNum = 0) {
        const oldOutgoing = this.regularOutgoingSeqNum;
        const oldIncoming = this.regularIncomingSeqNum;
        this.regularOutgoingSeqNum = outgoingSeqNum;
        this.regularIncomingSeqNum = incomingSeqNum;
        logger_1.default.info(`[SEQUENCE] Reset regular sequence numbers: outgoing ${oldOutgoing}->${this.regularOutgoingSeqNum}, incoming ${oldIncoming}->${this.regularIncomingSeqNum}`);
    }
    /**
     * Reset sequence numbers for the security list stream only
     */
    resetSecurityListSequence(outgoingSeqNum = 1, incomingSeqNum = 0) {
        const oldOutgoing = this.securityListOutgoingSeqNum;
        const oldIncoming = this.securityListIncomingSeqNum;
        this.securityListOutgoingSeqNum = outgoingSeqNum;
        this.securityListIncomingSeqNum = incomingSeqNum;
        logger_1.default.info(`[SEQUENCE] Reset security list sequence numbers: outgoing ${oldOutgoing}->${this.securityListOutgoingSeqNum}, incoming ${oldIncoming}->${this.securityListIncomingSeqNum}`);
    }
    /**
     * Reset sequence numbers for the market data stream only
     */
    resetMarketDataSequence(outgoingSeqNum = 1, incomingSeqNum = 0) {
        const oldOutgoing = this.marketDataOutgoingSeqNum;
        const oldIncoming = this.marketDataIncomingSeqNum;
        this.marketDataOutgoingSeqNum = outgoingSeqNum;
        this.marketDataIncomingSeqNum = incomingSeqNum;
        logger_1.default.info(`[SEQUENCE] Reset market data sequence numbers: outgoing ${oldOutgoing}->${this.marketDataOutgoingSeqNum}, incoming ${oldIncoming}->${this.marketDataIncomingSeqNum}`);
    }
    /**
     * Reset sequence numbers after logon - all streams start at 1
     */
    resetAfterLogon() {
        this.resetAll(1);
        logger_1.default.info('[SEQUENCE] Reset all sequence numbers to 1 after logon');
    }
    /**
     * Set outgoing sequence number for current stream
     */
    setOutgoingSeqNum(seqNum) {
        switch (this.currentStream) {
            case SequenceStream.SECURITY_LIST:
                const oldSlSeq = this.securityListOutgoingSeqNum;
                this.securityListOutgoingSeqNum = seqNum;
                logger_1.default.info(`[SEQUENCE] Manually set security list outgoing sequence number: ${oldSlSeq} -> ${this.securityListOutgoingSeqNum}`);
                break;
            case SequenceStream.MARKET_DATA:
                const oldMdSeq = this.marketDataOutgoingSeqNum;
                this.marketDataOutgoingSeqNum = seqNum;
                logger_1.default.info(`[SEQUENCE] Manually set market data outgoing sequence number: ${oldMdSeq} -> ${this.marketDataOutgoingSeqNum}`);
                break;
            case SequenceStream.REGULAR:
            default:
                const oldRegSeq = this.regularOutgoingSeqNum;
                this.regularOutgoingSeqNum = seqNum;
                logger_1.default.info(`[SEQUENCE] Manually set regular outgoing sequence number: ${oldRegSeq} -> ${this.regularOutgoingSeqNum}`);
                break;
        }
    }
    /**
     * Get the current stream type
     */
    getCurrentStream() {
        return this.currentStream;
    }
    /**
     * Get the state of all sequence number streams
     */
    getState() {
        return {
            regular: {
                outgoing: this.regularOutgoingSeqNum,
                incoming: this.regularIncomingSeqNum
            },
            securityList: {
                outgoing: this.securityListOutgoingSeqNum,
                incoming: this.securityListIncomingSeqNum
            },
            marketData: {
                outgoing: this.marketDataOutgoingSeqNum,
                incoming: this.marketDataIncomingSeqNum
            },
            currentStream: this.currentStream
        };
    }
}
exports.SequenceManager = SequenceManager;
exports.default = SequenceManager;
