"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixClient = void 0;
const net_1 = __importDefault(require("net"));
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const message_parser_1 = require("./message-parser");
const constants_1 = require("./constants");
const logger_1 = __importDefault(require("../utils/logger"));
class FixClient extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.socket = null;
        this.connected = false;
        this.loggedIn = false;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.messageSequenceNumber = 1;
        this.receivedData = '';
        this.lastActivityTime = 0;
        this.testRequestCount = 0;
        this.lastSentTime = new Date();
        this.msgSeqNum = 1;
        this.options = options;
    }
    /**
     * Start the FIX client and connect to the server
     */
    start() {
        this.connect();
    }
    /**
     * Stop the FIX client and disconnect from the server
     */
    stop() {
        this.disconnect();
    }
    /**
     * Connect to the FIX server and return a promise
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.socket) {
                this.socket.destroy();
                this.socket = null;
            }
            logger_1.default.info(`Connecting to PSX at ${this.options.host}:${this.options.port}`);
            this.socket = new net_1.default.Socket();
            // Set up one-time connect handler for the promise
            this.socket.once('connect', () => {
                resolve();
            });
            this.socket.once('error', (err) => {
                reject(err);
            });
            this.setupSocketHandlers();
            this.socket.connect(this.options.port, this.options.host);
        });
    }
    /**
     * Disconnect from the FIX server
     */
    disconnect() {
        this.clearTimers();
        if (this.connected && this.loggedIn) {
            this.sendLogout();
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
        this.loggedIn = false;
    }
    /**
     * Set up socket event handlers
     */
    setupSocketHandlers() {
        if (!this.socket)
            return;
        this.socket.on('connect', () => {
            logger_1.default.info('Socket connected');
            this.connected = true;
            this.emit('connected');
            // Log connection details for debugging
            logger_1.default.debug(`Connected to ${this.options.host}:${this.options.port}`);
            logger_1.default.debug(`Local address: ${this.socket?.localAddress}:${this.socket?.localPort}`);
            // Add a small delay before sending logon to ensure socket is fully established
            setTimeout(() => {
                logger_1.default.info('Sending logon message...');
                this.sendLogon();
            }, 500);
        });
        this.socket.on('data', (data) => {
            const dataStr = data.toString();
            logger_1.default.debug(`Received data: ${dataStr.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            this.handleData(data);
        });
        this.socket.on('error', (error) => {
            logger_1.default.error(`Socket error: ${error.message}`);
            logger_1.default.error(`Error stack: ${error.stack}`);
            this.emit('error', error);
        });
        this.socket.on('close', (hadError) => {
            logger_1.default.info(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
            this.connected = false;
            this.loggedIn = false;
            this.clearTimers();
            this.emit('disconnected');
            this.scheduleReconnect();
        });
        this.socket.on('timeout', () => {
            logger_1.default.warn('Socket timeout - connection inactive');
            if (this.socket) {
                this.socket.destroy();
                this.socket = null;
            }
        });
        // Set socket options
        this.socket.setKeepAlive(true, 30000);
        this.socket.setTimeout(60000);
        this.socket.setNoDelay(true);
    }
    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        logger_1.default.info('Scheduling reconnect in 5 seconds');
        this.reconnectTimer = setTimeout(() => {
            logger_1.default.info('Attempting to reconnect');
            this.connect();
        }, 5000);
    }
    /**
     * Clear all timers
     */
    clearTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    /**
     * Handle incoming data from the socket
     */
    handleData(data) {
        try {
            this.lastActivityTime = Date.now();
            const dataStr = data.toString();
            logger_1.default.debug(`Processing received data (${dataStr.length} bytes)`);
            // Handle binary SOH characters that might not be visible in logs
            if (dataStr.indexOf(constants_1.SOH) === -1) {
                logger_1.default.warn(`Received data without SOH delimiter: ${dataStr}`);
                // Try to continue processing anyway, replacing any control chars with SOH
                this.receivedData += dataStr.replace(/[\x00-\x1F]/g, constants_1.SOH);
            }
            else {
                this.receivedData += dataStr;
            }
            // Process complete messages
            let endIndex;
            while ((endIndex = this.receivedData.indexOf(constants_1.SOH + '10=')) !== -1) {
                // Find the end of the message (next SOH after the checksum)
                const checksumEndIndex = this.receivedData.indexOf(constants_1.SOH, endIndex + 1);
                if (checksumEndIndex === -1) {
                    logger_1.default.debug('Found incomplete message, waiting for more data');
                    break;
                }
                // Extract the complete message
                const completeMessage = this.receivedData.substring(0, checksumEndIndex + 1);
                this.receivedData = this.receivedData.substring(checksumEndIndex + 1);
                // Log the complete FIX message for debugging
                logger_1.default.debug(`Extracted complete message: ${completeMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
                // Process the message
                this.processMessage(completeMessage);
            }
            // If there's too much unprocessed data, log a warning
            if (this.receivedData.length > 8192) {
                logger_1.default.warn(`Large amount of unprocessed data: ${this.receivedData.length} bytes`);
                // Keep only the last 8K to prevent memory issues
                this.receivedData = this.receivedData.substring(this.receivedData.length - 8192);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing received data: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger_1.default.error(`Stack trace: ${error.stack}`);
            }
        }
    }
    /**
     * Process a complete FIX message
     */
    processMessage(message) {
        logger_1.default.debug(`Received: ${message.replace(/\x01/g, '|')}`);
        if (!message_parser_1.FixMessageParser.verifyChecksum(message)) {
            logger_1.default.warn('Invalid checksum in message');
            return;
        }
        const parsedMessage = message_parser_1.FixMessageParser.parse(message);
        this.emit('message', parsedMessage);
        if (message_parser_1.FixMessageParser.isLogon(parsedMessage)) {
            this.handleLogon(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isLogout(parsedMessage)) {
            this.handleLogout(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isHeartbeat(parsedMessage)) {
            // Just reset the activity timer
            this.testRequestCount = 0;
        }
        else if (message_parser_1.FixMessageParser.isTestRequest(parsedMessage)) {
            this.handleTestRequest(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isMarketDataSnapshot(parsedMessage)) {
            this.handleMarketDataSnapshot(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isMarketDataIncremental(parsedMessage)) {
            this.handleMarketDataIncremental(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isSecurityList(parsedMessage)) {
            this.handleSecurityList(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isTradingSessionStatus(parsedMessage)) {
            this.handleTradingSessionStatus(parsedMessage);
        }
        else if (message_parser_1.FixMessageParser.isReject(parsedMessage)) {
            this.handleReject(parsedMessage);
        }
    }
    /**
     * Send a message via the socket
     */
    sendMessage(message) {
        if (!this.socket || !this.connected) {
            logger_1.default.warn('Cannot send message: not connected');
            return;
        }
        try {
            // Similar to the Go implementation's ToApp function - add the PSX specific fields
            if (!message.includes('35=A') && !message.includes('35=5')) {
                // Not a logon or logout message - add the PSX specific fields
                // This is similar to the Go code in ToApp method
                // Replace the message with one containing the PSX specific fields
                const msgParts = message.split(constants_1.SOH);
                let modifiedMessage = '';
                // Find position to insert DEFAULT_APPL_VER_ID and DEFAULT_CSTM_APPL_VER_ID
                for (let i = 0; i < msgParts.length; i++) {
                    modifiedMessage += msgParts[i] + constants_1.SOH;
                    // After MsgType, add the PSX specific fields
                    if (msgParts[i].startsWith('35=')) {
                        modifiedMessage += `1137=9${constants_1.SOH}`; // DEFAULT_APPL_VER_ID
                        modifiedMessage += `1129=FIX5.00_PSX_1.00${constants_1.SOH}`; // DEFAULT_CSTM_APPL_VER_ID
                        modifiedMessage += `115=600${constants_1.SOH}`; // ON_BEHALF_OF_COMP_ID
                        modifiedMessage += `96=kse${constants_1.SOH}`; // RAW_DATA
                        modifiedMessage += `95=3${constants_1.SOH}`; // RAW_DATA_LENGTH
                    }
                }
                message = modifiedMessage;
            }
            logger_1.default.debug(`Sending: ${message.replace(/\x01/g, '|')}`);
            this.socket.write(message);
            this.lastActivityTime = Date.now();
        }
        catch (error) {
            logger_1.default.error(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Handle a logon message response
     */
    handleLogon(message) {
        logger_1.default.info('Logon successful');
        this.loggedIn = true;
        this.startHeartbeatMonitoring();
        this.emit('logon', message);
    }
    /**
     * Handle a logout message
     */
    handleLogout(message) {
        logger_1.default.info('Logout received');
        this.loggedIn = false;
        this.clearTimers();
        this.emit('logout', message);
        // Close the socket
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
    /**
     * Handle a test request
     */
    handleTestRequest(message) {
        const testReqId = message_parser_1.FixMessageParser.getTestReqID(message);
        if (testReqId) {
            const heartbeat = message_builder_1.FixMessageBuilder.createHeartbeatMessage(this.options.senderCompId, this.options.targetCompId, testReqId);
            this.sendMessage(heartbeat);
        }
    }
    /**
     * Handle a reject message
     */
    handleReject(message) {
        const text = message_parser_1.FixMessageParser.getRejectText(message);
        logger_1.default.error(`Received reject: ${text}`);
    }
    /**
     * Handle a market data snapshot
     */
    handleMarketDataSnapshot(message) {
        try {
            const mdReqId = message_parser_1.FixMessageParser.getMDReqID(message);
            const noMDEntries = parseInt(message['268'] || '0', 10); // NoMDEntries
            const items = [];
            for (let i = 1; i <= noMDEntries; i++) {
                const entryType = message[`269.${i}`]; // MDEntryType
                const symbol = message[`55.${i}`] || message['55']; // Symbol
                if (!entryType || !symbol)
                    continue;
                const item = {
                    symbol,
                    entryType,
                    price: parseFloat(message[`270.${i}`] || '0'), // MDEntryPx
                    size: parseFloat(message[`271.${i}`] || '0'), // MDEntrySize
                    entryId: message[`278.${i}`], // MDEntryID
                    timestamp: message[`273.${i}`] // MDEntryTime
                };
                items.push(item);
            }
            if (items.length > 0) {
                logger_1.default.info(`Received market data snapshot for request ${mdReqId} with ${items.length} entries`);
                this.emit('marketData', items);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing market data snapshot: ${error}`);
        }
    }
    /**
     * Handle market data incremental updates
     */
    handleMarketDataIncremental(message) {
        try {
            const mdReqId = message_parser_1.FixMessageParser.getMDReqID(message);
            const noMDEntries = parseInt(message['268'] || '0', 10); // NoMDEntries
            const items = [];
            for (let i = 1; i <= noMDEntries; i++) {
                const entryType = message[`269.${i}`]; // MDEntryType
                const symbol = message[`55.${i}`] || message['55']; // Symbol
                if (!entryType || !symbol)
                    continue;
                const item = {
                    symbol,
                    entryType,
                    price: parseFloat(message[`270.${i}`] || '0'), // MDEntryPx
                    size: parseFloat(message[`271.${i}`] || '0'), // MDEntrySize
                    entryId: message[`278.${i}`], // MDEntryID
                    timestamp: message[`273.${i}`] // MDEntryTime
                };
                items.push(item);
            }
            if (items.length > 0) {
                logger_1.default.info(`Received market data update for request ${mdReqId} with ${items.length} entries`);
                this.emit('marketData', items);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing market data incremental update: ${error}`);
        }
    }
    /**
     * Handle security list response
     */
    handleSecurityList(message) {
        try {
            const noRelatedSym = parseInt(message['146'] || '0', 10); // NoRelatedSym
            const securities = [];
            for (let i = 1; i <= noRelatedSym; i++) {
                const symbol = message[`55.${i}`]; // Symbol
                const securityType = message[`167.${i}`] || message['167']; // SecurityType
                if (!symbol)
                    continue;
                const security = {
                    symbol,
                    securityType: securityType || '',
                    securityDesc: message[`107.${i}`], // SecurityDesc
                    isin: message[`48.${i}`], // SecurityID (ISIN)
                    currency: message[`15.${i}`] // Currency
                };
                securities.push(security);
            }
            if (securities.length > 0) {
                logger_1.default.info(`Received security list with ${securities.length} securities`);
                this.emit('securityList', securities);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing security list: ${error}`);
        }
    }
    /**
     * Handle trading session status
     */
    handleTradingSessionStatus(message) {
        try {
            const sessionId = message['336']; // TradingSessionID
            const status = message['340']; // TradSesStatus
            if (!sessionId || !status)
                return;
            const sessionInfo = {
                sessionId,
                status,
                startTime: message['341'], // TradSesStartTime
                endTime: message['342'] // TradSesEndTime
            };
            logger_1.default.info(`Received trading session status: ${status} for session ${sessionId}`);
            this.emit('tradingSessionStatus', sessionInfo);
        }
        catch (error) {
            logger_1.default.error(`Error processing trading session status: ${error}`);
        }
    }
    /**
     * Send a logon message
     */
    sendLogon() {
        // Create a raw FIX message string directly to match the Go implementation
        const now = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').substring(0, 17);
        // Build the message body first - add 34=1 (MsgSeqNum) and 52=<time> (SendingTime)
        const bodyFields = [
            `35=A${constants_1.SOH}`, // MsgType (Logon)
            `34=1${constants_1.SOH}`, // MsgSeqNum - adding this explicitly
            `49=${this.options.senderCompId}${constants_1.SOH}`, // SenderCompID
            `56=${this.options.targetCompId}${constants_1.SOH}`, // TargetCompID
            `52=${now}${constants_1.SOH}`, // SendingTime - adding this explicitly
            `98=0${constants_1.SOH}`, // EncryptMethod
            `108=${this.options.heartbeatIntervalSecs}${constants_1.SOH}`, // HeartBtInt
            `141=Y${constants_1.SOH}`, // ResetSeqNumFlag
            `553=${this.options.username}${constants_1.SOH}`, // Username
            `554=${this.options.password}${constants_1.SOH}`, // Password - use from options
            `1137=9${constants_1.SOH}`, // DefaultApplVerID
            `1129=FIX5.00_PSX_1.00${constants_1.SOH}`, // DefaultCstmApplVerID - explicitly add this
            `115=600${constants_1.SOH}`, // OnBehalfOfCompID
            `96=kse${constants_1.SOH}`, // RawData
            `95=3${constants_1.SOH}` // RawDataLength
        ].join('');
        // Calculate body length (excluding SOH characters)
        const bodyLength = bodyFields.replace(new RegExp(constants_1.SOH, 'g'), '').length;
        // Construct the complete message with header
        const message = [
            `8=FIXT.1.1${constants_1.SOH}`, // BeginString
            `9=${bodyLength}${constants_1.SOH}`, // BodyLength
            bodyFields
        ].join('');
        // Calculate checksum - sum of ASCII values of all characters modulo 256
        let sum = 0;
        for (let i = 0; i < message.length; i++) {
            sum += message.charCodeAt(i);
        }
        const checksum = (sum % 256).toString().padStart(3, '0');
        // Add the checksum
        const finalMessage = message + `10=${checksum}${constants_1.SOH}`;
        logger_1.default.info("Sending logon message with exact PSX format");
        logger_1.default.info(`Logon message: ${finalMessage}`);
        logger_1.default.debug(`Logon message: ${finalMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
        if (!this.socket || !this.connected) {
            logger_1.default.warn('Cannot send logon: not connected');
            return;
        }
        try {
            this.socket.write(finalMessage);
            this.lastActivityTime = Date.now();
        }
        catch (error) {
            logger_1.default.error(`Failed to send logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Send a logout message
     */
    sendLogout(text) {
        const logoutMessage = message_builder_1.FixMessageBuilder.createLogoutMessage(this.options.senderCompId, this.options.targetCompId, text);
        this.sendMessage(logoutMessage);
    }
    /**
     * Start heartbeat monitoring
     */
    startHeartbeatMonitoring() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        const heartbeatInterval = this.options.heartbeatIntervalSecs * 1000;
        this.heartbeatTimer = setInterval(() => {
            const currentTime = Date.now();
            const timeSinceLastActivity = currentTime - this.lastActivityTime;
            // If no activity for more than heartbeat interval, send a heartbeat
            if (timeSinceLastActivity >= heartbeatInterval) {
                // If no response to multiple test requests, consider connection dead
                if (this.testRequestCount >= 2) {
                    logger_1.default.warn('No response to test requests, connection may be dead');
                    if (this.socket) {
                        this.socket.destroy();
                        this.socket = null;
                    }
                    return;
                }
                // After 1.5 intervals without activity, send a test request instead of heartbeat
                if (timeSinceLastActivity >= heartbeatInterval * 1.5) {
                    logger_1.default.debug('Sending test request');
                    const testRequest = message_builder_1.FixMessageBuilder.createTestRequestMessage(this.options.senderCompId, this.options.targetCompId);
                    this.sendMessage(testRequest);
                    this.testRequestCount++;
                }
                else {
                    logger_1.default.debug('Sending heartbeat');
                    const heartbeat = message_builder_1.FixMessageBuilder.createHeartbeatMessage(this.options.senderCompId, this.options.targetCompId);
                    this.sendMessage(heartbeat);
                }
            }
        }, Math.min(heartbeatInterval / 2, 10000)); // Check at half the heartbeat interval or 10 seconds, whichever is less
    }
    /**
     * Send a market data request
     */
    sendMarketDataRequest(symbols, entryTypes, subscriptionType, marketDepth = 0) {
        if (!this.loggedIn) {
            logger_1.default.warn('Cannot send market data request: not logged in');
            return;
        }
        const message = message_builder_1.FixMessageBuilder.createMarketDataRequest(this.options.senderCompId, this.options.targetCompId, symbols, entryTypes, subscriptionType, marketDepth);
        this.sendMessage(message);
        logger_1.default.info(`Sent market data request for symbols: ${symbols.join(', ')}`);
    }
    /**
     * Send a security list request
     */
    sendSecurityListRequest(securityType) {
        if (!this.loggedIn) {
            logger_1.default.warn('Cannot send security list request: not logged in');
            return;
        }
        const message = message_builder_1.FixMessageBuilder.createSecurityListRequest(this.options.senderCompId, this.options.targetCompId, securityType);
        this.sendMessage(message);
        logger_1.default.info('Sent security list request');
    }
    /**
     * Send a trading session status request
     */
    sendTradingSessionStatusRequest(tradingSessionId) {
        if (!this.loggedIn) {
            logger_1.default.warn('Cannot send trading session status request: not logged in');
            return;
        }
        const message = message_builder_1.FixMessageBuilder.createTradingSessionStatusRequest(this.options.senderCompId, this.options.targetCompId, tradingSessionId);
        this.sendMessage(message);
        logger_1.default.info('Sent trading session status request');
    }
    formatMessageForLogging(message) {
        // Implement the logic to format the message for logging
        return message;
    }
}
exports.FixClient = FixClient;
