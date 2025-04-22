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
     * Connect to the FIX server
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.socket) {
                logger_1.default.warn('Socket already exists, disconnecting first');
                this.socket.destroy();
                this.socket = null;
            }
            // Reset state
            this.connected = false;
            this.loggedIn = false;
            this.receivedData = '';
            this.lastActivityTime = 0;
            this.testRequestCount = 0;
            // Reset sequence number on each reconnect
            this.msgSeqNum = 1;
            logger_1.default.info(`Connecting to PSX at ${this.options.host}:${this.options.port}`);
            try {
                // Create TCP socket with settings that match the Go implementation
                this.socket = net_1.default.createConnection({
                    host: this.options.host,
                    port: this.options.port,
                    noDelay: true, // Disable Nagle's algorithm for better performance with FIX protocol
                    keepAlive: true, // Keep connection alive
                    timeout: 30000 // 30 second timeout
                });
                // Set up socket event handlers
                this.setupSocketHandlers();
                // Handle successful connection
                this.socket.once('connect', () => {
                    logger_1.default.info('Socket connected successfully');
                    // Connection established, continue with authentication
                    resolve();
                });
                // Handle connection error
                this.socket.once('error', (error) => {
                    logger_1.default.error(`Socket connection error: ${error.message}`);
                    if (this.socket) {
                        this.socket.destroy();
                        this.socket = null;
                    }
                    reject(error);
                });
            }
            catch (error) {
                logger_1.default.error(`Error creating socket: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
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
            const localAddress = this.socket?.localAddress;
            const localPort = this.socket?.localPort;
            logger_1.default.debug(`Connected to ${this.options.host}:${this.options.port}`);
            logger_1.default.debug(`Local address: ${localAddress}:${localPort}`);
            // Wait before sending logon to ensure socket is fully established
            // This delay matches the behavior observed in the Go implementation
            setTimeout(() => {
                // Send logon message to authenticate
                this.sendLogon();
            }, 500);
            this.emit('connected');
        });
        this.socket.on('data', (data) => {
            this.handleData(data);
        });
        this.socket.on('error', (error) => {
            logger_1.default.error(`Socket error: ${error.message}`);
            if (error.stack) {
                logger_1.default.debug(`Error stack: ${error.stack}`);
            }
            // Check specific error codes and respond accordingly
            if ('code' in error) {
                const code = error.code;
                if (code === 'ECONNREFUSED') {
                    logger_1.default.error(`Connection refused to ${this.options.host}:${this.options.port}. Server may be down or unreachable.`);
                }
                else if (code === 'ETIMEDOUT') {
                    logger_1.default.error(`Connection timed out to ${this.options.host}:${this.options.port}`);
                }
            }
            this.emit('error', error);
        });
        this.socket.on('close', (hadError) => {
            logger_1.default.info(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
            this.connected = false;
            this.loggedIn = false;
            this.clearTimers();
            this.emit('disconnected');
            // Check if data was ever received
            if (this.lastActivityTime === 0) {
                logger_1.default.warn('Connection closed without any data received - server may have rejected the connection');
                logger_1.default.warn('Check credentials and network connectivity to the FIX server');
                logger_1.default.warn('Make sure your OnBehalfOfCompID, RawData, and RawDataLength fields are correct');
            }
            this.scheduleReconnect();
        });
        this.socket.on('timeout', () => {
            logger_1.default.warn('Socket timeout - connection inactive');
            if (this.connected && this.loggedIn) {
                // If we're logged in, try sending a test request to keep the connection alive
                logger_1.default.warn('Sending test request to check if server is still responsive');
                try {
                    const testRequest = message_builder_1.FixMessageBuilder.createTestRequestMessage(this.options.senderCompId, this.options.targetCompId);
                    if (this.socket) {
                        this.socket.write(testRequest);
                    }
                }
                catch (error) {
                    logger_1.default.error('Failed to send test request, destroying socket');
                    if (this.socket) {
                        this.socket.destroy();
                        this.socket = null;
                    }
                }
            }
            else {
                // If we're not yet logged in, the connection attempt failed
                logger_1.default.error('Socket timeout during connection attempt - server did not respond');
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
            }
        });
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
                // Verify checksum before processing
                if (!message_parser_1.FixMessageParser.verifyChecksum(completeMessage)) {
                    logger_1.default.warn('Invalid checksum in message, skipping processing');
                    continue;
                }
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
        try {
            logger_1.default.debug(`Processing received message: ${message.replace(/\x01/g, '|')}`);
            if (!message_parser_1.FixMessageParser.verifyChecksum(message)) {
                logger_1.default.warn('Invalid checksum in message, rejecting');
                return;
            }
            const parsedMessage = message_parser_1.FixMessageParser.parse(message);
            // Emit the raw message event for debugging and custom handling
            this.emit('message', parsedMessage);
            // Log the message type for debugging
            const msgType = parsedMessage['35']; // MsgType
            logger_1.default.debug(`Processing message type: ${msgType}`);
            // Handle different message types
            if (message_parser_1.FixMessageParser.isLogon(parsedMessage)) {
                // Logon acknowledged by server
                logger_1.default.info(`Logon response received: ${JSON.stringify(parsedMessage)}`);
                this.handleLogon(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isLogout(parsedMessage)) {
                // Server is logging us out
                const text = parsedMessage['58'] || 'No reason provided'; // Text field
                logger_1.default.info(`Logout received with reason: ${text}`);
                this.handleLogout(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isHeartbeat(parsedMessage)) {
                // Heartbeat from server, reset activity timer
                logger_1.default.debug('Heartbeat received');
                this.testRequestCount = 0; // Reset test request counter
            }
            else if (message_parser_1.FixMessageParser.isTestRequest(parsedMessage)) {
                // Test request from server, respond with heartbeat
                const testReqId = parsedMessage['112'] || ''; // TestReqID
                logger_1.default.debug(`Test request received with ID: ${testReqId}`);
                this.handleTestRequest(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isReject(parsedMessage)) {
                // Message rejected by server
                const rejectText = parsedMessage['58'] || 'No reason provided'; // Text
                const rejectReason = parsedMessage['373'] || 'Unknown'; // SessionRejectReason
                logger_1.default.error(`Reject message received: ${rejectText}, reason: ${rejectReason}`);
                this.handleReject(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isMarketDataSnapshot(parsedMessage)) {
                // Market data snapshot from server
                // Check if this is a PSX-specific format
                if (parsedMessage['1137'] === '9' && parsedMessage['1129'] === 'FIX5.00_PSX_1.00') {
                    logger_1.default.debug('Received PSX-specific market data snapshot');
                }
                this.handleMarketDataSnapshot(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isMarketDataIncremental(parsedMessage)) {
                // Market data incremental update from server
                // Check if this is a PSX-specific format
                if (parsedMessage['1137'] === '9' && parsedMessage['1129'] === 'FIX5.00_PSX_1.00') {
                    logger_1.default.debug('Received PSX-specific market data update');
                }
                this.handleMarketDataIncremental(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isSecurityList(parsedMessage)) {
                // Security list from server
                this.handleSecurityList(parsedMessage);
            }
            else if (message_parser_1.FixMessageParser.isTradingSessionStatus(parsedMessage)) {
                // Trading session status from server
                this.handleTradingSessionStatus(parsedMessage);
            }
            else {
                // Unknown message type
                logger_1.default.debug(`Unhandled message type: ${msgType}`);
                logger_1.default.debug(`Message content: ${JSON.stringify(parsedMessage)}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger_1.default.debug(`Error stack: ${error.stack}`);
            }
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
        // Build the message body in the exact order required by PSX
        // This matches the format observed in the Go implementation
        const bodyFields = [
            `35=A${constants_1.SOH}`, // MsgType (Logon) - always the first field after BeginString and BodyLength
            `34=1${constants_1.SOH}`, // MsgSeqNum - use 1 for logon to ensure proper sequence reset
            `49=${this.options.senderCompId}${constants_1.SOH}`, // SenderCompID
            `56=${this.options.targetCompId}${constants_1.SOH}`, // TargetCompID
            `52=${timestamp}${constants_1.SOH}`, // SendingTime - exact timestamp format is critical
            `98=0${constants_1.SOH}`, // EncryptMethod - always 0 for no encryption
            `108=${this.options.heartbeatIntervalSecs}${constants_1.SOH}`, // HeartBtInt - heartbeat interval in seconds
            `141=Y${constants_1.SOH}`, // ResetSeqNumFlag - Y to reset sequence numbers
            `553=${this.options.username}${constants_1.SOH}`, // Username
            `554=${this.options.password}${constants_1.SOH}`, // Password
            // PSX-specific authentication fields
            `1137=9${constants_1.SOH}`, // DefaultApplVerID - must be exactly 9 for PSX
            `1129=FIX5.00_PSX_1.00${constants_1.SOH}`, // DefaultCstmApplVerID - exactly as specified by PSX
            `115=600${constants_1.SOH}`, // OnBehalfOfCompID - must be exactly 600 for PSX
            `96=kse${constants_1.SOH}`, // RawData - must be exactly "kse" for PSX
            `95=3${constants_1.SOH}`, // RawDataLength - must be exactly 3 (length of "kse") for PSX
        ].join('');
        // Calculate body length (excluding SOH characters)
        const bodyLengthValue = bodyFields.replace(new RegExp(constants_1.SOH, 'g'), '').length;
        // Construct the complete message with header
        const message = [
            `8=FIXT.1.1${constants_1.SOH}`, // BeginString - must be exactly FIXT.1.1
            `9=${bodyLengthValue}${constants_1.SOH}`, // BodyLength
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
        logger_1.default.debug(`Logon message: ${finalMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
        logger_1.default.debug(`Logon message: ${finalMessage}`);
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
    formatMessageForLogging(message) {
        // Implement the logic to format the message for logging
        return message;
    }
}
exports.FixClient = FixClient;
