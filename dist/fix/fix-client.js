"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixClient = createFixClient;
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const message_parser_1 = require("./message-parser");
const constants_1 = require("./constants");
const logger_1 = __importDefault(require("../utils/logger"));
const net_1 = require("net");
/**
 * Create a FIX client with the specified options
 */
function createFixClient(options) {
    const emitter = new events_1.EventEmitter();
    let socket = null;
    let connected = false;
    let loggedIn = false;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let messageSequenceNumber = 1;
    let receivedData = '';
    let lastActivityTime = 0;
    let testRequestCount = 0;
    let lastSentTime = new Date();
    let msgSeqNum = 1;
    let logonTimer = null;
    /**
     * Start the FIX client and connect to the server
     */
    const start = () => {
        connect();
    };
    /**
     * Stop the FIX client and disconnect from the server
     */
    const stop = () => {
        disconnect();
    };
    /**
     * Connect to the FIX server
     */
    const connect = async () => {
        if (socket && connected) {
            logger_1.default.warn('Already connected');
            return;
        }
        try {
            // Create socket with specific configuration - matching fn-psx
            socket = new net_1.Socket();
            // Apply socket settings exactly like fn-psx
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            // Set connection timeout 
            socket.setTimeout(options.connectTimeoutMs || 30000);
            // Setup event handlers
            socket.on('timeout', () => {
                logger_1.default.error('Connection timed out');
                socket?.destroy();
                connected = false;
                emitter.emit('error', new Error('Connection timed out'));
            });
            socket.on('error', (error) => {
                logger_1.default.error(`Socket error: ${error.message}`);
                emitter.emit('error', error);
            });
            socket.on('close', () => {
                logger_1.default.info('Socket disconnected');
                connected = false;
                emitter.emit('disconnected');
                scheduleReconnect();
            });
            // Handle received data
            socket.on('data', (data) => {
                handleData(data);
            });
            socket.on('connect', () => {
                logger_1.default.info(`Connected to ${options.host}:${options.port}`);
                connected = true;
                // Clear any existing timeout to prevent duplicate logon attempts
                if (logonTimer) {
                    clearTimeout(logonTimer);
                }
                // Send logon message after a short delay - exactly like fn-psx
                logonTimer = setTimeout(() => {
                    try {
                        logger_1.default.info('Sending logon message...');
                        sendLogon();
                    }
                    catch (error) {
                        logger_1.default.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
                        disconnect();
                    }
                }, 500);
                emitter.emit('connected');
            });
            // Connect to the server
            logger_1.default.info(`Establishing TCP connection to ${options.host}:${options.port}...`);
            socket.connect(options.port, options.host);
        }
        catch (error) {
            logger_1.default.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    };
    /**
     * Disconnect from the FIX server
     */
    const disconnect = () => {
        return new Promise((resolve) => {
            clearTimers();
            if (connected && loggedIn) {
                sendLogout();
            }
            if (socket) {
                socket.destroy();
                socket = null;
            }
            connected = false;
            loggedIn = false;
            resolve();
        });
    };
    /**
     * Schedule a reconnection attempt
     */
    const scheduleReconnect = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        logger_1.default.info('Scheduling reconnect in 5 seconds');
        reconnectTimer = setTimeout(() => {
            logger_1.default.info('Attempting to reconnect');
            connect();
        }, 5000);
    };
    /**
     * Clear all timers
     */
    const clearTimers = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };
    /**
     * Handle incoming data from the socket
     */
    const handleData = (data) => {
        try {
            lastActivityTime = Date.now();
            const dataStr = data.toString();
            logger_1.default.debug(`Received data: ${dataStr.length} bytes`);
            // Handle complete messages
            receivedData += dataStr;
            processMessage(receivedData);
            receivedData = '';
        }
        catch (error) {
            logger_1.default.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Process a FIX message
     */
    const processMessage = (message) => {
        try {
            const segments = message.split(constants_1.SOH);
            // FIX message should start with "8=FIX"
            const fixVersion = segments.find(s => s.startsWith('8=FIX'));
            if (!fixVersion) {
                logger_1.default.warn('Received non-FIX message');
                return;
            }
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.default.warn('Could not parse FIX message');
                return;
            }
            // Emit the raw message
            emitter.emit('message', parsedMessage);
            // Process specific message types
            const messageType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
            switch (messageType) {
                case constants_1.MessageType.LOGON:
                    handleLogon(parsedMessage);
                    break;
                case constants_1.MessageType.LOGOUT:
                    handleLogout(parsedMessage);
                    break;
                case constants_1.MessageType.HEARTBEAT:
                    // Just log and reset the test request counter
                    testRequestCount = 0;
                    break;
                case constants_1.MessageType.TEST_REQUEST:
                    // Respond with heartbeat
                    sendHeartbeat(parsedMessage[constants_1.FieldTag.TEST_REQ_ID]);
                    break;
                // Add more message type handlers as needed
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a heartbeat message
     */
    const sendHeartbeat = (testReqId) => {
        if (!connected)
            return;
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.HEARTBEAT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++);
            if (testReqId) {
                builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
            }
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a FIX message to the server
     */
    const sendMessage = (message) => {
        if (!socket || !connected) {
            logger_1.default.warn('Cannot send message, not connected');
            return;
        }
        try {
            // Log the raw message including SOH delimiters
            logger_1.default.debug(`Sending: ${message}`);
            // Send the message
            socket.write(message);
            lastSentTime = new Date();
        }
        catch (error) {
            logger_1.default.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            // On send error, try to reconnect
            socket?.destroy();
            connected = false;
        }
    };
    /**
     * Handle a logon message from the server
     */
    const handleLogon = (message) => {
        loggedIn = true;
        // Reset sequence numbers if requested
        if (options.resetOnLogon) {
            msgSeqNum = 1;
        }
        // Start heartbeat monitoring
        startHeartbeatMonitoring();
        // Emit logon event
        emitter.emit('logon', message);
        logger_1.default.info('Successfully logged in to FIX server');
    };
    /**
     * Handle a logout message from the server
     */
    const handleLogout = (message) => {
        loggedIn = false;
        // Emit logout event
        emitter.emit('logout', message);
        // Clear the heartbeat timer as we're logged out
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        logger_1.default.info('Logged out from FIX server');
    };
    /**
     * Start the heartbeat monitoring process
     */
    const startHeartbeatMonitoring = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }
        // Send heartbeat every N seconds (from options)
        const heartbeatInterval = options.heartbeatIntervalSecs * 1000;
        heartbeatTimer = setInterval(() => {
            const now = Date.now();
            const timeSinceLastActivity = now - lastActivityTime;
            // If we haven't received anything for 2x the heartbeat interval,
            // send a test request
            if (timeSinceLastActivity > heartbeatInterval * 2) {
                testRequestCount++;
                // If we've sent 3 test requests with no response, disconnect
                if (testRequestCount > 3) {
                    logger_1.default.warn('No response to test requests, disconnecting');
                    disconnect();
                    return;
                }
                // Send test request
                try {
                    const builder = (0, message_builder_1.createMessageBuilder)();
                    const testReqId = `TEST${Date.now()}`;
                    builder
                        .setMsgType(constants_1.MessageType.TEST_REQUEST)
                        .setSenderCompID(options.senderCompId)
                        .setTargetCompID(options.targetCompId)
                        .setMsgSeqNum(msgSeqNum++);
                    builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
                    const message = builder.buildMessage();
                    sendMessage(message);
                }
                catch (error) {
                    logger_1.default.error(`Error sending test request: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            else {
                // If we've received activity, just send a regular heartbeat
                sendHeartbeat('');
            }
        }, heartbeatInterval);
    };
    /**
     * Send a market data request
     */
    const sendMarketDataRequest = (symbols, entryTypes, subscriptionType, marketDepth = 0) => {
        if (!connected || !loggedIn) {
            logger_1.default.warn('Cannot send market data request, not logged in');
            return;
        }
        try {
            // Implement market data request logic here
            // This would be similar to the original class implementation
            // but using the functional style
            // For example:
            const builder = (0, message_builder_1.createMessageBuilder)();
            // Build market data request
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending market data request: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a security list request
     */
    const sendSecurityListRequest = (securityType) => {
        if (!connected || !loggedIn) {
            logger_1.default.warn('Cannot send security list request, not logged in');
            return;
        }
        try {
            // Implement security list request logic here
            // This would be similar to the original class implementation
            // For example:
            const builder = (0, message_builder_1.createMessageBuilder)();
            // Build security list request
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending security list request: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a trading session status request
     */
    const sendTradingSessionStatusRequest = (tradingSessionId) => {
        if (!connected || !loggedIn) {
            logger_1.default.warn('Cannot send trading session status request, not logged in');
            return;
        }
        try {
            // Implement trading session status request logic here
            // This would be similar to the original class implementation
            // For example:
            const builder = (0, message_builder_1.createMessageBuilder)();
            // Build trading session status request
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending trading session status request: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a logon message to the server
     */
    const sendLogon = () => {
        if (!connected) {
            logger_1.default.warn('Cannot send logon, not connected');
            return;
        }
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGON)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++);
            // Standard FIX Logon fields
            builder
                .addField(constants_1.FieldTag.ENCRYPT_METHOD, '0') // EncryptMethod
                .addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString()) // HeartBtInt
                .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, options.resetOnLogon ? 'Y' : 'N') // ResetSeqNumFlag
                .addField(constants_1.FieldTag.PASSWORD, options.password || '') // Password (554)
                .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9') // DefaultApplVerID (1137)
                .addField('1408', 'FIX5.00_PSX_1.00'); // ApplVerID custom field
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a logout message to the server
     */
    const sendLogout = (text) => {
        if (!connected) {
            logger_1.default.warn('Cannot send logout, not connected');
            return;
        }
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGOUT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++);
            if (text) {
                builder.addField(constants_1.FieldTag.TEXT, text);
            }
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Format a FIX message for logging (preserve SOH instead of using pipe)
     */
    const formatMessageForLogging = (message) => {
        return message;
    };
    // Return the public API
    return {
        on: (event, listener) => emitter.on(event, listener),
        connect,
        disconnect,
        sendMarketDataRequest,
        sendSecurityListRequest,
        sendTradingSessionStatusRequest,
        sendLogon,
        sendLogout,
        start,
        stop
    };
}
