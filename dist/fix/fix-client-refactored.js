"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixClient = createFixClient;
const net_1 = __importDefault(require("net"));
const events_1 = require("events");
const uuid_1 = require("uuid");
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("./constants");
const message_builder_1 = require("./message-builder");
const message_parser_1 = require("./message-parser");
const sequence_manager_1 = __importDefault(require("./sequence-manager"));
const session_manager_1 = __importStar(require("./session-manager"));
const market_data_handler_1 = __importDefault(require("./market-data-handler"));
const security_list_handler_1 = __importDefault(require("./security-list-handler"));
/**
 * Create a FIX client with the specified options
 */
function createFixClient(options) {
    // Core components
    const emitter = new events_1.EventEmitter();
    let socket = null;
    // Create managers
    const sequenceManager = new sequence_manager_1.default();
    const sessionManager = new session_manager_1.default({
        heartbeatIntervalSecs: options.heartbeatIntervalSecs,
        reconnectDelayMs: options.connectTimeoutMs || 5000
    });
    // Initialize socket-dependent handlers later
    let marketDataHandler = null;
    let securityListHandler = null;
    // Socket write function to be passed to handlers
    const socketWrite = (data) => {
        if (!socket || !sessionManager.isConnected()) {
            logger_1.default.warn('Cannot send message, not connected');
            return;
        }
        try {
            socket.write(data);
            logger_1.default.debug(`Sent message: ${data.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            emitter.emit('messageSent', data);
        }
        catch (error) {
            logger_1.default.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            if (socket) {
                socket.destroy();
                socket = null;
            }
            sessionManager.disconnected();
        }
    };
    /**
     * Initialize the specialized handlers once we have a socket connection
     */
    const initializeHandlers = () => {
        // Create market data handler
        marketDataHandler = new market_data_handler_1.default({
            senderCompId: options.senderCompId,
            targetCompId: options.targetCompId,
            onRequestSent: (requestId, symbols) => {
                logger_1.default.info(`Market data request sent: ${requestId} for ${symbols.join(', ')}`);
            },
            onDataReceived: (data) => {
                emitter.emit('marketData', data);
                // Check for KSE data
                if (data.length > 0 && data[0].symbol && data[0].symbol.includes('KSE')) {
                    emitter.emit('kseData', data);
                }
            }
        }, sequenceManager, socketWrite);
        // Create security list handler
        securityListHandler = new security_list_handler_1.default({
            senderCompId: options.senderCompId,
            targetCompId: options.targetCompId,
            onRequestSent: (requestId, type) => {
                logger_1.default.info(`Security list request sent: ${requestId} for ${type}`);
            },
            onDataReceived: (securities, type) => {
                logger_1.default.info(`Received ${securities.length} ${type} securities`);
                emitter.emit('securityList', securities);
            }
        }, sequenceManager, socketWrite);
    };
    /**
     * Connect to the FIX server
     */
    const connect = async () => {
        if (socket || sessionManager.isState(session_manager_1.SessionState.CONNECTING)) {
            logger_1.default.warn('Connection already in progress or established');
            return;
        }
        try {
            sessionManager.connecting();
            // Create socket with specific configuration
            socket = new net_1.default.Socket();
            // Apply socket settings
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            // Set connection timeout 
            socket.setTimeout(options.connectTimeoutMs || 30000);
            // Setup event handlers
            socket.on('timeout', () => {
                logger_1.default.error('Connection timed out');
                socket?.destroy();
                sessionManager.disconnected();
                emitter.emit('error', new Error('Connection timed out'));
            });
            socket.on('error', (error) => {
                logger_1.default.error(`Socket error: ${error.message}`);
                sessionManager.error(error.message);
                emitter.emit('error', error);
            });
            socket.on('close', () => {
                logger_1.default.info('Socket disconnected');
                sessionManager.disconnected();
                emitter.emit('disconnected');
                // Schedule reconnect if appropriate
                if (!sessionManager.isState(session_manager_1.SessionState.ERROR)) {
                    sessionManager.scheduleReconnect();
                }
            });
            // Handle received data
            socket.on('data', (data) => {
                handleData(data);
            });
            socket.on('connect', () => {
                logger_1.default.info(`Connected to ${options.host}:${options.port}`);
                sessionManager.connected();
                // Initialize handlers now that we have a socket
                initializeHandlers();
                // Send logon message after a short delay
                setTimeout(() => {
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
            sessionManager.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    };
    /**
     * Disconnect from the FIX server
     */
    const disconnect = () => {
        return new Promise((resolve) => {
            // If logged in, send logout message first
            if (sessionManager.isLoggedIn()) {
                sessionManager.loggingOut();
                sendLogout();
            }
            // Clean up and close socket
            if (socket) {
                socket.destroy();
                socket = null;
            }
            sessionManager.disconnected();
            // Cancel any active market data requests
            if (marketDataHandler && marketDataHandler.hasActiveRequests()) {
                marketDataHandler.cancelAllRequests();
            }
            resolve();
        });
    };
    /**
     * Handle incoming data from the socket
     */
    const handleData = (data) => {
        try {
            // Record activity for heartbeat monitoring
            sessionManager.recordActivity();
            const dataStr = data.toString();
            logger_1.default.debug(`Received data: ${dataStr.length} bytes`);
            // Split the data into individual FIX messages
            const messages = dataStr.split(constants_1.SOH);
            let currentMessage = '';
            for (const segment of messages) {
                if (segment.startsWith('8=FIX')) {
                    // If we have a previous message, process it
                    if (currentMessage) {
                        processMessage(currentMessage);
                    }
                    // Start a new message
                    currentMessage = segment;
                }
                else if (currentMessage) {
                    // Add to current message
                    currentMessage += constants_1.SOH + segment;
                }
            }
            // Process the last message if exists
            if (currentMessage) {
                processMessage(currentMessage);
            }
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
            // Parse the message
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.default.warn('Could not parse FIX message');
                return;
            }
            // Log the raw message
            logger_1.default.info(`Received FIX message: ${message.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            // Get message type
            const messageType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
            // Track sequence numbers if available
            if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const seqNum = parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                sequenceManager.updateIncomingSeqNum(seqNum);
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
                    // Just log - heartbeat is handled automatically by SessionManager
                    logger_1.default.debug('Received heartbeat');
                    break;
                case constants_1.MessageType.TEST_REQUEST:
                    // Respond with heartbeat
                    sendHeartbeat(parsedMessage[constants_1.FieldTag.TEST_REQ_ID]);
                    break;
                case constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
                    if (marketDataHandler) {
                        marketDataHandler.handleMarketDataSnapshot(parsedMessage);
                    }
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    if (marketDataHandler) {
                        marketDataHandler.handleMarketDataIncremental(parsedMessage);
                    }
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    if (securityListHandler) {
                        securityListHandler.handleSecurityListResponse(parsedMessage);
                    }
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    handleTradingSessionStatus(parsedMessage);
                    break;
                case constants_1.MessageType.REJECT:
                    handleReject(parsedMessage);
                    break;
                case 'Y': // Market Data Request Reject
                    if (marketDataHandler) {
                        marketDataHandler.handleMarketDataReject(parsedMessage);
                    }
                    break;
                default:
                    logger_1.default.info(`Received unhandled message type: ${messageType}`);
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a logon message from the server
     */
    const handleLogon = (message) => {
        // Update session state
        sessionManager.loggedIn();
        // Reset sequence numbers if needed
        if (message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
            sequenceManager.resetAll(2); // Start with 2 after logon acknowledgment with reset flag
            logger_1.default.info('Reset sequence flag is Y, resetting all sequence numbers');
        }
        // Emit event so client can handle login success
        emitter.emit('logon', message);
        logger_1.default.info('Successfully logged in to FIX server');
    };
    /**
     * Handle a logout message from the server
     */
    const handleLogout = (message) => {
        // Get any provided text reason for the logout
        const text = message[constants_1.FieldTag.TEXT];
        // Check if this is a sequence number related logout
        if (text && (text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'))) {
            logger_1.default.warn(`Received logout due to sequence number issue: ${text}`);
            // Try to parse the expected sequence number from the message
            const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
            if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
                const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
                if (!isNaN(expectedSeqNum)) {
                    logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
                    // Reset sequence numbers and reconnect
                    sequenceManager.resetAll(expectedSeqNum);
                    sessionManager.sequenceReset();
                    // Reconnect with corrected sequence numbers
                    if (socket) {
                        socket.destroy();
                        socket = null;
                    }
                    setTimeout(() => {
                        connect();
                    }, 2000);
                    return;
                }
            }
        }
        // For normal logouts, update state and emit event
        logger_1.default.info('Logged out from FIX server');
        sessionManager.disconnected();
        emitter.emit('logout', message);
    };
    /**
     * Handle a reject message from the server
     */
    const handleReject = (message) => {
        const refSeqNum = message[constants_1.FieldTag.REF_SEQ_NUM];
        const refTagId = message[constants_1.FieldTag.REF_TAG_ID];
        const text = message[constants_1.FieldTag.TEXT];
        logger_1.default.error(`Received REJECT message for sequence number ${refSeqNum}`);
        logger_1.default.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);
        // Check if this is a sequence number issue
        if (refTagId === '34' || text?.includes('MsgSeqNum')) {
            logger_1.default.info('Sequence number mismatch detected, handling sequence reset...');
            // Try to parse the expected sequence number
            const expectedSeqNumMatch = text?.match(/expected ['"]?(\d+)['"]?/);
            if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
                const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
                if (!isNaN(expectedSeqNum)) {
                    logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
                    sequenceManager.resetAll(expectedSeqNum);
                    // Send a heartbeat with the correct sequence number to sync
                    sendHeartbeat('');
                }
            }
        }
        // Emit reject event
        emitter.emit('reject', { refSeqNum, refTagId, text });
    };
    /**
     * Handle a trading session status message
     */
    const handleTradingSessionStatus = (message) => {
        try {
            // Extract standard fields
            const sessionId = message[constants_1.FieldTag.TRADING_SESSION_ID] || 'REG';
            const status = message[constants_1.FieldTag.TRAD_SES_STATUS] || '2'; // Default to Open
            const startTime = message[constants_1.FieldTag.START_TIME];
            const endTime = message[constants_1.FieldTag.END_TIME];
            // Construct session info
            const sessionInfo = {
                sessionId,
                status,
                startTime,
                endTime
            };
            logger_1.default.info(`Received trading session status: ${sessionId}, status: ${status}`);
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
        if (!sessionManager.isConnected())
            return;
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.HEARTBEAT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
            if (testReqId) {
                builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
            }
            const message = builder.buildMessage();
            socketWrite(message);
            sequenceManager.incrementOutgoingSeqNum();
        }
        catch (error) {
            logger_1.default.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a logon message to the server
     */
    const sendLogon = () => {
        if (!sessionManager.isConnected()) {
            logger_1.default.warn('Cannot send logon, not connected');
            return;
        }
        try {
            // Reset sequence numbers for a new logon
            sequenceManager.resetAll(1);
            // Create logon message
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGON)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
            // Add required fields
            builder.addField(constants_1.FieldTag.ENCRYPT_METHOD, '0');
            builder.addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
            builder.addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
            builder.addField(constants_1.FieldTag.USERNAME, options.username);
            builder.addField(constants_1.FieldTag.PASSWORD, options.password);
            builder.addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9');
            builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID
            const message = builder.buildMessage();
            socketWrite(message);
            // Increment sequence number for next message
            sequenceManager.incrementOutgoingSeqNum();
        }
        catch (error) {
            logger_1.default.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
            sessionManager.error(`Logon failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a logout message to the server
     */
    const sendLogout = (text) => {
        if (!sessionManager.isConnected()) {
            logger_1.default.warn('Cannot send logout, not connected');
            return;
        }
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGOUT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum());
            if (text) {
                builder.addField(constants_1.FieldTag.TEXT, text);
            }
            const message = builder.buildMessage();
            socketWrite(message);
            sequenceManager.incrementOutgoingSeqNum();
        }
        catch (error) {
            logger_1.default.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
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
     * Send a market data request for specified symbols
     */
    const sendMarketDataRequest = (symbols, entryTypes = ['0', '1'], // 0 = Bid, 1 = Offer
    subscriptionType = '1' // 1 = Snapshot + Updates
    ) => {
        if (!marketDataHandler || !sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send market data request: not connected or not logged in');
            return null;
        }
        return marketDataHandler.requestMarketData(symbols, entryTypes, subscriptionType);
    };
    /**
     * Send a market data request for index symbols
     */
    const sendIndexMarketDataRequest = (symbols) => {
        if (!marketDataHandler || !sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send index market data request: not connected or not logged in');
            return null;
        }
        return marketDataHandler.requestIndexValues(symbols);
    };
    /**
     * Send a security list request
     */
    const sendSecurityListRequest = () => {
        if (!securityListHandler || !sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send security list request: not connected or not logged in');
            return null;
        }
        securityListHandler.requestAllSecurities();
        return 'security-list-request';
    };
    /**
     * Send a security list request for equities
     */
    const sendSecurityListRequestForEquity = () => {
        if (!securityListHandler || !sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send equity security list request: not connected or not logged in');
            return null;
        }
        return securityListHandler.requestEquitySecurities();
    };
    /**
     * Send a security list request for indices
     */
    const sendSecurityListRequestForIndex = () => {
        if (!securityListHandler || !sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send index security list request: not connected or not logged in');
            return null;
        }
        return securityListHandler.requestIndexSecurities();
    };
    /**
     * Send a trading session status request
     */
    const sendTradingSessionStatusRequest = () => {
        if (!sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send trading session status request: not connected or not logged in');
            return null;
        }
        try {
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum())
                .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
            const rawMessage = message.buildMessage();
            socketWrite(rawMessage);
            sequenceManager.incrementOutgoingSeqNum();
            logger_1.default.info(`Sent trading session status request (ID: ${requestId})`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending trading session status request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    /**
     * Send a market data subscription for specific symbols
     */
    const sendSymbolMarketDataSubscription = (symbols) => {
        return sendMarketDataRequest(symbols, ['0', '1', '2'], '1'); // Bid, Offer, Trade with subscription
    };
    /**
     * Send a security status request for a symbol
     */
    const sendSecurityStatusRequest = (symbol) => {
        if (!sessionManager.isLoggedIn()) {
            logger_1.default.error('Cannot send security status request: not connected or not logged in');
            return null;
        }
        try {
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType('e') // Security Status Request
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextOutgoingSeqNum())
                .addField(constants_1.FieldTag.SECURITY_STATUS_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SYMBOL, symbol)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .buildMessage();
            socketWrite(message);
            sequenceManager.incrementOutgoingSeqNum();
            logger_1.default.info(`Sent security status request for: ${symbol}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending security status request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    /**
     * Reset client state and reconnect
     */
    const reset = () => {
        logger_1.default.info('Performing complete reset with disconnection and reconnection');
        // Disconnect completely
        if (socket) {
            socket.destroy();
            socket = null;
        }
        
        // Reset managers
        sessionManager.disconnected();
        
        // Reset sequence numbers but maintain distinct streams
        // Instead of resetting all to 1, we need to properly set each stream
        sequenceManager.resetRegularSequence(1, 0); // Regular messages get 1
        sequenceManager.resetMarketDataSequence(1, 0); // MarketData gets 1
        sequenceManager.resetSecurityListSequence(2, 0); // SecurityList gets 2
        
        logger_1.default.info('Reset sequence numbers: Regular=1, MarketData=1, SecurityList=2');
        
        // Cancel any active market data requests
        if (marketDataHandler && marketDataHandler.hasActiveRequests()) {
            marketDataHandler.cancelAllRequests();
        }
        
        // Wait a moment and reconnect
        setTimeout(() => {
            logger_1.default.info('Reconnecting after reset');
            connect();
        }, 3000);
        
        return client;
    };
    // Set up session manager event handlers
    sessionManager.on('reconnect', () => {
        logger_1.default.info('Attempting to reconnect...');
        connect();
    });
    sessionManager.on('testRequest', () => {
        sendHeartbeat('TEST' + Date.now());
    });
    sessionManager.on('heartbeat', () => {
        sendHeartbeat();
    });
    sessionManager.on('connectionLost', () => {
        logger_1.default.error('Connection lost due to heartbeat timeout');
        if (socket) {
            socket.destroy();
            socket = null;
        }
        sessionManager.disconnected();
    });
    // Return the public API
    const client = {
        on: (event, listener) => {
            emitter.on(event, listener);
            return client;
        },
        connect,
        disconnect,
        sendMarketDataRequest,
        sendSecurityListRequest,
        sendTradingSessionStatusRequest,
        sendSecurityListRequestForEquity,
        sendSecurityListRequestForIndex,
        sendIndexMarketDataRequest,
        sendSymbolMarketDataSubscription,
        sendSecurityStatusRequest,
        sendLogon,
        sendLogout,
        start,
        stop,
        setSequenceNumber: (newSeq) => {
            // Instead of resetting all streams to the same value,
            // maintain the separation between SecurityList and MarketData
            sequenceManager.resetRegularSequence(newSeq, 0);  // Regular messages
            sequenceManager.resetMarketDataSequence(newSeq, 0); // MarketData uses same value
            sequenceManager.resetSecurityListSequence(newSeq + 1, 0); // SecurityList uses newSeq+1 to be different
            
            logger_1.default.info(`Manually set sequence numbers: Regular=${newSeq}, MarketData=${newSeq}, SecurityList=${newSeq+1}`);
            return client;
        },
        setSecurityListSequenceNumbers: (outgoingSeq, incomingSeq = 0) => {
            // Set only the SecurityList sequence numbers
            // This is useful when you need to use different sequence numbers for SecurityList
            sequenceManager.resetSecurityListSequence(outgoingSeq, incomingSeq);
            logger_1.default.info(`Manually set SecurityList sequence numbers: outgoing=${outgoingSeq}, incoming=${incomingSeq}`);
            return client;
        },
        setMarketDataSequenceNumbers: (outgoingSeq, incomingSeq = 0) => {
            // Set only the MarketData sequence numbers
            // This ensures MarketData uses different sequence numbers than SecurityList
            sequenceManager.resetMarketDataSequence(outgoingSeq, incomingSeq);
            logger_1.default.info(`Manually set MarketData sequence numbers: outgoing=${outgoingSeq}, incoming=${incomingSeq}`);
            return client;
        },
        reset,
        requestSecurityList: () => {
            if (securityListHandler && sessionManager.isLoggedIn()) {
                logger_1.default.info('Requesting comprehensive security list');
                securityListHandler.requestAllSecurities();
            }
            else {
                logger_1.default.error('Cannot request security list: not connected or logged in');
            }
            return client;
        },
        getStatus: () => ({
            isConnected: sessionManager.isConnected(),
            isLoggedIn: sessionManager.isLoggedIn(),
            sessionState: sessionManager.getState(),
            sequenceState: sequenceManager.getState(),
            hasActiveMarketDataRequests: marketDataHandler?.hasActiveRequests() || false
        })
    };
    return client;
}
