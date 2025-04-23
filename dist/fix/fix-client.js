"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixClient = void 0;
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const constants_1 = require("./constants");
const logger_1 = __importDefault(require("../utils/logger"));
const net_1 = require("net");
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
        this.logonTimer = null;
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
     * Connect to the FIX server
     */
    connect() {
        if (this.socket && this.connected) {
            logger_1.default.warn('Already connected');
            return;
        }
        logger_1.default.info(`Connecting to ${this.options.host}:${this.options.port}`);
        try {
            // Create socket with specific configuration - matching fn-psx
            this.socket = new net_1.Socket();
            // Apply socket settings exactly like fn-psx
            this.socket.setKeepAlive(true);
            this.socket.setNoDelay(true);
            // Set connection timeout 
            this.socket.setTimeout(this.options.connectTimeoutMs || 30000);
            // Setup event handlers
            this.socket.on('timeout', () => {
                logger_1.default.error('Connection timed out');
                this.socket?.destroy();
                this.connected = false;
                this.emit('error', new Error('Connection timed out'));
            });
            this.socket.on('error', (error) => {
                logger_1.default.error(`Socket error: ${error.message}`);
                this.emit('error', error);
            });
            this.socket.on('close', () => {
                logger_1.default.info('Socket disconnected');
                this.connected = false;
                this.emit('disconnected');
                this.scheduleReconnect();
            });
            // Handle received data
            this.socket.on('data', (data) => {
                this.handleData(data);
            });
            // The key difference - on connect, send logon immediately without VPN check
            // This matches fn-psx behavior
            this.socket.on('connect', () => {
                logger_1.default.info(`Connected to ${this.options.host}:${this.options.port}`);
                this.connected = true;
                // Clear any existing timeout to prevent duplicate logon attempts
                if (this.logonTimer) {
                    clearTimeout(this.logonTimer);
                }
                // Send logon message after a short delay - exactly like fn-psx
                this.logonTimer = setTimeout(() => {
                    try {
                        logger_1.default.info('Sending logon message...');
                        this.sendLogon();
                    }
                    catch (error) {
                        logger_1.default.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
                        this.disconnect();
                    }
                }, 500);
                this.emit('connected');
            });
            // Connect to the server
            logger_1.default.info(`Establishing TCP connection to ${this.options.host}:${this.options.port}...`);
            this.socket.connect(this.options.port, this.options.host);
        }
        catch (error) {
            logger_1.default.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
            this.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
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
            logger_1.default.debug(`Received data: ${dataStr.length} bytes`);
            // Handle complete messages
            this.receivedData += dataStr;
            this.processMessage(this.receivedData);
            this.receivedData = '';
        }
        catch (error) {
            logger_1.default.error(`Error processing received data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Process a complete FIX message
     */
    processMessage(message) {
        try {
            logger_1.default.debug(`Processing message: ${message}`);
            // Basic parsing for FIX message
            const parsedMessage = this.parseFixMessage(message);
            // Simple extraction of message type
            const msgType = this.getMessageType(message);
            logger_1.default.debug(`Received message type: ${msgType}`);
            // Handle different message types
            if (msgType === 'A') {
                // Logon
                logger_1.default.info('Logon response received');
                this.loggedIn = true;
                this.emit('logon', parsedMessage);
            }
            else if (msgType === '5') {
                // Logout
                logger_1.default.info('Logout message received');
                this.loggedIn = false;
                this.emit('logout', parsedMessage);
            }
            else if (msgType === '0') {
                // Heartbeat
                logger_1.default.debug('Heartbeat received');
            }
            else if (msgType === '1') {
                // Test request
                logger_1.default.debug('Test request received');
                // Send heartbeat in response
                const testReqId = this.getField(message, '112');
                if (testReqId) {
                    this.sendHeartbeat(testReqId);
                }
            }
            else {
                // Other message types
                logger_1.default.debug(`Received message type ${msgType}`);
                this.emit('message', parsedMessage);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Basic parsing of FIX message into tag-value pairs
     */
    parseFixMessage(message) {
        const result = {};
        // Simple regex to extract fields
        const regex = /(\d+)=([^,;\s]*)/g;
        let match;
        while (match = regex.exec(message)) {
            const [, tag, value] = match;
            result[tag] = value;
        }
        return result;
    }
    /**
     * Extract message type from FIX message
     */
    getMessageType(message) {
        const match = message.match(/35=([^,;\s]*)/);
        return match ? match[1] : '';
    }
    /**
     * Extract field value from FIX message
     */
    getField(message, tag) {
        const regex = new RegExp(tag + '=([^,;\s]*)');
        const match = message.match(regex);
        return match ? match[1] : undefined;
    }
    /**
     * Send a heartbeat message in response to test request
     */
    sendHeartbeat(testReqId) {
        try {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
            const heartbeat = `8=FIXT.1.19=6535=034=249=${this.options.senderCompId}52=${timestamp}56=${this.options.targetCompId}112=${testReqId}10=000`;
            if (this.socket && this.connected) {
                this.socket.write(heartbeat);
                logger_1.default.debug(`Sent heartbeat in response to test request: ${testReqId}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Failed to send heartbeat: ${error instanceof Error ? error.message : String(error)}`);
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
                // Find position to insert PSX specific fields after MsgType
                const msgParts = message.split(constants_1.SOH);
                let modifiedMessage = '';
                // Add PSX specific fields after MsgType (35=...)
                for (let i = 0; i < msgParts.length; i++) {
                    modifiedMessage += msgParts[i] + constants_1.SOH;
                    // After MsgType field, add PSX specific fields
                    if (msgParts[i].startsWith('35=')) {
                        modifiedMessage += `1137=9${constants_1.SOH}`; // DefaultApplVerID
                        modifiedMessage += `1129=FIX5.00_PSX_1.00${constants_1.SOH}`; // DefaultCstmApplVerID
                        modifiedMessage += `115=600${constants_1.SOH}`; // OnBehalfOfCompID
                        modifiedMessage += `96=kse${constants_1.SOH}`; // RawData
                        modifiedMessage += `95=3${constants_1.SOH}`; // RawDataLength
                    }
                }
                // Use the modified message with PSX fields
                message = modifiedMessage;
                // Need to recalculate body length and checksum
                // Extract the message parts (without checksum)
                const checksumPos = message.lastIndexOf('10=');
                const messageWithoutChecksum = message.substring(0, checksumPos);
                // Extract the header
                const bodyLengthPos = message.indexOf('9=');
                const headerEnd = message.indexOf(constants_1.SOH, bodyLengthPos) + 1;
                const header = message.substring(0, headerEnd);
                // Extract the body
                const body = message.substring(headerEnd, checksumPos);
                // Calculate new body length (without SOH characters)
                const bodyLengthValue = body.replace(new RegExp(constants_1.SOH, 'g'), '').length;
                // Create new message with updated body length
                const newMessage = `8=FIXT.1.1${constants_1.SOH}9=${bodyLengthValue}${constants_1.SOH}${body}`;
                // Calculate new checksum
                let sum = 0;
                for (let i = 0; i < newMessage.length; i++) {
                    sum += newMessage.charCodeAt(i);
                }
                const checksum = (sum % 256).toString().padStart(3, '0');
                // Final message with updated checksum
                message = newMessage + `10=${checksum}${constants_1.SOH}`;
            }
            logger_1.default.debug(`Sending: ${message.replace(/\x01/g, '|')}`);
            logger_1.default.debug(`Sending: ${message}`);
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
        try {
            logger_1.default.info('Logon successful - authenticated with PSX server');
            this.loggedIn = true;
            this.testRequestCount = 0;
            // Get server's message sequence number
            const serverSeqNum = parseInt(message['34'] || '1', 10);
            logger_1.default.debug(`Server message sequence number: ${serverSeqNum}`);
            // Reset sequence number if requested
            if (message['141'] === 'Y') { // ResetSeqNumFlag
                this.msgSeqNum = 1;
                logger_1.default.debug('Sequence number reset to 1 based on server response');
            }
            else {
                // Increment our sequence number
                this.msgSeqNum = 2; // After logon, next message should be 2
                logger_1.default.debug('Sequence number set to 2 for next message');
            }
            // Check for PSX-specific fields
            if (message['1137'] && message['1129']) {
                logger_1.default.info('PSX-specific fields present in logon response');
            }
            // Start sending heartbeats
            this.startHeartbeatMonitoring();
            // Emit logon event
            this.emit('logon', message);
            logger_1.default.info('Ready to send FIX messages to PSX');
        }
        catch (error) {
            logger_1.default.error(`Error handling logon response: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger_1.default.debug(`Error stack: ${error.stack}`);
            }
        }
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
     * Start heartbeat monitoring
     */
    startHeartbeatMonitoring() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        const heartbeatInterval = this.options.heartbeatIntervalSecs * 1000;
        logger_1.default.info(`Starting heartbeat monitoring with interval of ${this.options.heartbeatIntervalSecs} seconds`);
        this.heartbeatTimer = setInterval(() => {
            try {
                const currentTime = Date.now();
                const timeSinceLastActivity = currentTime - this.lastActivityTime;
                // If no activity for more than heartbeat interval, send a heartbeat
                if (timeSinceLastActivity >= heartbeatInterval) {
                    // If no response to multiple test requests, consider connection dead
                    if (this.testRequestCount >= 2) {
                        logger_1.default.warn('No response to test requests after multiple attempts, connection may be dead');
                        logger_1.default.warn('Destroying socket and attempting to reconnect');
                        if (this.socket) {
                            this.socket.destroy();
                            this.socket = null;
                        }
                        return;
                    }
                    // After 1.5 intervals without activity, send a test request instead of heartbeat
                    if (timeSinceLastActivity >= heartbeatInterval * 1.5) {
                        logger_1.default.debug('Sending test request to verify connection');
                        // Create test request with current sequence number
                        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 21);
                        const testReqId = `TEST-${timestamp}`;
                        const testRequest = message_builder_1.FixMessageBuilder.createTestRequestMessage(this.options.senderCompId, this.options.targetCompId, testReqId);
                        this.sendMessage(testRequest);
                        this.testRequestCount++;
                        logger_1.default.debug(`Test request count: ${this.testRequestCount}`);
                    }
                    else {
                        logger_1.default.debug('Sending heartbeat to maintain connection');
                        // Create heartbeat with current sequence number
                        const heartbeat = message_builder_1.FixMessageBuilder.createHeartbeatMessage(this.options.senderCompId, this.options.targetCompId);
                        this.sendMessage(heartbeat);
                    }
                }
            }
            catch (error) {
                logger_1.default.error(`Error in heartbeat monitoring: ${error instanceof Error ? error.message : String(error)}`);
                if (error instanceof Error && error.stack) {
                    logger_1.default.debug(`Error stack: ${error.stack}`);
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
    /**
     * Send a logon message - exactly as fn-psx does
     */
    sendLogon() {
        logger_1.default.info("Sending logon message...");
        // Format timestamp to match FIX standard: YYYYMMDD-HH:MM:SS.sss
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');
        const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
        const timestamp = `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
        try {
            // Exactly match the fn-psx logon message format with no delimiters
            const logonMessage = "8=FIXT.1.19=12735=A34=149=" +
                this.options.senderCompId +
                "52=" + timestamp +
                "56=" + this.options.targetCompId +
                "98=0108=" + this.options.heartbeatIntervalSecs +
                "141=Y554=" + this.options.password +
                "1137=91408=FIX5.00_PSX_1.0010=153";
            logger_1.default.info(`Logon message: ${logonMessage}`);
            if (!this.socket || !this.connected) {
                logger_1.default.warn('Cannot send logon: not connected');
                return;
            }
            // Simple socket write - exactly as fn-psx does it
            this.socket.write(logonMessage);
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
        try {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
            const logoutMessage = `8=FIXT.1.19=6535=534=349=${this.options.senderCompId}52=${timestamp}56=${this.options.targetCompId}10=000`;
            if (this.socket && this.connected) {
                this.socket.write(logoutMessage);
                logger_1.default.info('Sent logout message');
            }
        }
        catch (error) {
            logger_1.default.error(`Failed to send logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    formatMessageForLogging(message) {
        // Implement the logic to format the message for logging
        return message;
    }
}
exports.FixClient = FixClient;
