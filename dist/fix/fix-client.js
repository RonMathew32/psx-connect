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
const uuid_1 = require("uuid");
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
    let messageBuilder = (0, message_builder_1.createMessageBuilder)();
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
            // Log the raw message in FIX format (replacing SOH with pipe for readability)
            logger_1.default.info(`Received FIX message: ${message}`);
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.default.warn('Could not parse FIX message');
                return;
            }
            // Log message type for debugging
            const messageType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
            logger_1.default.info(`Message type: ${messageType} (${getMessageTypeName(messageType)})`);
            // Track server's sequence number if available
            if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const serverSeq = parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                logger_1.default.info(`Server sequence number: ${serverSeq}`);
            }
            // Emit the raw message
            emitter.emit('message', parsedMessage);
            // Process specific message types
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
                case constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
                    logger_1.default.info(`Received market data snapshot: ${JSON.stringify(parsedMessage)}`);
                    handleMarketDataSnapshot(parsedMessage);
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    logger_1.default.info(`Received market data incremental refresh: ${JSON.stringify(parsedMessage)}`);
                    handleMarketDataIncremental(parsedMessage);
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    handleSecurityList(parsedMessage);
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    handleTradingSessionStatus(parsedMessage);
                    break;
                case 'f': // Trading Status - specific PSX format
                    logger_1.default.info(`Received TRADING STATUS message: ${JSON.stringify(parsedMessage)}`);
                    handleTradingStatus(parsedMessage);
                    break;
                case constants_1.MessageType.REJECT:
                    logger_1.default.error(`Received REJECT message: ${JSON.stringify(parsedMessage)}`);
                    if (parsedMessage[constants_1.FieldTag.TEXT]) {
                        logger_1.default.error(`Reject reason: ${parsedMessage[constants_1.FieldTag.TEXT]}`);
                    }
                    break;
                case 'Y': // Market Data Request Reject
                    logger_1.default.error(`Received MARKET DATA REQUEST REJECT message: ${JSON.stringify(parsedMessage)}`);
                    handleMarketDataRequestReject(parsedMessage);
                    break;
                default:
                    logger_1.default.info(`Received unhandled message type: ${messageType} (${getMessageTypeName(messageType)})`);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Get human-readable name for a message type
     */
    const getMessageTypeName = (msgType) => {
        // Find the message type name by its value
        for (const [name, value] of Object.entries(constants_1.MessageType)) {
            if (value === msgType) {
                return name;
            }
        }
        return 'UNKNOWN';
    };
    /**
     * Handle a market data snapshot message
     */
    const handleMarketDataSnapshot = (message) => {
        try {
            // Extract the request ID to identify which request this is responding to
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            const symbol = message[constants_1.FieldTag.SYMBOL];
            logger_1.default.info(`Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);
            // Process market data entries
            const marketDataItems = [];
            // Check if we have entries
            const noEntries = parseInt(message[constants_1.FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);
            if (noEntries > 0) {
                // Extract entries - in a real implementation, this would be more robust
                // and handle multiple entries properly by parsing groups
                for (let i = 0; i < 100; i++) { // Safe upper limit
                    const entryType = message[`${constants_1.FieldTag.MD_ENTRY_TYPE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_TYPE];
                    const price = message[`${constants_1.FieldTag.MD_ENTRY_PX}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_PX];
                    const size = message[`${constants_1.FieldTag.MD_ENTRY_SIZE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_SIZE];
                    if (!entryType)
                        break; // No more entries
                    marketDataItems.push({
                        symbol: symbol || '',
                        entryType,
                        price: price ? parseFloat(price) : undefined,
                        size: size ? parseFloat(size) : undefined,
                        timestamp: message[constants_1.FieldTag.SENDING_TIME]
                    });
                }
            }
            if (marketDataItems.length > 0) {
                logger_1.default.info(`Extracted ${marketDataItems.length} market data items for ${symbol}`);
                // Check if this is KSE data
                const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
                if (isKseData) {
                    logger_1.default.info(`Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
                    emitter.emit('kseData', marketDataItems);
                }
                // Also emit general market data event
                emitter.emit('marketData', marketDataItems);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a market data incremental refresh message
     */
    const handleMarketDataIncremental = (message) => {
        // Similar implementation to handleMarketDataSnapshot, but for incremental updates
        try {
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            logger_1.default.info(`Received market data incremental refresh for request: ${mdReqId}`);
            // Process incremental updates - simplified version
            const marketDataItems = [];
            // Parse the incremental updates and emit an event
            // Real implementation would be more robust
            if (marketDataItems.length > 0) {
                emitter.emit('marketData', marketDataItems);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a security list message
     */
    const handleSecurityList = (message) => {
        try {
            const reqId = message[constants_1.FieldTag.SECURITY_REQ_ID];
            logger_1.default.info(`Received security list for request: ${reqId}`);
            // Extract securities
            const securities = [];
            const noSecurities = parseInt(message[constants_1.FieldTag.NO_RELATED_SYM] || '0', 10);
            if (noSecurities > 0) {
                // Simplified parsing of security list - real implementation would handle groups properly
                // This is just a skeleton
                for (let i = 0; i < 100; i++) { // Safe upper limit
                    const symbol = message[`${constants_1.FieldTag.SYMBOL}.${i}`] || message[constants_1.FieldTag.SYMBOL];
                    const securityType = message[`${constants_1.FieldTag.SECURITY_TYPE}.${i}`] || message[constants_1.FieldTag.SECURITY_TYPE];
                    if (!symbol)
                        break; // No more securities
                    securities.push({
                        symbol,
                        securityType: securityType || '',
                        securityDesc: message[`${constants_1.FieldTag.SECURITY_DESC}.${i}`] || message[constants_1.FieldTag.SECURITY_DESC]
                    });
                }
            }
            if (securities.length > 0) {
                logger_1.default.info(`Extracted ${securities.length} securities`);
                emitter.emit('securityList', securities);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a trading session status message
     */
    const handleTradingSessionStatus = (message) => {
        try {
            const reqId = message[constants_1.FieldTag.TRAD_SES_REQ_ID];
            const sessionId = message[constants_1.FieldTag.TRADING_SESSION_ID];
            const status = message[constants_1.FieldTag.TRAD_SES_STATUS];
            logger_1.default.info(`Received trading session status for request: ${reqId}, session: ${sessionId}, status: ${status}`);
            const sessionInfo = {
                sessionId: sessionId || '',
                status: status || '',
                startTime: message[constants_1.FieldTag.START_TIME],
                endTime: message[constants_1.FieldTag.END_TIME]
            };
            emitter.emit('tradingSessionStatus', sessionInfo);
        }
        catch (error) {
            logger_1.default.error(`Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
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
            // Log the raw message with SOH delimiters replaced with pipes for readability
            // logger.debug(`Sending FIX message: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
            logger_1.default.debug(`Sending FIX message: ${message}`);
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
        // Reset our sequence number to ensure we start fresh
        msgSeqNum = 2; // Start from 2 since we just sent message 1 (logon)
        logger_1.default.info(`Successfully logged in to FIX server. Next sequence number: ${msgSeqNum}`);
        // Send our KSE request with the correct sequence number
        sendKseTradingStatusRequest();
    };
    /**
     * Check server features to understand its capabilities
     */
    const checkServerFeatures = () => {
        try {
            if (!socket || !connected) {
                return;
            }
            logger_1.default.info('Checking server features and capabilities...');
            // Try to determine what message types and fields are supported
            // 1. First try a simple test request to see if basic message flow works
            const testReqId = `TEST${Date.now()}`;
            const testMessage = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TEST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId)
                .buildMessage();
            socket.write(testMessage);
            logger_1.default.info(`Sent test request with ID: ${testReqId}`);
            // 2. Check if the server supports security status request
            // This can help identify what endpoint types are available
            setTimeout(() => {
                sendSecurityStatusRequest('KSE100');
            }, 2000);
        }
        catch (error) {
            logger_1.default.error('Error checking server features:', error);
        }
    };
    /**
     * Send a security status request to check if a symbol is valid
     */
    const sendSecurityStatusRequest = (symbol) => {
        try {
            if (!socket || !connected) {
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            // Security status request is type 'e' in FIX 4.4+
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType('e') // Security Status Request
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.SECURITY_STATUS_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SYMBOL, symbol)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .buildMessage();
            socket.write(message);
            logger_1.default.info(`Sent security status request for: ${symbol}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending security status request for ${symbol}:`, error);
            return null;
        }
    };
    /**
     * Handle market data request reject
     */
    const handleMarketDataRequestReject = (message) => {
        try {
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            const rejectReason = message[constants_1.FieldTag.MD_REJECT_REASON];
            const text = message[constants_1.FieldTag.TEXT];
            logger_1.default.error(`Market data request rejected for ID: ${mdReqId}`);
            logger_1.default.error(`Reject reason: ${rejectReason}`);
            if (text) {
                logger_1.default.error(`Text: ${text}`);
            }
            // Emit an event so client can handle this
            emitter.emit('marketDataReject', {
                requestId: mdReqId,
                reason: rejectReason,
                text: text
            });
        }
        catch (error) {
            logger_1.default.error(`Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Try alternative approaches to request KSE data
     */
    const tryAlternativeKseRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send alternative KSE request: not connected');
                return;
            }
            logger_1.default.info('Sending alternative KSE data request...');
            // Try with snapshot only instead of snapshot+updates
            const requestId = (0, uuid_1.v4)();
            const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];
            // Try different entry types in case index value is not supported
            const entryTypes = ['3', '0', '1']; // Index value, Bid, Offer
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0'); // 0 = Full Book
            // Skip MD_UPDATE_TYPE to see if that helps
            // Add symbols one by one with separate requests
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, '1'); // Just one symbol at a time
            message.addField(constants_1.FieldTag.SYMBOL, 'KSE100'); // Try just KSE100
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            // Try without the raw data fields
            const rawMessage = message.buildMessage();
            logger_1.default.info(`Alternative KSE request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            socket.write(rawMessage);
            // Also try individual symbol requests
            setTimeout(() => {
                for (const symbol of kseSymbols) {
                    logger_1.default.info(`Sending individual request for symbol: ${symbol}`);
                    sendIndividualSymbolRequest(symbol);
                }
            }, 2000);
        }
        catch (error) {
            logger_1.default.error('Error sending alternative KSE request:', error);
        }
    };
    /**
     * Send a request for an individual symbol
     */
    const sendIndividualSymbolRequest = (symbol) => {
        try {
            if (!socket || !connected) {
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
                .addField(constants_1.FieldTag.NO_RELATED_SYM, '1')
                .addField(constants_1.FieldTag.SYMBOL, symbol)
                .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1')
                .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3'); // 3 = Index value
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent individual symbol request for: ${symbol}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending individual symbol request for ${symbol}:`, error);
            return null;
        }
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
    const sendMarketDataRequest = (symbols, entryTypes = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType = '1' // Default: 1 = Snapshot + Updates
    ) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType) // Subscription type
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    /**
     * Send a security list request
     */
    const sendSecurityListRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send security list request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info('Sent security list request');
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending security list request:', error);
            return null;
        }
    };
    /**
     * Send a trading session status request
     */
    const sendTradingSessionStatusRequest = (tradingSessionID) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send trading session status request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1'); // 1 = Snapshot + Updates
            // Add trading session ID if provided
            if (tradingSessionID) {
                message.addField(constants_1.FieldTag.TRADING_SESSION_ID, tradingSessionID);
            }
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent trading session status request${tradingSessionID ? ` for session ${tradingSessionID}` : ''}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending trading session status request:', error);
            return null;
        }
    };
    /**
     * Send a request specifically for KSE (Karachi Stock Exchange) data
     */
    const sendKseDataRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send KSE data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`Creating KSE data request with ID: ${requestId}`);
            // Add KSE index or key symbols
            const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];
            // Add entry types - for indices we typically want the index value
            const entryTypes = ['3']; // 3 = Index Value
            logger_1.default.info(`Requesting symbols: ${kseSymbols.join(', ')} with entry types: ${entryTypes.join(', ')}`);
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0'); // 0 = Full Refresh
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, kseSymbols.length.toString());
            for (const symbol of kseSymbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            // Add custom KSE identifier field if needed
            if (options.rawData === 'kse') {
                logger_1.default.info(`Adding raw data field: ${options.rawData} with length: ${options.rawDataLength}`);
                message.addField(constants_1.FieldTag.RAW_DATA_LENGTH, options.rawDataLength?.toString() || '3');
                message.addField(constants_1.FieldTag.RAW_DATA, 'kse');
            }
            const rawMessage = message.buildMessage();
            logger_1.default.info(`KSE data request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            socket.write("8=FIXT.1.19=30935=W49=NMDUFISQ000156=realtime34=24352=20250422-09:36:34.04942=20250422-09:36:30.00010201=101500=90055=KSE308538=T140=0.00008503=87608387=88354352.008504=12327130577.0100268=5269=xa270=36395.140900269=3270=36540.202900269=xb270=36431.801100269=xc270=36656.369500269=xd270=36313.90940010=057");
            logger_1.default.info(`Sent KSE data request for indices: ${kseSymbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending KSE data request:', error);
            return null;
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
            // Reset sequence number for new connection
            msgSeqNum = 1;
            // Use the hardcoded logon message but ensure sequence is 1
            let logonMessage = "8=FIXT.1.19=12735=A34=149=realtime52=20250422-09:36:31.27556=NMDUFISQ000198=0108=30141=Y554=NMDUFISQ00011137=91408=FIX5.00_PSX_1.0010=159";
            // Make sure sequence number is 1
            logger_1.default.info(`Sending Logon Message: ${logonMessage}`);
            sendMessage(logonMessage);
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
    /**
     * Send a trading status request for KSE symbols
     * This specifically requests trading status (MsgType=f) data for KSE-related symbols
     */
    const sendKseTradingStatusRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send KSE trading status request: not connected');
                return null;
            }
            // Store original message 
            let baseMessage = "8=FIXT.1.19=30935=W49=NMDUFISQ000156=realtime34=24352=20250422-09:36:34.04942=20250422-09:36:30.00010201=101500=90055=KSE308538=T140=0.00008503=87608387=88354352.008504=12327130577.0100268=5269=xa270=36395.140900269=3270=36540.202900269=xb270=36431.801100269=xc270=36656.369500269=xd270=36313.90940010=057";
            // Ensure current sequence number is used
            const currentSeqNum = msgSeqNum++;
            // Insert correct sequence number - use a more precise regex to avoid issues
            const newMessage = baseMessage.replace(/(?<=34=)\d+/, currentSeqNum.toString());
            logger_1.default.info(`Current sequence number: ${currentSeqNum}`);
            logger_1.default.info(`KSE trading status request - sending with sequence ${currentSeqNum}: ${newMessage}`);
            socket.write(newMessage);
            logger_1.default.info(`Sent KSE request with sequence number ${currentSeqNum}`);
        }
        catch (error) {
            logger_1.default.error('Error sending KSE trading status request:', error);
            return null;
        }
    };
    /**
     * Handle trading status message - specific format for PSX
     */
    const handleTradingStatus = (message) => {
        try {
            const symbol = message[constants_1.FieldTag.SYMBOL];
            const sendingTime = message[constants_1.FieldTag.SENDING_TIME];
            const origTime = message['42']; // OrigTime
            const tradingStatus = message['102']; // Trading Status
            logger_1.default.info(`Received TRADING STATUS for ${symbol}:`);
            logger_1.default.info(`  Status: ${tradingStatus}`);
            logger_1.default.info(`  Time: ${sendingTime} (Orig: ${origTime})`);
            // Check if this is KSE data
            const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
            if (isKseData) {
                // Emit a KSE trading status event
                emitter.emit('kseTradingStatus', {
                    symbol,
                    status: tradingStatus,
                    timestamp: sendingTime,
                    origTime
                });
                // Convert to a market data item format for compatibility
                const marketDataItems = [{
                        symbol: symbol || '',
                        entryType: 'f', // Trading status as entry type
                        price: tradingStatus ? parseFloat(tradingStatus) : undefined,
                        timestamp: sendingTime
                    }];
                // Also emit as KSE data for backward compatibility
                emitter.emit('kseData', marketDataItems);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    // Return the public API
    return {
        on: (event, listener) => emitter.on(event, listener),
        connect,
        disconnect,
        sendMarketDataRequest,
        sendSecurityListRequest,
        sendTradingSessionStatusRequest,
        sendKseDataRequest,
        sendKseTradingStatusRequest,
        sendSecurityStatusRequest,
        sendLogon,
        sendLogout,
        start,
        stop
    };
}
