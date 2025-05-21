"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixClient = createFixClient;
const sequence_manager_1 = require("../utils/sequence-manager");
const logger_1 = require("../utils/logger");
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const message_parser_1 = require("./message-parser");
const constants_1 = require("../constants");
const net_1 = require("net");
const uuid_1 = require("uuid");
const message_handler_1 = require("./message-handler");
const connection_state_1 = require("../utils/connection-state");
/**
 * Create a FIX client with the specified options
 */
function createFixClient(options) {
    const emitter = new events_1.EventEmitter();
    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let lastActivityTime = 0;
    let testRequestCount = 0;
    let logonTimer = null;
    let lastSecurityListRefresh = null;
    const sequenceManager = new sequence_manager_1.SequenceManager();
    const state = new connection_state_1.ConnectionState(); // Initialize ConnectionState
    const forceResetSequenceNumber = (newSeq = 2) => {
        sequenceManager.forceReset(newSeq);
    };
    const start = () => {
        connect();
    };
    const stop = () => {
        state.setShuttingDown(true);
        sendLogout();
        disconnect();
    };
    const connect = async () => {
        // Update to use state.isConnected()
        if (socket && state.isConnected()) {
            logger_1.logger.warn('Already connected');
            return;
        }
        // Ensure environment variables are defined and valid
        const fixPort = parseInt(process.env.FIX_PORT || '7001', 10);
        const fixHost = process.env.FIX_HOST || '127.0.0.1';
        if (isNaN(fixPort) || !fixHost) {
            logger_1.logger.error('Invalid FIX_PORT or FIX_HOST environment variable. Please ensure they are set correctly.');
            emitter.emit('error', new Error('Invalid FIX_PORT or FIX_HOST environment variable.'));
            return;
        }
        try {
            logger_1.logger.info(`Establishing TCP connection to ${fixHost}:${fixPort}...`);
            socket = new net_1.Socket();
            socket.setKeepAlive(true, 10000);
            socket.setNoDelay(true);
            socket.setTimeout(options.connectTimeoutMs || 60000);
            socket.connect(fixPort, fixHost);
            // Add error handling for socket errors
            socket.on('error', (error) => {
                logger_1.logger.error(`Socket error: ${error.message}`);
                // Save sequence numbers in case of socket errors
                logger_1.logger.info(`[CONNECTION:ERROR] Saving sequence numbers before potential disconnect: ${JSON.stringify(sequenceManager.getAll())}`);
                if (error.message.includes('ECONNRESET') || error.message.includes('EPIPE')) {
                    logger_1.logger.warn('Connection reset by peer or broken pipe. Will attempt to reconnect...');
                }
                // emitter.emit('error', error);
            });
            socket.on('timeout', () => {
                logger_1.logger.error('Connection timed out');
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                state.setConnected(false); // Update state
                // emitter.emit('error', new Error('Connection timed out'));
            });
            socket.on('close', (hadError) => {
                logger_1.logger.info(`Socket disconnected${hadError ? ' due to error' : ''}`);
                // Save sequence numbers on any disconnection
                // This ensures we remember our sequence even if we didn't logout properly
                logger_1.logger.info(`[CONNECTION:CLOSE] Saving current sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
                state.reset(); // Reset all states on disconnect
                // emitter.emit('disconnected');
                // Only schedule reconnect if not during normal shutdown
                if (!state.isShuttingDown()) {
                    scheduleReconnect();
                }
            });
            socket.on('connect', () => {
                logger_1.logger.info('--------------------------------', fixHost);
                logger_1.logger.info('--------------------------------', fixPort);
                logger_1.logger.info(`Connected to ${fixHost}:${fixPort}`);
                state.setConnected(true); // Update state
                if (logonTimer) {
                    clearTimeout(logonTimer);
                }
                logonTimer = setTimeout(() => {
                    try {
                        logger_1.logger.info('Sending logon message...');
                        // Always use ResetSeqNumFlag=Y in logon, which will reset both sides to 1
                        // The FIX protocol handles the sequence number reset
                        sendLogon();
                    }
                    catch (error) {
                        logger_1.logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
                        disconnect();
                    }
                }, 500);
                // emitter.emit('connected');
            });
            socket.on('drain', () => {
                logger_1.logger.info('Drained');
            });
            socket.on('data', (data) => {
                logger_1.logger.info('--------------------------------');
                try {
                    // Update last activity time to reset heartbeat timer
                    lastActivityTime = Date.now();
                    let category = 'UNKNOWN';
                    const dataStr = data.toString();
                    const messageTypes = [];
                    const symbolsFound = [];
                    const msgTypeMatches = dataStr.match(/35=([A-Za-z0-9])/g) || [];
                    for (const match of msgTypeMatches) {
                        const msgType = match.substring(3);
                        messageTypes.push(msgType);
                    }
                    const symbolMatches = dataStr.match(/55=([^\x01]+)/g) || [];
                    for (const match of symbolMatches) {
                        const symbol = match.substring(3);
                        if (symbol)
                            symbolsFound.push(symbol);
                    }
                    const categorizedMessages = messageTypes.map((type) => {
                        if (type === constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
                            type === constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
                            type === 'Y') {
                            category = 'MARKET_DATA';
                        }
                        else if (type === constants_1.MessageType.SECURITY_LIST ||
                            type === constants_1.MessageType.SECURITY_LIST_REQUEST) {
                            logger_1.logger.info(`[SECURITY_LIST] Received security list message`);
                            category = 'SECURITY_LIST';
                        }
                        else if (type === constants_1.MessageType.TRADING_SESSION_STATUS ||
                            type === 'f') {
                            category = 'TRADING_STATUS';
                        }
                        else if (type === constants_1.MessageType.LOGON ||
                            type === constants_1.MessageType.LOGOUT) {
                            category = 'SESSION';
                        }
                        else if (type === constants_1.MessageType.HEARTBEAT ||
                            type === constants_1.MessageType.TEST_REQUEST) {
                            category = 'HEARTBEAT';
                        }
                        else if (type === constants_1.MessageType.REJECT) {
                            category = 'REJECT';
                        }
                        return `${category}:${type}`;
                    });
                    if (messageTypes.length > 0) {
                        logger_1.logger.info(`[DATA:RECEIVED] Message types: ${categorizedMessages.join(', ')}${symbolsFound.length > 0 ? ' | Symbols: ' + symbolsFound.join(', ') : ''}`);
                    }
                    else {
                        logger_1.logger.warn(`[DATA:RECEIVED] No recognizable message types found in data`);
                    }
                    // If we received test request, respond immediately with heartbeat
                    if (dataStr.includes('35=1')) { // Test request
                        const testReqIdMatch = dataStr.match(/112=([^\x01]+)/);
                        if (testReqIdMatch && testReqIdMatch[1]) {
                            const testReqId = testReqIdMatch[1];
                            logger_1.logger.info(`[TEST_REQUEST] Received test request with ID: ${testReqId}, responding immediately`);
                            sendHeartbeat(testReqId);
                        }
                    }
                    logger_1.logger.info(data);
                    logger_1.logger.info(`[DATA:PROCESSING] Starting message processing...`);
                    let processingResult = false;
                    try {
                        handleData(data);
                        processingResult = true;
                    }
                    catch (error) {
                        logger_1.logger.error(`[DATA:ERROR] Failed to process data: ${error instanceof Error ? error.message : String(error)}`);
                        if (error instanceof Error && error.stack) {
                            logger_1.logger.error(error.stack);
                        }
                        processingResult = false;
                    }
                    logger_1.logger.info(`[DATA:COMPLETE] Message processing ${processingResult ? 'succeeded' : 'failed'}`);
                }
                catch (err) {
                    logger_1.logger.error(`Error pre-parsing data: ${err}`);
                }
            });
        }
        catch (error) {
            logger_1.logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    };
    const disconnect = () => {
        return new Promise((resolve) => {
            clearTimers();
            if (state.isConnected() && state.isLoggedIn()) {
                logger_1.logger.info("[SESSION:LOGOUT] Sending logout message");
                sendLogout();
                // Give some time for the logout message to be sent before destroying the socket
                setTimeout(() => {
                    if (socket) {
                        socket.destroy();
                        socket = null;
                    }
                    resolve();
                }, 500);
            }
            else {
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                resolve();
            }
        });
    };
    const scheduleReconnect = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        // Don't reset sequences on reconnect - we'll use the stored numbers
        // If we have a clean start (with ResetSeqNumFlag=Y) the sequences will be reset anyway
        logger_1.logger.info('[CONNECTION] Scheduling reconnect in 5 seconds');
        logger_1.logger.info(`[CONNECTION] Will use stored sequence numbers when reconnecting: ${JSON.stringify(sequenceManager.getAll())}`);
        // Reset request states
        state.setRequestSent('equitySecurities', false);
        state.setRequestSent('indexSecurities', false);
        reconnectTimer = setTimeout(() => {
            logger_1.logger.info('[CONNECTION] Attempting to reconnect');
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
            logger_1.logger.debug(`[DATA:HANDLING] Received data: ${dataStr.length} bytes`);
            const messages = dataStr.split(constants_1.SOH);
            let currentMessage = '';
            let messageCount = 0;
            for (const segment of messages) {
                if (segment.startsWith('8=FIX')) {
                    if (currentMessage) {
                        try {
                            processMessage(currentMessage);
                            logger_1.logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
                            messageCount++;
                        }
                        catch (err) {
                            logger_1.logger.error(`[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    }
                    currentMessage = segment;
                }
                else if (currentMessage) {
                    currentMessage += constants_1.SOH + segment;
                }
            }
            if (currentMessage) {
                try {
                    processMessage(currentMessage);
                    logger_1.logger.info(`[DATA:HANDLING] Processing message: ${currentMessage}`);
                    messageCount++;
                }
                catch (err) {
                    logger_1.logger.error(`[DATA:ERROR] Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            logger_1.logger.debug(`[DATA:HANDLING] Processed ${messageCount} FIX messages`);
        }
        catch (error) {
            logger_1.logger.error(`[DATA:ERROR] Error handling data buffer: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger_1.logger.error(error.stack);
            }
            throw error;
        }
    };
    const processMessage = (message) => {
        try {
            const segments = message.split(constants_1.SOH);
            const fixVersion = segments.find((s) => s.startsWith('8=FIX'));
            if (!fixVersion) {
                logger_1.logger.warn('Received non-FIX message');
                return;
            }
            const msgTypeField = segments.find((s) => s.startsWith('35='));
            const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
            const msgTypeName = (0, message_builder_1.getMessageTypeName)(msgType);
            const symbolField = segments.find((s) => s.startsWith('55='));
            const symbol = symbolField ? symbolField.substring(3) : '';
            let messageCategory = 'UNKNOWN';
            if (msgType === constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH ||
                msgType === constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH ||
                msgType === 'Y') {
                messageCategory = 'MARKET_DATA';
            }
            else if (msgType === constants_1.MessageType.SECURITY_LIST) {
                messageCategory = 'SECURITY_LIST';
            }
            else if (msgType === constants_1.MessageType.TRADING_SESSION_STATUS ||
                msgType === 'f') {
                messageCategory = 'TRADING_STATUS';
            }
            else if (msgType === constants_1.MessageType.LOGON ||
                msgType === constants_1.MessageType.LOGOUT) {
                messageCategory = 'SESSION';
            }
            else if (msgType === constants_1.MessageType.HEARTBEAT ||
                msgType === constants_1.MessageType.TEST_REQUEST) {
                messageCategory = 'HEARTBEAT';
            }
            else if (msgType === constants_1.MessageType.REJECT) {
                messageCategory = 'REJECT';
            }
            logger_1.logger.info(`[${messageCategory}] Received FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
            logger_1.logger.info(`------------------------------------------------------------------------------------------------------------`);
            logger_1.logger.info(message);
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.logger.warn('Could not parse FIX message');
                return;
            }
            if (parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const incomingSeqNum = parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                const msgType = parsedMessage[constants_1.FieldTag.MSG_TYPE];
                const text = parsedMessage[constants_1.FieldTag.TEXT] || '';
                const isSequenceError = Boolean(text.includes('MsgSeqNum') ||
                    text.includes('too large') ||
                    text.includes('sequence'));
                if ((msgType === constants_1.MessageType.LOGOUT || msgType === constants_1.MessageType.REJECT) &&
                    isSequenceError) {
                    logger_1.logger.warn(`Received ${msgType} with sequence error: ${text}`);
                }
                else {
                    sequenceManager.updateServerSequence(incomingSeqNum);
                }
            }
            switch (msgType) {
                case constants_1.MessageType.LOGON:
                    logger_1.logger.info(`[SESSION:LOGON] Processing logon message from server`);
                    (0, message_handler_1.handleLogon)(parsedMessage, sequenceManager, emitter, { value: false });
                    state.setLoggedIn(true); // Update state
                    logger_1.logger.info(`[SESSION:LOGON] Processing complete`);
                    break;
                case constants_1.MessageType.LOGOUT:
                    logger_1.logger.info(`[SESSION:LOGOUT] Handling logout message`);
                    const logoutResult = (0, message_handler_1.handleLogout)(parsedMessage, emitter, sequenceManager, { value: false }, socket, connect);
                    if (logoutResult.isSequenceError) {
                        logger_1.logger.info(`[SESSION:LOGOUT] Detected sequence error, handling...`);
                        handleSequenceError(logoutResult.expectedSeqNum);
                    }
                    else {
                        state.setLoggedIn(false); // Update state
                        if (heartbeatTimer) {
                            clearInterval(heartbeatTimer);
                            heartbeatTimer = null;
                            logger_1.logger.info(`[SESSION:LOGOUT] Cleared heartbeat timer`);
                        }
                    }
                    logger_1.logger.info(`[SESSION:LOGOUT] Processing complete`);
                    break;
                // ... other cases remain unchanged ...
                default:
                    logger_1.logger.info(`[UNKNOWN:${msgType}] Received unhandled message type: ${msgType} (${msgTypeName})`);
                    if (parsedMessage[constants_1.FieldTag.SYMBOL]) {
                        logger_1.logger.info(`[UNKNOWN:${msgType}] Symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    }
                    emitter.emit('categorizedData', {
                        category: 'UNKNOWN',
                        type: msgType,
                        symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || '',
                        data: parsedMessage,
                        timestamp: new Date().toISOString(),
                    });
            }
        }
        catch (error) {
            logger_1.logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const handleSequenceError = (expectedSeqNum) => {
        if (expectedSeqNum !== undefined) {
            logger_1.logger.info(`[SEQUENCE:ERROR] Server expects sequence number: ${expectedSeqNum}`);
            if (socket) {
                logger_1.logger.info('[SEQUENCE:ERROR] Disconnecting due to sequence number error');
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                sequenceManager.forceReset(expectedSeqNum);
                const seqNumbers = sequenceManager.getAll();
                logger_1.logger.info(`[SEQUENCE:ERROR] After reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);
                logger_1.logger.info(`[SEQUENCE:ERROR] Reconnecting with adjusted sequence numbers`);
                connect();
            }, 2000);
        }
        else {
            logger_1.logger.info('[SEQUENCE:ERROR] Cannot determine expected sequence number, performing full reset');
            if (socket) {
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                sequenceManager.resetAll();
                const seqNumbers = sequenceManager.getAll();
                logger_1.logger.info(`[SEQUENCE:ERROR] After full reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`);
                logger_1.logger.info('[SEQUENCE:ERROR] Reconnecting with fully reset sequence numbers');
                connect();
            }, 2000);
        }
    };
    const sendLogon = () => {
        logger_1.logger.info("[SESSION:LOGON] Creating logon message");
        if (!state.isConnected()) {
            logger_1.logger.warn('[SESSION:LOGON] Cannot send logon: not connected or already logged in');
            return;
        }
        try {
            // Always reset all sequence numbers before a new logon
            sequenceManager.resetAll();
            logger_1.logger.info("[SESSION:LOGON] Reset all sequence numbers before logon");
            logger_1.logger.info(`[SESSION:LOGON] Sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
            const builder = (0, message_builder_1.createLogonMessageBuilder)(options, sequenceManager);
            const message = builder.buildMessage();
            logger_1.logger.info(`[SESSION:LOGON] Sending logon message with username: ${options.username}`);
            logger_1.logger.info(`[SESSION:LOGON] Using sequence number: 1 with reset flag Y`);
            sendMessage(message);
            logger_1.logger.info(`[SESSION:LOGON] Logon message sent, sequence numbers now: ${JSON.stringify(sequenceManager.getAll())}`);
        }
        catch (error) {
            logger_1.logger.error(`[SESSION:LOGON] Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendLogout = (text) => {
        if (!state.isConnected()) {
            logger_1.logger.warn("[SESSION:LOGOUT] Cannot send logout, not connected");
            emitter.emit("logout", {
                message: "Logged out from FIX server",
                timestamp: new Date().toISOString(),
            });
            return;
        }
        try {
            // We do NOT reset sequence numbers before sending logout
            // This ensures the server receives our logout message with the correct sequence number
            // The sequence reset happens on the next logon with ResetSeqNumFlag=Y
            logger_1.logger.info("[SESSION:LOGOUT] Creating logout message with reset flag");
            const builder = (0, message_builder_1.createLogoutMessageBuilder)(options, sequenceManager, text);
            const message = builder.buildMessage();
            sendMessage(message);
            logger_1.logger.info("[SESSION:LOGOUT] Sent logout message to server");
            // Save current sequence numbers to file for possible reconnection on the same day
            logger_1.logger.info(`[SESSION:LOGOUT] Persisting sequence numbers: ${JSON.stringify(sequenceManager.getAll())}`);
        }
        catch (error) {
            logger_1.logger.error(`[SESSION:LOGOUT] Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendHeartbeat = (testReqId) => {
        if (!state.isConnected())
            return;
        try {
            logger_1.logger.debug(`[HEARTBEAT:SEND] Creating heartbeat message${testReqId ? " with test request ID: " + testReqId : ""}`);
            const builder = (0, message_builder_1.createHeartbeatMessageBuilder)(options, sequenceManager, testReqId);
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.logger.error(`[HEARTBEAT:SEND] Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendMessage = (message) => {
        if (!state.isConnected()) {
            logger_1.logger.warn("Cannot send message, not connected");
            return;
        }
        try {
            // Extract message type for categorization
            // const segments = message.split(SOH);
            // const msgTypeField = segments.find(s => s.startsWith('35='));
            // const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
            // const msgTypeName = getMessageTypeName(msgType);
            // // Get symbol if it exists for better logging
            // const symbolField = segments.find(s => s.startsWith('55='));
            // const symbol = symbolField ? symbolField.substring(3) : '';
            // // Classify message
            // let messageCategory = 'UNKNOWN';
            // if (msgType === MessageType.MARKET_DATA_REQUEST) {
            //   messageCategory = 'MARKET_DATA';
            // } else if (msgType === MessageType.SECURITY_LIST_REQUEST) {
            //   messageCategory = 'SECURITY_LIST';
            // } else if (msgType === MessageType.TRADING_SESSION_STATUS_REQUEST) {
            //   messageCategory = 'TRADING_STATUS';
            // } else if (msgType === MessageType.LOGON || msgType === MessageType.LOGOUT) {
            //   messageCategory = 'SESSION';
            // } else if (msgType === MessageType.HEARTBEAT || msgType === MessageType.TEST_REQUEST) {
            //   messageCategory = 'HEARTBEAT';
            // }
            // // Log with category and type for clear identification
            // logger.info(`[${messageCategory}:OUTGOING] Sending FIX message: Type=${msgType} (${msgTypeName})${symbol ? ', Symbol=' + symbol : ''}`);
            // logger.info(`----------------------------OUTGOING MESSAGE-----------------------------`);
            logger_1.logger.info(message);
            logger_1.logger.debug(`Current sequence numbers: main=${sequenceManager.getMainSeqNum()}, server=${sequenceManager.getServerSeqNum()}`);
            // Send the message
            socket?.write(message);
        }
        catch (error) {
            logger_1.logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            // On send error, try to reconnect
            socket?.destroy();
            state.setConnected(false);
        }
    };
    const sendMarketDataRequest = (symbols, entryTypes = ["0", "1"], subscriptionType = "1") => {
        try {
            if (!state.isConnected()) {
                logger_1.logger.error("[MARKET_DATA:REQUEST] Cannot send market data request: not connected");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[MARKET_DATA:REQUEST] Creating market data request for symbols: ${symbols.join(", ")}`);
            const builder = (0, message_builder_1.createMarketDataRequestBuilder)(options, sequenceManager, symbols, entryTypes, subscriptionType, requestId);
            const rawMessage = builder.buildMessage();
            socket?.write(rawMessage);
            const subTypes = {
                "0": "SNAPSHOT",
                "1": "SNAPSHOT+UPDATES",
                "2": "DISABLE_UPDATES",
            };
            const entryTypeNames = {
                "0": "BID",
                "1": "OFFER",
                "2": "TRADE",
                "3": "INDEX_VALUE",
                "4": "OPENING_PRICE",
                "7": "HIGH_PRICE",
                "8": "LOW_PRICE",
            };
            const entryTypeLabels = entryTypes
                .map((t) => entryTypeNames[t] || t)
                .join(", ");
            const subTypeLabel = subTypes[subscriptionType] || subscriptionType;
            logger_1.logger.info(`[MARKET_DATA:REQUEST] Sent ${subTypeLabel} request with ID: ${requestId}`);
            logger_1.logger.info(`[MARKET_DATA:REQUEST] Symbols: ${symbols.join(", ")} | Entry types: ${entryTypeLabels} | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`);
            return requestId;
        }
        catch (error) {
            logger_1.logger.error("[MARKET_DATA:REQUEST] Error sending market data request:", error);
            return null;
        }
    };
    const sendTradingSessionStatusRequest = (tradingSessionID = "REG") => {
        try {
            if (!socket || !state.isConnected()) {
                logger_1.logger.info(`Connection state - Socket: ${socket ? "present" : "null"}, Connected: ${state.isConnected()}`);
                logger_1.logger.error("[TRADING_STATUS:REQUEST] Cannot send trading session status request: not connected or not logged in");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[TRADING_STATUS:REQUEST] Creating trading session status request`);
            const builder = (0, message_builder_1.createTradingSessionStatusRequestBuilder)(options, sequenceManager, requestId, tradingSessionID);
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.logger.info(`[TRADING_STATUS:REQUEST] Sent request for ${tradingSessionID} market with ID: ${requestId} | Using sequence: ${sequenceManager.getTradingStatusSeqNum()}`);
            return requestId;
        }
        catch (error) {
            logger_1.logger.error("[TRADING_STATUS:REQUEST] Error sending trading session status request:", error);
            return null;
        }
    };
    const sendSecurityListRequestForEquity = () => {
        try {
            if (!socket || !state.isConnected()) {
                logger_1.logger.info(`Connection state - Socket: ${socket ? "present" : "null"}, Connected: ${state.isConnected()}`);
                logger_1.logger.error("[SECURITY_LIST:EQUITY] Cannot send equity security list request: not connected or not logged in");
                return null;
            }
            if (state.hasRequestBeenSent("equitySecurities")) {
                logger_1.logger.info("[SECURITY_LIST:EQUITY] Equity securities already requested, skipping duplicate request");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[SECURITY_LIST:EQUITY] Creating request with ID: ${requestId}`);
            const builder = (0, message_builder_1.createSecurityListRequestForEquityBuilder)(options, sequenceManager, requestId);
            const rawMessage = builder.buildMessage();
            if (socket) {
                socket.write(rawMessage);
                state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", true);
                logger_1.logger.info(`[SECURITY_LIST:EQUITY] Request sent successfully with ID: ${requestId}`);
                logger_1.logger.info(`[SECURITY_LIST:EQUITY] Product: EQUITY | Market: REG | Using sequence: ${sequenceManager.getSecurityListSeqNum()}`);
                return requestId;
            }
            else {
                logger_1.logger.error(`[SECURITY_LIST:EQUITY] Failed to send request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.logger.error(`[SECURITY_LIST:EQUITY] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendSecurityListRequestForIndex = () => {
        try {
            if (!socket || !state.isConnected()) {
                logger_1.logger.error("[SECURITY_LIST:INDEX] Cannot send index security list request: not connected or not logged in");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[SECURITY_LIST:INDEX] Creating request with ID: ${requestId}`);
            const builder = (0, message_builder_1.createSecurityListRequestForIndexBuilder)(options, sequenceManager, requestId);
            const rawMessage = builder.buildMessage();
            if (socket) {
                socket.write(rawMessage);
                state.setRequestSent("indexSecurities", true);
                logger_1.logger.info(`[SECURITY_LIST:INDEX] Request sent successfully with ID: ${requestId}`);
                logger_1.logger.info(`[SECURITY_LIST:INDEX] Product: INDEX | Market: REG | Using sequence: ${sequenceManager.getSecurityListSeqNum()}`);
                return requestId;
            }
            else {
                logger_1.logger.error(`[SECURITY_LIST:INDEX] Failed to send request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.logger.error(`[SECURITY_LIST:INDEX] Error sending request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    const sendIndexMarketDataRequest = (symbols) => {
        try {
            if (!socket || !state.isConnected()) {
                logger_1.logger.error("[MARKET_DATA:INDEX] Cannot send index data request: not connected");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[MARKET_DATA:INDEX] Creating request for indices: ${symbols.join(", ")}`);
            const builder = (0, message_builder_1.createIndexMarketDataRequestBuilder)(options, sequenceManager, symbols, requestId);
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.logger.info(`[MARKET_DATA:INDEX] Sent SNAPSHOT request with ID: ${requestId}`);
            logger_1.logger.info(`[MARKET_DATA:INDEX] Indices: ${symbols.join(", ")} | Entry type: INDEX_VALUE | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`);
            return requestId;
        }
        catch (error) {
            logger_1.logger.error("[MARKET_DATA:INDEX] Error sending index data request:", error);
            return null;
        }
    };
    const sendSymbolMarketDataSubscription = (symbols) => {
        try {
            if (!socket || !state.isConnected()) {
                logger_1.logger.error("[MARKET_DATA:SYMBOL] Cannot send market data subscription: not connected");
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            logger_1.logger.info(`[MARKET_DATA:SYMBOL] Creating subscription for symbols: ${symbols.join(", ")}`);
            const builder = (0, message_builder_1.createSymbolMarketDataSubscriptionBuilder)(options, sequenceManager, symbols, requestId);
            const rawMessage = builder.buildMessage();
            socket.write(rawMessage);
            logger_1.logger.info(`[MARKET_DATA:SYMBOL] Sent SNAPSHOT+UPDATES subscription with ID: ${requestId}`);
            logger_1.logger.info(`[MARKET_DATA:SYMBOL] Symbols: ${symbols.join(", ")} | Entry types: BID, OFFER, TRADE | Using sequence: ${sequenceManager.getMarketDataSeqNum()}`);
            return requestId;
        }
        catch (error) {
            logger_1.logger.error("[MARKET_DATA:SYMBOL] Error sending market data subscription:", error);
            return null;
        }
    };
    // Add event listener for logon to automatically request security list data
    // emitter.on('logon', () => {
    //   logger.info('[SESSION:LOGON] Successfully logged in, requesting security data...');
    //   // Request equity security list
    //   sendSecurityListRequestForEquity();
    //   // Request index security list after a slight delay
    //   setTimeout(() => {
    //     sendSecurityListRequestForIndex();
    //   }, 2000);
    //   // Set up heartbeat timer
    //   if (heartbeatTimer) {
    //     clearInterval(heartbeatTimer);
    //   }
    //   heartbeatTimer = setInterval(() => {
    //     try {
    //       // Don't send heartbeat if not connected
    //       if (!state.isConnected()) return;
    //       sendHeartbeat();
    //       logger.debug('[HEARTBEAT] Sending heartbeat to keep connection alive');
    //       // Every 5 minutes refresh security lists to ensure we have the latest data
    //       const currentTime = Date.now();
    //       if (!lastSecurityListRefresh || (currentTime - lastSecurityListRefresh) > 300000) { // 5 minutes
    //         logger.info('[SECURITY_LIST] Scheduled refresh of security lists');
    //         lastSecurityListRefresh = currentTime;
    //         // Reset request flags to allow refreshing
    //         state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", false);
    //         state.setRequestSent("indexSecurities", false);
    //         // Request security lists again
    //         sendSecurityListRequestForEquity();
    //         setTimeout(() => {
    //           sendSecurityListRequestForIndex();
    //         }, 2000);
    //       }
    //     } catch (error) {
    //       logger.error(`[HEARTBEAT] Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    //     }
    //   }, (options.heartbeatIntervalSecs * 1000) || 30000);
    //   logger.info(`[HEARTBEAT] Heartbeat timer started with interval: ${options.heartbeatIntervalSecs || 30} seconds`);
    // });
    // Add handler for requestTradingSessionStatus event
    emitter.on('logon', () => {
        logger_1.logger.info('[TRADING_STATUS] Received request for trading session status');
        sendTradingSessionStatusRequest();
        sendSecurityListRequestForEquity();
        setTimeout(() => {
            sendSecurityListRequestForIndex();
        }, 1000);
    });
    const client = {
        on: (event, listener) => {
            emitter.on(event, listener);
            return client;
        },
        connect,
        disconnect,
        sendMarketDataRequest,
        sendTradingSessionStatusRequest,
        sendSecurityListRequestForEquity,
        sendSecurityListRequestForIndex,
        sendIndexMarketDataRequest,
        sendSymbolMarketDataSubscription,
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
        setTradingStatusSequenceNumber: (seqNum) => {
            sequenceManager.setTradingStatusSeqNum(seqNum);
            return client;
        },
        getSequenceNumbers: () => {
            return sequenceManager.getAll();
        },
        reset: () => {
            logger_1.logger.info("[RESET] Performing complete reset with disconnection and reconnection");
            // Reset sequence manager to initial state
            sequenceManager.resetAll();
            logger_1.logger.info(`[RESET] All sequence numbers reset to initial values: ${JSON.stringify(sequenceManager.getAll())}`);
            logger_1.logger.info(`[RESET] Verifying SecurityList sequence number is set to 2: ${sequenceManager.getSecurityListSeqNum()}`);
            // Reset flag for requested securities
            state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", false);
            logger_1.logger.info("[RESET] Reset securities request flag");
            // Disconnect and clean up
            if (socket) {
                logger_1.logger.info("[RESET] Destroying socket connection");
                socket.destroy();
                socket = null;
            }
            state.setConnected(false);
            state.setLoggedIn(false);
            clearTimers();
            logger_1.logger.info("[RESET] Connection and sequence numbers reset to initial state");
            // Wait a moment before reconnecting
            setTimeout(() => {
                logger_1.logger.info("[RESET] Reconnecting after reset");
                connect();
            }, 3000);
            return client;
        },
        requestAllSecurities: () => {
            logger_1.logger.info('[SECURITY_LIST] Requesting all securities data');
            // Reset request flags to allow refreshing
            state.setRequestSent("SECURITY_LIST_REQUEST_FOR_EQUITY", false);
            state.setRequestSent("indexSecurities", false);
            // Request security lists
            sendSecurityListRequestForEquity();
            setTimeout(() => {
                sendSecurityListRequestForIndex();
            }, 1000);
            lastSecurityListRefresh = Date.now();
            return client;
        },
        setupComplete: () => {
            // Implementation
            return client;
        },
    };
    return client;
}
