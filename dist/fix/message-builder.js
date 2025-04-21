"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixMessageBuilder = void 0;
const constants_1 = require("./constants");
const moment_1 = __importDefault(require("moment"));
const uuid_1 = require("uuid");
class FixMessageBuilder {
    constructor(beginString = constants_1.DEFAULT_CONNECTION.VERSION) {
        this.fields = [];
        this.msgSeqNum = 1;
        this.beginString = beginString;
    }
    /**
     * Add a field to the message
     */
    addField(tag, value) {
        this.fields.push({ tag, value });
        return this;
    }
    /**
     * Get the current message sequence number
     */
    getSeqNum() {
        return this.msgSeqNum;
    }
    /**
     * Set the message sequence number
     */
    setSeqNum(seqNum) {
        this.msgSeqNum = seqNum;
        return this;
    }
    /**
     * Increment the message sequence number
     */
    incrementSeqNum() {
        this.msgSeqNum++;
        return this;
    }
    /**
     * Calculate the checksum for a message
     */
    calculateChecksum(message) {
        let sum = 0;
        for (let i = 0; i < message.length; i++) {
            sum += message.charCodeAt(i);
        }
        return (sum % 256).toString().padStart(3, '0');
    }
    /**
     * Format a timestamp for FIX messages
     */
    formatTimestamp() {
        return (0, moment_1.default)().format('YYYYMMDD-HH:mm:ss.SSS');
    }
    /**
     * Build the message into a string
     */
    build() {
        // Sort fields to ensure consistent order
        this.fields.sort((a, b) => a.tag - b.tag);
        // Add required message fields if they're not already added
        const hasField = (tag) => this.fields.some(field => field.tag === tag);
        if (!hasField(constants_1.FieldTag.MSG_SEQ_NUM)) {
            this.addField(constants_1.FieldTag.MSG_SEQ_NUM, this.msgSeqNum.toString());
        }
        if (!hasField(constants_1.FieldTag.SENDING_TIME)) {
            this.addField(constants_1.FieldTag.SENDING_TIME, this.formatTimestamp());
        }
        // Join all fields except header and trailer
        const body = this.fields
            .map(field => `${field.tag}=${field.value}`)
            .join(constants_1.SOH);
        // Calculate body length
        const bodyLength = body.length + 2; // +2 for the SOH delimiters
        // Create the message
        const message = `${constants_1.FieldTag.BEGIN_STRING}=${this.beginString}${constants_1.SOH}${constants_1.FieldTag.BODY_LENGTH}=${bodyLength}${constants_1.SOH}${body}${constants_1.SOH}`;
        // Calculate checksum
        const checksum = this.calculateChecksum(message);
        // Return the complete message
        return `${message}${constants_1.FieldTag.CHECK_SUM}=${checksum}${constants_1.SOH}`;
    }
    /**
     * Create a logon message
     */
    static createLogonMessage(senderCompId, targetCompId, username, password, resetSeqNum = true, heartBtInt = 30) {
        return new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.LOGON)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId)
            .addField(constants_1.FieldTag.ENCRYPT_METHOD, constants_1.DEFAULT_CONNECTION.ENCRYPT_METHOD)
            .addField(constants_1.FieldTag.HEART_BT_INT, heartBtInt.toString())
            .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, resetSeqNum ? 'Y' : 'N')
            .addField(constants_1.FieldTag.USERNAME, username)
            .addField(constants_1.FieldTag.PASSWORD, password)
            .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9')
            .addField(constants_1.FieldTag.DEFAULT_CSTM_APPL_VER_ID, 'FIX5.00_PSX_1.00')
            .addField(constants_1.FieldTag.ON_BEHALF_OF_COMP_ID, '600')
            .addField(constants_1.FieldTag.RAW_DATA, 'kse')
            .addField(constants_1.FieldTag.RAW_DATA_LENGTH, '3')
            .build();
    }
    /**
     * Create a heartbeat message
     */
    static createHeartbeatMessage(senderCompId, targetCompId, testReqId) {
        const builder = new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.HEARTBEAT)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId);
        if (testReqId) {
            builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
        }
        return builder.build();
    }
    /**
     * Create a test request message
     */
    static createTestRequestMessage(senderCompId, targetCompId) {
        const testReqId = (0, uuid_1.v4)().substring(0, 8);
        return new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.TEST_REQUEST)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId)
            .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId)
            .build();
    }
    /**
     * Create a logout message
     */
    static createLogoutMessage(senderCompId, targetCompId, text) {
        const builder = new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.LOGOUT)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId);
        if (text) {
            builder.addField(58, text); // Text is tag 58
        }
        return builder.build();
    }
    /**
     * Create a market data request message
     */
    static createMarketDataRequest(senderCompId, targetCompId, symbols, entryTypes, subscriptionType, marketDepth = 0) {
        const mdReqId = (0, uuid_1.v4)();
        const builder = new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.MARKET_DATA_REQUEST)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId)
            .addField(constants_1.FieldTag.MD_REQ_ID, mdReqId)
            .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
            .addField(constants_1.FieldTag.MARKET_DEPTH, marketDepth.toString())
            .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0') // Full refresh
            .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
        // Add entry types
        for (let i = 0; i < entryTypes.length; i++) {
            builder.addField(269, entryTypes[i]); // MDEntryType is tag 269
        }
        // Add symbols
        builder.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
        for (let i = 0; i < symbols.length; i++) {
            builder.addField(constants_1.FieldTag.SYMBOL, symbols[i]);
        }
        return builder.build();
    }
    /**
     * Create a security list request
     */
    static createSecurityListRequest(senderCompId, targetCompId, securityType) {
        const reqId = (0, uuid_1.v4)();
        const builder = new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.SECURITY_LIST_REQUEST)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId)
            .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, constants_1.SecurityListRequestType.ALL_SECURITIES)
            .addField(320, reqId); // SecurityReqID is tag 320
        if (securityType) {
            builder.addField(constants_1.FieldTag.SECURITY_TYPE, securityType);
        }
        return builder.build();
    }
    /**
     * Create a trading session status request
     */
    static createTradingSessionStatusRequest(senderCompId, targetCompId, tradingSessionId) {
        const reqId = (0, uuid_1.v4)();
        const builder = new FixMessageBuilder()
            .addField(constants_1.FieldTag.MSG_TYPE, constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
            .addField(constants_1.FieldTag.SENDER_COMP_ID, senderCompId)
            .addField(constants_1.FieldTag.TARGET_COMP_ID, targetCompId)
            .addField(335, reqId); // TradSesReqID is tag 335
        if (tradingSessionId) {
            builder.addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionId);
        }
        return builder.build();
    }
}
exports.FixMessageBuilder = FixMessageBuilder;
