"use strict";
/**
 * PSX Security List Request Handler
 *
 * Specialized handler for PSX security list requests, which require specific
 * sequence number handling and message formatting.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityListHandler = exports.SecurityListType = void 0;
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("./constants");
const message_builder_1 = require("./message-builder");
const sequence_manager_1 = require("./sequence-manager");
var SecurityListType;
(function (SecurityListType) {
    SecurityListType["EQUITY"] = "EQUITY";
    SecurityListType["INDEX"] = "INDEX";
    SecurityListType["BOND"] = "BOND";
})(SecurityListType || (exports.SecurityListType = SecurityListType = {}));
class SecurityListHandler {
    constructor(config, sequenceManager, socketWrite) {
        this.requestsInProgress = new Set();
        this.receivedSecurities = new Map();
        this.config = config;
        this.sequenceManager = sequenceManager;
        this.socketWrite = socketWrite;
        // Initialize empty security lists
        this.receivedSecurities.set(SecurityListType.EQUITY, []);
        this.receivedSecurities.set(SecurityListType.INDEX, []);
        this.receivedSecurities.set(SecurityListType.BOND, []);
        // Make sure security list sequence numbers are correctly initialized
        this.sequenceManager.resetSecurityListSequence(1, 0);
    }
    /**
     * Send a security list request for equities
     */
    requestEquitySecurities() {
        logger_1.default.info(`[SECURITY_LIST] Preparing to send equity security list request`);
        // Switch to security list sequence stream
        this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.SECURITY_LIST);
        const requestId = (0, uuid_1.v4)();
        logger_1.default.info(`[SECURITY_LIST] Sending EQUITY security list request with ID: ${requestId}`);
        // Create message in the format used by fn-psx project
        const message = (0, message_builder_1.createMessageBuilder)()
            .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
            .setSenderCompID(this.config.senderCompId)
            .setTargetCompID(this.config.targetCompId)
            .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum()); // This will use security list sequence
        // Add required fields in same order as fn-psx
        message.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
        message.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
        message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
        message.addField('460', '4'); // Product = EQUITY (4)
        message.addField('336', 'REG'); // TradingSessionID = REG
        const rawMessage = message.buildMessage();
        logger_1.default.info(`[SECURITY_LIST] Raw equity security list request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
        try {
            // Track this request
            this.requestsInProgress.add(requestId);
            // Send the message
            this.socketWrite(rawMessage);
            // Increment the security list sequence number
            this.sequenceManager.incrementOutgoingSeqNum();
            // Call the callback if provided
            if (this.config.onRequestSent) {
                this.config.onRequestSent(requestId, SecurityListType.EQUITY);
            }
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
            // Switch back to regular stream
            this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.REGULAR);
            throw error;
        }
    }
    /**
     * Send a security list request for indices
     */
    requestIndexSecurities() {
        logger_1.default.info(`[SECURITY_LIST] Preparing to send index security list request`);
        // Switch to security list sequence stream
        this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.SECURITY_LIST);
        const requestId = (0, uuid_1.v4)();
        logger_1.default.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);
        // Create message in the format used by fn-psx project
        const message = (0, message_builder_1.createMessageBuilder)()
            .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
            .setSenderCompID(this.config.senderCompId)
            .setTargetCompID(this.config.targetCompId)
            .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum()); // This will use security list sequence
        // Add required fields in same order as fn-psx
        message.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
        message.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
        message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
        message.addField('460', '5'); // Product = INDEX (5)
        message.addField('336', 'REG'); // TradingSessionID = REG
        const rawMessage = message.buildMessage();
        logger_1.default.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
        try {
            // Track this request
            this.requestsInProgress.add(requestId);
            // Send the message
            this.socketWrite(rawMessage);
            // Increment the security list sequence number
            this.sequenceManager.incrementOutgoingSeqNum();
            // Call the callback if provided
            if (this.config.onRequestSent) {
                this.config.onRequestSent(requestId, SecurityListType.INDEX);
            }
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
            // Switch back to regular stream
            this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.REGULAR);
            throw error;
        }
    }
    /**
     * Request both equity and index securities in sequence
     */
    requestAllSecurities() {
        // Make sure we're starting with clean security list sequence numbers
        this.sequenceManager.resetSecurityListSequence(1, 0);
        // First request equities
        const equityRequestId = this.requestEquitySecurities();
        logger_1.default.info(`[SECURITY_LIST] Started comprehensive security list request, equity ID: ${equityRequestId}`);
        // Set up a timer to request index securities after a delay
        setTimeout(() => {
            const indexRequestId = this.requestIndexSecurities();
            logger_1.default.info(`[SECURITY_LIST] Continuing comprehensive security list request, index ID: ${indexRequestId}`);
            // Set up a retry timer if no responses within 10 seconds
            setTimeout(() => {
                // Check if we still have pending requests
                if (this.requestsInProgress.size > 0) {
                    logger_1.default.warn(`[SECURITY_LIST] Some security list requests still pending after timeout, retrying...`);
                    this.retryPendingRequests();
                }
                else {
                    // Switch back to regular stream if all requests completed
                    this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.REGULAR);
                    logger_1.default.info(`[SECURITY_LIST] All security list requests completed successfully`);
                }
            }, 10000);
        }, 5000); // Wait 5 seconds between requests
    }
    /**
     * Handle a security list response message
     */
    handleSecurityListResponse(message) {
        try {
            const requestId = message[constants_1.FieldTag.SECURITY_REQ_ID];
            if (!requestId || !this.requestsInProgress.has(requestId)) {
                logger_1.default.warn(`[SECURITY_LIST] Received security list response for unknown request ID: ${requestId}`);
                return;
            }
            // Make sure we're in security list stream to update the correct sequence numbers
            if (this.sequenceManager.getCurrentStream() !== sequence_manager_1.SequenceStream.SECURITY_LIST) {
                this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.SECURITY_LIST);
                logger_1.default.info(`[SECURITY_LIST] Switching to security list stream to properly handle response`);
            }
            // If there's a sequence number in the response, update our security list incoming sequence
            if (message[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const seqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                this.sequenceManager.updateIncomingSeqNum(seqNum);
                logger_1.default.info(`[SECURITY_LIST] Updated security list incoming sequence to ${seqNum}`);
            }
            // Extract securities from the message
            const securities = this.parseSecurities(message);
            // Determine the type of securities based on the response
            let securityType = SecurityListType.EQUITY;
            if (securities.length > 0) {
                const firstSecurity = securities[0];
                if (firstSecurity.productType === '5' || firstSecurity.productType === 'INDEX') {
                    securityType = SecurityListType.INDEX;
                }
                else if (firstSecurity.productType === '4' || firstSecurity.productType === 'EQUITY') {
                    securityType = SecurityListType.EQUITY;
                }
            }
            // Store the received securities
            const existingSecurities = this.receivedSecurities.get(securityType) || [];
            this.receivedSecurities.set(securityType, [...existingSecurities, ...securities]);
            logger_1.default.info(`[SECURITY_LIST] Received ${securities.length} ${securityType} securities for request ID: ${requestId}`);
            // Mark this request as completed
            this.requestsInProgress.delete(requestId);
            // Call the callback if provided
            if (this.config.onDataReceived) {
                this.config.onDataReceived(securities, securityType);
            }
            // If we have no more pending requests, switch back to regular stream
            if (this.requestsInProgress.size === 0) {
                this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.REGULAR);
                logger_1.default.info(`[SECURITY_LIST] All security list requests completed, switching back to regular stream`);
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error handling security list response: ${error instanceof Error ? error.message : String(error)}`);
            // Don't switch stream on error - we might still be expecting more responses
        }
    }
    /**
     * Parse securities from a security list message
     */
    parseSecurities(message) {
        const securities = [];
        try {
            // Check if this is a security list message
            if (message[constants_1.FieldTag.MSG_TYPE] !== constants_1.MessageType.SECURITY_LIST) {
                throw new Error(`Not a security list message: ${message[constants_1.FieldTag.MSG_TYPE]}`);
            }
            // Get the number of securities in the list
            const noRelatedSym = parseInt(message[constants_1.FieldTag.NO_SECURITIES] || '0', 10);
            if (noRelatedSym === 0) {
                logger_1.default.warn(`[SECURITY_LIST] Security list contains 0 securities`);
                return securities;
            }
            logger_1.default.info(`[SECURITY_LIST] Parsing ${noRelatedSym} securities from message`);
            // Try the standard FIX format first (repeating groups)
            if (this.tryStandardFormat(message, securities)) {
                return securities;
            }
            // If standard format failed, try alternative formats (custom PSX format)
            this.tryAlternativeFormats(message, securities);
            // Remove duplicates
            return this.removeDuplicates(securities);
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error parsing securities: ${error instanceof Error ? error.message : String(error)}`);
            return securities;
        }
    }
    /**
     * Try to parse securities using standard FIX format
     */
    tryStandardFormat(message, securities) {
        // Implementation will depend on the specific PSX format
        // This is a placeholder for the actual implementation
        logger_1.default.info(`[SECURITY_LIST] Trying standard FIX format for security list parsing`);
        return false;
    }
    /**
     * Try to parse securities using alternative PSX formats
     */
    tryAlternativeFormats(message, securities) {
        // Implementation will depend on the specific PSX format
        // This is a placeholder for the actual implementation
        logger_1.default.info(`[SECURITY_LIST] Trying alternative formats for security list parsing`);
        // Example implementation:
        // Iterate through message fields to find security data
        Object.keys(message).forEach(key => {
            // Look for symbol fields (tag 55)
            if (key.includes('55.')) {
                const index = key.split('.')[1];
                const symbol = message[key];
                if (symbol) {
                    const security = {
                        symbol,
                        securityDesc: message[`107.${index}`] || '',
                        productType: message[`460.${index}`] || '',
                        lotSize: parseInt(message[`1234.${index}`] || '0', 10),
                        tickSize: parseFloat(message[`969.${index}`] || '0'),
                        exchange: message[`207.${index}`] || 'PSX',
                        isin: message[`48.${index}`] || '',
                        currency: message[`15.${index}`] || 'PKR'
                    };
                    securities.push(security);
                }
            }
        });
    }
    /**
     * Remove duplicate securities by symbol
     */
    removeDuplicates(securities) {
        const uniqueMap = new Map();
        for (const security of securities) {
            if (!uniqueMap.has(security.symbol)) {
                uniqueMap.set(security.symbol, security);
            }
        }
        return Array.from(uniqueMap.values());
    }
    /**
     * Retry any pending security list requests
     */
    retryPendingRequests() {
        if (this.requestsInProgress.size === 0) {
            logger_1.default.info(`[SECURITY_LIST] No pending requests to retry`);
            this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.REGULAR);
            return;
        }
        logger_1.default.info(`[SECURITY_LIST] Retrying ${this.requestsInProgress.size} pending security list requests`);
        // Reset and clear pending requests
        const pendingRequests = Array.from(this.requestsInProgress);
        this.requestsInProgress.clear();
        // Reset security list sequence numbers and switch to security list stream
        this.sequenceManager.resetSecurityListSequence(1, 0);
        this.sequenceManager.switchToStream(sequence_manager_1.SequenceStream.SECURITY_LIST);
        // Request both types again
        this.requestAllSecurities();
    }
    /**
     * Get all received securities by type
     */
    getSecurities(type) {
        return this.receivedSecurities.get(type) || [];
    }
    /**
     * Get all received securities (all types)
     */
    getAllSecurities() {
        const allSecurities = [];
        for (const securities of this.receivedSecurities.values()) {
            allSecurities.push(...securities);
        }
        return this.removeDuplicates(allSecurities);
    }
}
exports.SecurityListHandler = SecurityListHandler;
exports.default = SecurityListHandler;
