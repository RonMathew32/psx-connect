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
                // Extract message types from data for better identification
                try {
                    const dataStr = data.toString();
                    const messageTypes = [];
                    const symbolsFound = [];
                    // Quick scan for message types in the data
                    const msgTypeMatches = dataStr.match(/35=([A-Za-z0-9])/g) || [];
                    for (const match of msgTypeMatches) {
                        const msgType = match.substring(3);
                        messageTypes.push(msgType);
                    }
                    // Quick scan for symbols in the data
                    const symbolMatches = dataStr.match(/55=([^\x01]+)/g) || [];
                    for (const match of symbolMatches) {
                        const symbol = match.substring(3);
                        if (symbol)
                            symbolsFound.push(symbol);
                    }
                    // Identify message categories
                    const categorizedMessages = messageTypes.map(type => {
                        let category = 'UNKNOWN';
                        if (type === constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
                            type === constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
                            type === 'Y') {
                            category = 'MARKET_DATA';
                        }
                        else if (type === constants_1.MessageType.SECURITY_LIST) {
                            category = 'SECURITY_LIST';
                        }
                        else if (type === constants_1.MessageType.TRADING_SESSION_STATUS || type === 'f') {
                            category = 'TRADING_STATUS';
                        }
                        else if (type === constants_1.MessageType.LOGON || type === constants_1.MessageType.LOGOUT) {
                            category = 'SESSION';
                        }
                        else if (type === constants_1.MessageType.HEARTBEAT || type === constants_1.MessageType.TEST_REQUEST) {
                            category = 'HEARTBEAT';
                        }
                        else if (type === constants_1.MessageType.REJECT) {
                            category = 'REJECT';
                        }
                        return `${category}:${type}`;
                    });
                    // Log the data summary before detailed processing
                    if (messageTypes.length > 0) {
                        logger_1.default.info(`[DATA:RECEIVED] Message types: ${categorizedMessages.join(', ')}${symbolsFound.length > 0 ? ' | Symbols: ' + symbolsFound.join(', ') : ''}`);
                    }
                }
                catch (err) {
                    logger_1.default.error(`Error pre-parsing data: ${err}`);
                }
                logger_1.default.info(data);
                handleData(data);
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
            // Get message type for classification before full parsing
            const msgTypeField = segments.find(s => s.startsWith('35='));
            const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
            const msgTypeName = (0, message_helpers_1.getMessageTypeName)(msgType);
            // Get symbol if it exists for better logging
            const symbolField = segments.find(s => s.startsWith('55='));
            const symbol = symbolField ? symbolField.substring(3) : '';
            // Classify message
            let messageCategory = 'UNKNOWN';
            if (msgType === constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
                msgType === constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
                msgType === 'Y') {
                messageCategory = 'MARKET_DATA';
            }
            else if (msgType === constants_1.MessageType.SECURITY_LIST) {
                messageCategory = 'SECURITY_LIST';
            }
            else if (msgType === constants_1.MessageType.TRADING_SESSION_STATUS || msgType === 'f') {
                messageCategory = 'TRADING_STATUS';
            }
            else if (msgType === constants_1.MessageType.LOGON || msgType === constants_1.MessageType.LOGOUT) {
                messageCategory = 'SESSION';
            }
            else if (msgType === constants_1.MessageType.HEARTBEAT || msgType === constants_1.MessageType.TEST_REQUEST) {
                messageCategory = 'HEARTBEAT';
            }
            else if (msgType === constants_1.MessageType.REJECT) {
                messageCategory = 'REJECT';
            }
            // Log with category and type for clear identification
            logger_1.default.info(`[${messageCategory}] Received FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
            logger_1.default.info(`------------------------------------------------------------------------------------------------------------`);
            logger_1.default.info(message);
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
            // Process specific message types
            switch (msgType) {
                case constants_1.MessageType.LOGON:
                    logger_1.default.info(`[SESSION:LOGON] Processing logon message from server`);
                    handleLogon(parsedMessage, sequenceManager, emitter);
                    loggedIn = true;
                    break;
                case constants_1.MessageType.LOGOUT:
                    logger_1.default.info(`[SESSION:LOGOUT] Handling logout message`);
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
                    // Emit an additional categorized event
                    emitter.emit('categorizedData', {
                        category: 'HEARTBEAT',
                        type: 'HEARTBEAT',
                        data: parsedMessage,
                        timestamp: new Date().toISOString()
                    });
                    break;
                case constants_1.MessageType.TEST_REQUEST:
                    logger_1.default.info(`[HEARTBEAT:TEST_REQUEST] Responding to test request`);
                    // Respond with heartbeat
                    sendHeartbeat(parsedMessage[constants_1.FieldTag.TEST_REQ_ID]);
                    // Emit an additional categorized event
                    emitter.emit('categorizedData', {
                        category: 'HEARTBEAT',
                        type: 'TEST_REQUEST',
                        data: parsedMessage,
                        timestamp: new Date().toISOString()
                    });
                    break;
                case constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
                    logger_1.default.info(`[MARKET_DATA:SNAPSHOT] Handling market data snapshot for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    // Update market data sequence number
                    if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                        sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10));
                    }
                    // Use our custom enhanced handler
                    handleMarketDataSnapshot(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    logger_1.default.info(`[MARKET_DATA:INCREMENTAL] Handling market data incremental refresh for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    // Update market data sequence number
                    if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                        sequenceManager.setMarketDataSeqNum(parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10));
                    }
                    // Use our custom enhanced handler
                    handleMarketDataIncremental(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    logger_1.default.info(`[SECURITY_LIST] Handling security list response`);
                    // Use our custom enhanced handler
                    handleSecurityList(parsedMessage, emitter, securityCache);
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    logger_1.default.info(`[TRADING_STATUS:SESSION] Handling trading session status update`);
                    // Use our custom enhanced handler
                    handleTradingSessionStatus(parsedMessage, emitter);
                    break;
                case 'f': // Trading Status - specific PSX format
                    logger_1.default.info(`[TRADING_STATUS:SYMBOL] Handling trading status for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    // Use our custom enhanced handler
                    handleTradingStatus(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.REJECT:
                    logger_1.default.error(`[REJECT] Handling reject message`);
                    const rejectResult = (0, message_handlers_1.handleReject)(parsedMessage, emitter);
                    // Emit an additional categorized event
                    emitter.emit('categorizedData', {
                        category: 'REJECT',
                        type: 'REJECT',
                        refMsgType: parsedMessage['45'] || '', // RefMsgType field
                        text: parsedMessage[constants_1.FieldTag.TEXT] || '',
                        data: parsedMessage,
                        timestamp: new Date().toISOString()
                    });
                    if (rejectResult.isSequenceError) {
                        handleSequenceError(rejectResult.expectedSeqNum);
                    }
                    break;
                case 'Y': // Market Data Request Reject
                    logger_1.default.error(`[MARKET_DATA:REJECT] Handling market data request reject`);
                    (0, message_handlers_1.handleMarketDataRequestReject)(parsedMessage, emitter);
                    // Emit an additional categorized event
                    emitter.emit('categorizedData', {
                        category: 'MARKET_DATA',
                        type: 'REJECT',
                        requestID: parsedMessage[constants_1.FieldTag.MD_REQ_ID] || '',
                        text: parsedMessage[constants_1.FieldTag.TEXT] || '',
                        data: parsedMessage,
                        timestamp: new Date().toISOString()
                    });
                    break;
                default:
                    logger_1.default.info(`[UNKNOWN:${msgType}] Received unhandled message type: ${msgType} (${msgTypeName})`);
                    if (parsedMessage[constants_1.FieldTag.SYMBOL]) {
                        logger_1.default.info(`[UNKNOWN:${msgType}] Symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    }
                    // Emit an additional categorized event for unknown messages
                    emitter.emit('categorizedData', {
                        category: 'UNKNOWN',
                        type: msgType,
                        symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || '',
                        data: parsedMessage,
                        timestamp: new Date().toISOString()
                    });
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
            logger_1.default.debug(`[HEARTBEAT:SEND] Creating heartbeat message${testReqId ? ' with test request ID: ' + testReqId : ''}`);
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
            logger_1.default.error(`[HEARTBEAT:SEND] Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
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
            // Extract message type for categorization
            const segments = message.split(constants_1.SOH);
            const msgTypeField = segments.find(s => s.startsWith('35='));
            const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
            const msgTypeName = (0, message_helpers_1.getMessageTypeName)(msgType);
            // Get symbol if it exists for better logging
            const symbolField = segments.find(s => s.startsWith('55='));
            const symbol = symbolField ? symbolField.substring(3) : '';
            // Classify message
            let messageCategory = 'UNKNOWN';
            if (msgType === constants_1.MessageType.MARKET_DATA_REQUEST) {
                messageCategory = 'MARKET_DATA';
            }
            else if (msgType === constants_1.MessageType.SECURITY_LIST_REQUEST) {
                messageCategory = 'SECURITY_LIST';
            }
            else if (msgType === constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST) {
                messageCategory = 'TRADING_STATUS';
            }
            else if (msgType === constants_1.MessageType.LOGON || msgType === constants_1.MessageType.LOGOUT) {
                messageCategory = 'SESSION';
            }
            else if (msgType === constants_1.MessageType.HEARTBEAT || msgType === constants_1.MessageType.TEST_REQUEST) {
                messageCategory = 'HEARTBEAT';
            }
            // Log with category and type for clear identification
            logger_1.default.info(`[${messageCategory}:OUTGOING] Sending FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
            logger_1.default.info(`----------------------------OUTGOING MESSAGE-----------------------------`);
            logger_1.default.info(message);
            logger_1.default.debug(`Current sequence numbers: main=${sequenceManager.getMainSeqNum()}, server=${sequenceManager.getServerSeqNum()}`);
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
                logger_1.default.error('[MARKET_DATA:REQUEST] Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[MARKET_DATA:REQUEST] Creating market data request for symbols: ${symbols.join(', ')}`);
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
            socket.write(rawMessage);
            // Log with clear categorization
            const subTypes = {
                '0': 'SNAPSHOT',
                '1': 'SNAPSHOT+UPDATES',
                '2': 'DISABLE_UPDATES'
            };
            const entryTypeNames = {
                '0': 'BID',
                '1': 'OFFER',
                '2': 'TRADE',
                '3': 'INDEX_VALUE',
                '4': 'OPENING_PRICE',
                '7': 'HIGH_PRICE',
                '8': 'LOW_PRICE'
            };
            const entryTypeLabels = entryTypes.map(t => entryTypeNames[t] || t).join(', ');
            const subTypeLabel = subTypes[subscriptionType] || subscriptionType;
            logger_1.default.info(`[MARKET_DATA:REQUEST] Sent ${subTypeLabel} request with ID: ${requestId}`);
            logger_1.default.info(`[MARKET_DATA:REQUEST] Symbols: ${symbols.join(', ')} | Entry types: ${entryTypeLabels}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('[MARKET_DATA:REQUEST] Error sending market data request:', error);
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
                logger_1.default.error('[SECURITY_LIST:EQUITY] Cannot send equity security list request: not connected or not logged in');
                return null;
            }
            if (requestedEquitySecurities) {
                logger_1.default.info('[SECURITY_LIST:EQUITY] Equity securities already requested, skipping duplicate request');
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
                logger_1.default.info(`[SECURITY_LIST:EQUITY] Request sent successfully with ID: ${requestId}`);
                logger_1.default.info(`[SECURITY_LIST:EQUITY] Product: EQUITY | Market: REG+FUT`);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST:EQUITY] Failed to send request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST:EQUITY] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendSecurityListRequestForIndex = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('[SECURITY_LIST:INDEX] Cannot send index security list request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[SECURITY_LIST:INDEX] Creating request with ID: ${requestId}`);
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
            if (socket) {
                socket.write(rawMessage);
                logger_1.default.info(`[SECURITY_LIST:INDEX] Request sent successfully with ID: ${requestId}`);
                logger_1.default.info(`[SECURITY_LIST:INDEX] Product: INDEX | Market: REG | Next sequence: ${sequenceManager.getMainSeqNum()}`);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST:INDEX] Failed to send request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST:INDEX] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendIndexMarketDataRequest = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('[MARKET_DATA:INDEX] Cannot send index data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[MARKET_DATA:INDEX] Creating request for indices: ${symbols.join(', ')}`);
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
            builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3'); // Index value
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`[MARKET_DATA:INDEX] Sent SNAPSHOT request with ID: ${requestId}`);
            logger_1.default.info(`[MARKET_DATA:INDEX] Indices: ${symbols.join(', ')} | Entry type: INDEX_VALUE`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('[MARKET_DATA:INDEX] Error sending index data request:', error);
            return null;
        }
    };
    const sendSymbolMarketDataSubscription = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('[MARKET_DATA:SYMBOL] Cannot send market data subscription: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[MARKET_DATA:SYMBOL] Creating subscription for symbols: ${symbols.join(', ')}`);
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
            logger_1.default.info(`[MARKET_DATA:SYMBOL] Sent SNAPSHOT+UPDATES subscription with ID: ${requestId}`);
            logger_1.default.info(`[MARKET_DATA:SYMBOL] Symbols: ${symbols.join(', ')} | Entry types: BID, OFFER, TRADE`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('[MARKET_DATA:SYMBOL] Error sending market data subscription:', error);
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
            logger_1.default.warn('[SESSION:LOGOUT] Cannot send logout, not connected');
            emitter.emit('logout', {
                message: 'Logged out from FIX server',
                timestamp: new Date().toISOString(),
            });
            return;
        }
        try {
            logger_1.default.info('[SESSION:LOGOUT] Creating logout message');
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGOUT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(sequenceManager.getNextAndIncrement());
            if (text) {
                builder.addField(constants_1.FieldTag.TEXT, text);
                logger_1.default.info(`[SESSION:LOGOUT] Reason: ${text}`);
            }
            const message = builder.buildMessage();
            sendMessage(message);
            logger_1.default.info('[SESSION:LOGOUT] Sent logout message to server');
        }
        catch (error) {
            logger_1.default.error(`[SESSION:LOGOUT] Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendLogon = () => {
        logger_1.default.info('[SESSION:LOGON] Creating logon message');
        if (!connected) {
            logger_1.default.warn('[SESSION:LOGON] Cannot send logon, not connected');
            return;
        }
        try {
            // Always reset sequence number on logon
            msgSeqNum = 1; // Start with 1 for the logon message
            serverSeqNum = 1;
            logger_1.default.info('[SESSION:LOGON] Resetting sequence numbers to 1 for new logon');
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
            logger_1.default.info(`[SESSION:LOGON] Sending logon message with username: ${options.username}`);
            sendMessage(message);
            // Now increment sequence number for next message
            msgSeqNum++;
            logger_1.default.info(`[SESSION:LOGON] Incremented sequence number to ${msgSeqNum} for next message after logon`);
        }
        catch (error) {
            logger_1.default.error(`[SESSION:LOGON] Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleMarketDataSnapshot = (parsedMessage, emitter) => {
        try {
            // Get existing function from message-handlers module and add enhanced functionality
            const result = handleMarketDataSnapshot(parsedMessage, emitter);
            // Emit an additional categorized event that includes message type information
            emitter.emit('categorizedData', {
                category: 'MARKET_DATA',
                type: 'SNAPSHOT',
                symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || '',
                data: parsedMessage,
                timestamp: new Date().toISOString()
            });
            return result;
        }
        catch (error) {
            logger_1.default.error(`[MARKET_DATA:SNAPSHOT] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleMarketDataIncremental = (parsedMessage, emitter) => {
        try {
            // Get existing function from message-handlers module and add enhanced functionality
            const result = handleMarketDataIncremental(parsedMessage, emitter);
            // Emit an additional categorized event that includes message type information
            emitter.emit('categorizedData', {
                category: 'MARKET_DATA',
                type: 'INCREMENTAL',
                symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || '',
                data: parsedMessage,
                timestamp: new Date().toISOString()
            });
            return result;
        }
        catch (error) {
            logger_1.default.error(`[MARKET_DATA:INCREMENTAL] Error handling incremental refresh: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleSecurityList = (parsedMessage, emitter, securityCache) => {
        try {
            // Get existing function from message-handlers module and add enhanced functionality
            const result = handleSecurityList(parsedMessage, emitter, securityCache);
            // Determine if this is an EQUITY or INDEX security list
            let securityType = 'UNKNOWN';
            const product = parsedMessage['460']; // Product type field
            if (product === '5') {
                securityType = 'INDEX';
            }
            else {
                securityType = 'EQUITY';
            }
            // Emit an additional categorized event that includes message type information
            emitter.emit('categorizedData', {
                category: 'SECURITY_LIST',
                type: securityType,
                count: parseInt(parsedMessage[constants_1.FieldTag.NO_RELATED_SYM] || '0', 10),
                data: parsedMessage,
                timestamp: new Date().toISOString()
            });
            return result;
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error handling security list: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleTradingSessionStatus = (parsedMessage, emitter) => {
        try {
            // Get existing function from message-handlers module and add enhanced functionality
            const result = handleTradingSessionStatus(parsedMessage, emitter);
            // Emit an additional categorized event that includes message type information
            emitter.emit('categorizedData', {
                category: 'TRADING_STATUS',
                type: 'SESSION',
                session: parsedMessage[constants_1.FieldTag.TRADING_SESSION_ID] || '',
                data: parsedMessage,
                timestamp: new Date().toISOString()
            });
            return result;
        }
        catch (error) {
            logger_1.default.error(`[TRADING_STATUS:SESSION] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleTradingStatus = (parsedMessage, emitter) => {
        try {
            // Get existing function from message-handlers module and add enhanced functionality
            const result = handleTradingStatus(parsedMessage, emitter);
            // Emit an additional categorized event that includes message type information
            emitter.emit('categorizedData', {
                category: 'TRADING_STATUS',
                type: 'SYMBOL',
                symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || '',
                status: parsedMessage['326'] || '', // Trading Status field
                data: parsedMessage,
                timestamp: new Date().toISOString()
            });
            return result;
        }
        catch (error) {
            logger_1.default.error(`[TRADING_STATUS:SYMBOL] Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
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
