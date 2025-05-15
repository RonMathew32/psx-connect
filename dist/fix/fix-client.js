"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixClient = createFixClient;
const logger_1 = __importDefault(require("../utils/logger"));
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const message_parser_1 = require("./message-parser");
const constants_1 = require("./constants");
const net_1 = require("net");
const uuid_1 = require("uuid");
const sequence_manager_1 = require("./sequence-manager");
const message_helpers_1 = require("./message-helpers");
const message_handlers_1 = require("./message-handlers");
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
    let lastActivityTime = 0;
    let testRequestCount = 0;
    let logonTimer = null;
    let msgSeqNum = 1;
    let serverSeqNum = 1;
    const sequenceManager = new sequence_manager_1.SequenceManager();
    let requestedEquitySecurities = false;
    const securityCache = {
        EQUITY: [],
        INDEX: []
    };
    const forceResetSequenceNumber = (newSeq = 2) => {
        sequenceManager.forceReset(newSeq);
    };
    const start = () => {
        connect();
    };
    const stop = () => {
        sendLogout();
        disconnect();
    };
    const connect = async () => {
        if (socket && connected) {
            logger_1.default.warn('Already connected');
            return;
        }
        try {
            socket = new net_1.Socket();
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            socket.setTimeout(options.connectTimeoutMs || 30000);
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
            socket.on('connect', () => {
                logger_1.default.info(`Connected to ${options.host}:${options.port}`);
                connected = true;
                if (logonTimer) {
                    clearTimeout(logonTimer);
                }
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
            // Handle received data
            socket.on('data', (data) => {
                logger_1.default.info("--------------------------------");
                logger_1.default.info(data);
                // handleData(data);
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
    const handleData = (data) => {
        try {
            lastActivityTime = Date.now();
            const dataStr = data.toString();
            logger_1.default.debug(`Received data: ${dataStr.length} bytes`);
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
                // logger.info(`Processing message: ${currentMessage}`);
                processMessage(currentMessage);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
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
            logger_1.default.info(`------------------------------------------------------------------------------------------------------------`);
            // Parse the raw message
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.default.warn('Could not parse FIX message');
                return;
            }
            // Track server's sequence number if available
            if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const incomingSeqNum = parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                // Special handling for logout and reject messages with sequence errors
                const msgType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
                const text = parsedMessage[constants_1.FieldTag.TEXT] || '';
                // Check if this is a sequence error message
                const isSequenceError = Boolean(text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'));
                if ((msgType === constants_1.MessageType.LOGOUT || msgType === constants_1.MessageType.REJECT) && isSequenceError) {
                    // For sequence errors, don't update our sequence counter
                    // This will be handled in the handleLogout or handleReject methods
                    logger_1.default.warn(`Received ${msgType} with sequence error: ${text}`);
                }
                else {
                    // For normal messages, update sequence numbers using the manager
                    sequenceManager.updateServerSequence(incomingSeqNum);
                }
            }
            // Log message type for debugging
            const messageType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
            const messageTypeName = (0, message_helpers_1.getMessageTypeName)(messageType);
            logger_1.default.info(`Message type: ${messageType} (${messageTypeName})`);
            // Process specific message types
            switch (messageType) {
                case constants_1.MessageType.LOGON:
                    logger_1.default.info(`[LOGON] Processing logon message from server`);
                    handleLogon(parsedMessage, sequenceManager, emitter);
                    loggedIn = true;
                    break;
                case constants_1.MessageType.LOGOUT:
                    logger_1.default.info(`[LOGOUT] Handling logout message`);
                    const logoutResult = handleLogout(parsedMessage, emitter);
                    if (logoutResult.isSequenceError) {
                        handleSequenceError(logoutResult.expectedSeqNum);
                    }
                    else {
                        loggedIn = false;
                        // Clear the heartbeat timer as we're logged out
                        if (heartbeatTimer) {
                            clearInterval(heartbeatTimer);
                            heartbeatTimer = null;
                        }
                    }
                    break;
                case constants_1.MessageType.HEARTBEAT:
                    logger_1.default.debug(`[HEARTBEAT] Received heartbeat`);
                    // Just log and reset the test request counter
                    testRequestCount = 0;
                    break;
                case constants_1.MessageType.TEST_REQUEST:
                    logger_1.default.info(`[TEST_REQUEST] Responding to test request`);
                    // Respond with heartbeat
                    sendHeartbeat(parsedMessage[constants_1.FieldTag.TEST_REQ_ID]);
                    break;
                case constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
                    logger_1.default.info(`[MARKET_DATA] Handling market data snapshot for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    // Update market data sequence number
                    if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                        sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10));
                    }
                    (0, message_handlers_1.handleMarketDataSnapshot)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    logger_1.default.info(`[MARKET_DATA] Handling market data incremental refresh for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    // Update market data sequence number
                    if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                        sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10));
                    }
                    (0, message_handlers_1.handleMarketDataIncremental)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    logger_1.default.info(`[SECURITY_LIST] Handling security list response`);
                    (0, message_handlers_1.handleSecurityList)(parsedMessage, emitter, securityCache);
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    logger_1.default.info(`[TRADING_STATUS] Handling trading session status update`);
                    (0, message_handlers_1.handleTradingSessionStatus)(parsedMessage, emitter);
                    break;
                case 'f': // Trading Status - specific PSX format
                    logger_1.default.info(`[TRADING_STATUS] Handling trading status for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    (0, message_handlers_1.handleTradingStatus)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.REJECT:
                    logger_1.default.error(`[REJECT] Handling reject message`);
                    const rejectResult = (0, message_handlers_1.handleReject)(parsedMessage, emitter);
                    if (rejectResult.isSequenceError) {
                        handleSequenceError(rejectResult.expectedSeqNum);
                    }
                    break;
                case 'Y': // Market Data Request Reject
                    logger_1.default.error(`[MARKET_DATA_REJECT] Handling market data request reject`);
                    (0, message_handlers_1.handleMarketDataRequestReject)(parsedMessage, emitter);
                    break;
                default:
                    logger_1.default.info(`[UNKNOWN] Received unhandled message type: ${messageType} (${messageTypeName})`);
                    if (parsedMessage[constants_1.FieldTag.SYMBOL]) {
                        logger_1.default.info(`[UNKNOWN] Symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    }
            }
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleSequenceError = (expectedSeqNum) => {
        if (expectedSeqNum !== undefined) {
            logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
            // Perform a full disconnect and reconnect with sequence reset
            if (socket) {
                logger_1.default.info('Disconnecting due to sequence number error');
                socket.destroy();
                socket = null;
            }
            // Wait a moment before reconnecting
            setTimeout(() => {
                // Reset sequence numbers to what the server expects
                sequenceManager.forceReset(expectedSeqNum);
                logger_1.default.info(`Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
                connect();
            }, 2000);
        }
        else {
            // If we can't parse the expected sequence number, do a full reset
            logger_1.default.info('Cannot determine expected sequence number, performing full reset');
            if (socket) {
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                // Reset sequence numbers
                sequenceManager.resetAll();
                logger_1.default.info('Reconnecting with fully reset sequence numbers');
                connect();
            }, 2000);
        }
    };
    const sendHeartbeat = (testReqId) => {
        if (!connected)
            return;
        try {
            const message = (0, message_helpers_1.createHeartbeatMessage)({
                senderCompId: options.senderCompId,
                targetCompId: options.targetCompId,
                username: options.username,
                password: options.password,
                heartbeatIntervalSecs: options.heartbeatIntervalSecs
            }, sequenceManager, testReqId);
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendSecurityStatusRequest = (symbol) => {
        return null;
    };
    const sendMessage = (message) => {
        if (!socket || !connected) {
            logger_1.default.warn('Cannot send message, not connected');
            return;
        }
        try {
            // Log the raw message with SOH delimiters replaced with pipes for readability
            logger_1.default.debug(`Sending FIX message with sequence number ${sequenceManager.getMainSeqNum()}: ${message}`);
            logger_1.default.debug(`Current server sequence: ${sequenceManager.getServerSeqNum()}`);
            // Send the message
            socket.write(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            // On send error, try to reconnect
            socket?.destroy();
            connected = false;
        }
    };
    const handleLogon = (message, sequenceManager, emitter) => {
        loggedIn = true;
        // Get server's sequence number
        const serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
        // Update using forceReset which sets both main and server sequence numbers
        sequenceManager.forceReset(serverSeqNum);
        // If reset sequence number flag is Y, we should reset our sequence counter to 2
        // (1 for the server's logon acknowledgment, and our next message will be 2)
        if (message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
            // Use forceReset which handles both main sequence number and server sequence number
            sequenceManager.forceReset(2);
            sequenceManager.setMarketDataSeqNum(2); // Reset market data sequence
            logger_1.default.info(`Reset sequence flag is Y, setting our sequence numbers to 2`);
        }
        else {
            // Otherwise, set our next sequence to be one more than the server's
            sequenceManager.forceReset(sequenceManager.getServerSeqNum() + 1);
            // Ensure market data sequence number is also aligned
            sequenceManager.setMarketDataSeqNum(sequenceManager.getMainSeqNum());
            logger_1.default.info(`Using server's sequence, setting sequence numbers to: ${sequenceManager.getMainSeqNum()}`);
        }
        logger_1.default.info(`Successfully logged in to FIX server. Server sequence: ${sequenceManager.getServerSeqNum()}, Next sequence: ${sequenceManager.getMainSeqNum()}`);
        // Start heartbeat monitoring
        startHeartbeatMonitoring();
        // Emit event so client can handle login success
        emitter.emit('logon', message);
        // Note: We're removing automatic security list requests after login
        // because we need to control sequence numbers manually
        logger_1.default.info('[SECURITY_LIST] Login successful. Use explicit security list requests after logon.');
        // Add a timer to schedule security list requests after a short delay
        setTimeout(() => {
            if (connected && loggedIn) {
                logger_1.default.info('[SECURITY_LIST] Requesting equity security list after login');
                sendSecurityListRequestForEquity();
                // Request index securities after a delay to prevent sequence issues
                setTimeout(() => {
                    if (connected && loggedIn) {
                        logger_1.default.info('[SECURITY_LIST] Requesting index security list after login');
                        sendSecurityListRequestForIndex();
                    }
                }, 3000);
            }
        }, 2000);
    };
    const sendMarketDataRequest = (symbols, entryTypes = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType = '1' // Default: 1 = Snapshot + Updates
    ) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const builder = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement())
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add PartyID group (required by PSX)
            builder
                .addField('453', '1') // NoPartyIDs = 1
                .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
                .addField('447', 'D') // PartyIDSource = D (custom)
                .addField('452', '3'); // PartyRole = 3 (instead of 2)
            // Add symbols
            builder.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                builder.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            const rawMessage = builder.buildMessage();
            logger_1.default.info(`Sent market data request with ID: ${requestId}`);
            logger_1.default.info(`Market data request message: ${rawMessage}`);
            socket.write(rawMessage);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    const sendSecurityListRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send security list request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const builder = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement())
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent security list request with sequence number: ${sequenceManager.getMainSeqNum()}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending security list request:', error);
            return null;
        }
    };
    const sendTradingSessionStatusRequest = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('Cannot send trading session status request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement())
                .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent trading session status request for REG market with ID: ${requestId}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending trading session status request:', error);
            return null;
        }
    };
    const sendSecurityListRequestForEquity = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('[SECURITY_LIST] Cannot send equity security list request: not connected or not logged in');
                return null;
            }
            if (requestedEquitySecurities) {
                logger_1.default.info('[SECURITY_LIST] Equity securities already requested, skipping duplicate request');
                return null;
            }
            const { message, requestId } = (0, message_helpers_1.createEquitySecurityListRequest)({
                senderCompId: options.senderCompId,
                targetCompId: options.targetCompId,
                username: options.username,
                password: options.password,
                heartbeatIntervalSecs: options.heartbeatIntervalSecs
            }, sequenceManager);
            if (socket) {
                socket.write(message);
                requestedEquitySecurities = true;
                logger_1.default.info(`[SECURITY_LIST] Equity security list request sent successfully.`);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST] Failed to send equity security list request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendSecurityListRequestForIndex = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('[SECURITY_LIST] Cannot send index security list request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);
            // Create message in the format used by fn-psx project
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement());
            // Add required fields in same order as fn-psx
            message.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
            message.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
            message.addField('460', '5'); // Product = INDEX (5)
            message.addField('336', 'REG'); // TradingSessionID = REG
            const rawMessage = message.buildMessage();
            logger_1.default.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            if (socket) {
                socket.write(rawMessage);
                logger_1.default.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${sequenceManager.getNextAndIncrement()}`);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST] Failed to send index security list request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendIndexMarketDataRequest = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const builder = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement())
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add symbols
            builder.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                builder.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1');
            builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3');
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent market data request for indices: ${symbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    const sendSymbolMarketDataSubscription = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data subscription: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement())
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '3');
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '0'); // Bid
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '1'); // Offer
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '2'); // Trade
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent market data subscription for symbols: ${symbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data subscription:', error);
            return null;
        }
    };
    const handleLogout = (message, emitter) => {
        loggedIn = false;
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
                    // Perform a full disconnect and reconnect with sequence reset
                    if (socket) {
                        logger_1.default.info('Disconnecting due to sequence number error');
                        socket.destroy();
                        socket = null;
                    }
                    // Wait a moment before reconnecting
                    setTimeout(() => {
                        // Reset sequence numbers to what the server expects
                        sequenceManager.forceReset(expectedSeqNum);
                        logger_1.default.info(`Reconnecting with adjusted sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
                        connect();
                    }, 2000);
                    return { isSequenceError: true, expectedSeqNum };
                }
                else {
                    // If we can't parse the expected sequence number, do a full reset
                    logger_1.default.info('Cannot parse expected sequence number, performing full reset');
                    if (socket) {
                        socket.destroy();
                        socket = null;
                    }
                    setTimeout(() => {
                        // Reset sequence numbers
                        sequenceManager.resetAll();
                        logger_1.default.info('Reconnecting with fully reset sequence numbers');
                        connect();
                    }, 2000);
                    return { isSequenceError: true };
                }
            }
            else {
                // No match found, do a full reset
                logger_1.default.info('No expected sequence number found in message, performing full reset');
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                setTimeout(() => {
                    // Reset sequence numbers
                    sequenceManager.resetAll();
                    logger_1.default.info('Reconnecting with fully reset sequence numbers');
                    connect();
                }, 2000);
                return { isSequenceError: true };
            }
        }
        else {
            emitter.emit('logout', message);
            return { isSequenceError: false };
        }
    };
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
                    const message = (0, message_helpers_1.createTestRequestMessage)({
                        senderCompId: options.senderCompId,
                        targetCompId: options.targetCompId,
                        username: options.username,
                        password: options.password,
                        heartbeatIntervalSecs: options.heartbeatIntervalSecs
                    }, sequenceManager);
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
    const sendLogout = (text) => {
        if (!connected) {
            logger_1.default.warn('Cannot send logout, not connected');
            emitter.emit('logout', {
                message: 'Logged out from FIX server',
                timestamp: new Date().toISOString(),
            });
            return;
        }
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGOUT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement());
            if (text) {
                builder.addField(constants_1.FieldTag.TEXT, text);
            }
            const message = builder.buildMessage();
            sendMessage(message);
            logger_1.default.info('Sent logout message to server');
        }
        catch (error) {
            logger_1.default.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendLogon = () => {
        logger_1.default.info('Sending logon message...');
        if (!connected) {
            logger_1.default.warn('Cannot send logon, not connected');
            return;
        }
        try {
            // Always reset sequence number on logon
            msgSeqNum = 1; // Start with 1 for the logon message
            serverSeqNum = 1;
            logger_1.default.info('Resetting sequence numbers to 1 for new logon');
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGON)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement()); // Use sequence number 1
            // Then add body fields in the order used by fn-psx
            builder.addField(constants_1.FieldTag.ENCRYPT_METHOD, '0');
            builder.addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
            builder.addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
            builder.addField(constants_1.FieldTag.USERNAME, options.username);
            builder.addField(constants_1.FieldTag.PASSWORD, options.password);
            builder.addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9');
            builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID
            const message = builder.buildMessage();
            logger_1.default.info(`Sending Logon Message`);
            sendMessage(message);
            // Now increment sequence number for next message
            msgSeqNum++;
            logger_1.default.info(`Incremented sequence number to ${msgSeqNum} for next message after logon`);
        }
        catch (error) {
            logger_1.default.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
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
            forceResetSequenceNumber(newSeq);
            return client;
        },
        setMarketDataSequenceNumber: (seqNum) => {
            sequenceManager.setMarketDataSeqNum(seqNum);
            return client;
        },
        setSecurityListSequenceNumber: (seqNum) => {
            sequenceManager.setSecurityListSeqNum(seqNum);
            return client;
        },
        getSequenceNumbers: () => {
            return sequenceManager.getAll();
        },
        reset: () => {
            logger_1.default.info('[RESET] Performing complete reset with disconnection and reconnection');
            if (socket) {
                socket.destroy();
                socket = null;
            }
            connected = false;
            loggedIn = false;
            clearTimers();
            sequenceManager.resetAll();
            logger_1.default.info('[RESET] Connection and sequence numbers reset to initial state');
            setTimeout(() => {
                logger_1.default.info('[RESET] Reconnecting after reset');
                connect();
            }, 3000);
            return client;
        },
        requestAllSecurities: () => {
            // Implementation
            return client;
        },
        setupComplete: () => {
            // Implementation  
            return client;
        }
    };
    return client;
}
