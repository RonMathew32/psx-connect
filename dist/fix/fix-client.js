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
            // // Handle complete messages
            // receivedData += dataStr;
            // processMessage(receivedData);
            // // parseMarketDataSnapshotToJson(receivedData);
            // receivedData = '';
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
            emitter.emit('rawMessage', (0, message_parser_1.parseFixMessage)(message));
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
            // Log symbol information if present
            if (parsedMessage[constants_1.FieldTag.SYMBOL]) {
                logger_1.default.info(`Symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                // Log additional symbol-related fields
                if (parsedMessage['140'])
                    logger_1.default.info(`  Last Price: ${parsedMessage['140']}`);
                if (parsedMessage['8503'])
                    logger_1.default.info(`  Volume: ${parsedMessage['8503']}`);
                if (parsedMessage['387'])
                    logger_1.default.info(`  Total Value: ${parsedMessage['387']}`);
                if (parsedMessage['8504'])
                    logger_1.default.info(`  Market Cap: ${parsedMessage['8504']}`);
                // Additional market data fields
                if (parsedMessage['269']) {
                    const entryType = parsedMessage['269'];
                    const price = parsedMessage['270'];
                    const size = parsedMessage['271'];
                    logger_1.default.info(`  Entry Type ${entryType}: Price=${price}, Size=${size}`);
                }
                // Change and percentage change
                if (parsedMessage['x1'])
                    logger_1.default.info(`  Change: ${parsedMessage['x1']}`);
                if (parsedMessage['x2'])
                    logger_1.default.info(`  Change %: ${parsedMessage['x2']}`);
                // High and Low
                if (parsedMessage['xe'])
                    logger_1.default.info(`  High: ${parsedMessage['xe']}`);
                if (parsedMessage['xf'])
                    logger_1.default.info(`  Low: ${parsedMessage['xf']}`);
                // Open and Close
                if (parsedMessage['0'])
                    logger_1.default.info(`  Open: ${parsedMessage['0']}`);
                if (parsedMessage['140'])
                    logger_1.default.info(`  Close: ${parsedMessage['140']}`);
                // Bid and Ask
                if (parsedMessage['2'])
                    logger_1.default.info(`  Bid: ${parsedMessage['2']}`);
                if (parsedMessage['4'])
                    logger_1.default.info(`  Ask: ${parsedMessage['4']}`);
                // Trading Status
                if (parsedMessage['102'])
                    logger_1.default.info(`  Trading Status: ${parsedMessage['102']}`);
                // Additional PSX specific fields
                if (parsedMessage['8538'])
                    logger_1.default.info(`  Trading Session: ${parsedMessage['8538']}`);
                if (parsedMessage['10201'])
                    logger_1.default.info(`  Market ID: ${parsedMessage['10201']}`);
                if (parsedMessage['11500'])
                    logger_1.default.info(`  Market Type: ${parsedMessage['11500']}`);
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
                    // logger.info(`Received market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
                    handleMarketDataSnapshot(parsedMessage);
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    logger_1.default.info(`Received market data incremental refresh for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    handleMarketDataIncremental(parsedMessage);
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    handleSecurityList(parsedMessage);
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    handleTradingSessionStatus(parsedMessage);
                    break;
                case 'f': // Trading Status - specific PSX format
                    logger_1.default.info(`Received TRADING STATUS for symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    handleTradingStatus(parsedMessage);
                    break;
                case constants_1.MessageType.REJECT:
                    handleReject(parsedMessage);
                    break;
                case 'Y': // Market Data Request Reject
                    logger_1.default.error(`Received MARKET DATA REQUEST REJECT message: ${JSON.stringify(parsedMessage)}`);
                    handleMarketDataRequestReject(parsedMessage);
                    break;
                default:
                    logger_1.default.info(`Received unhandled message type: ${messageType} (${getMessageTypeName(messageType)})`);
                    if (parsedMessage[constants_1.FieldTag.SYMBOL]) {
                        logger_1.default.info(`  Symbol: ${parsedMessage[constants_1.FieldTag.SYMBOL]}`);
                    }
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
            emitter.emit('marketData', marketDataItems);
            if (marketDataItems.length > 0) {
                logger_1.default.info(`Extracted ${marketDataItems.length} market data items for ${symbol}`);
                // Check if this is KSE data
                const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
                if (isKseData) {
                    logger_1.default.info(`Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
                    emitter.emit('kseData', marketDataItems);
                }
                // Also emit general market data event
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
        // Get server's sequence number
        const serverSeq = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
        msgSeqNum = serverSeq + 1; // Set our next sequence number to be one more than server's
        logger_1.default.info(`Successfully logged in to FIX server. Server sequence: ${serverSeq}, Next sequence: ${msgSeqNum}`);
        // Send initial requests sequentially with delays
        // setTimeout(() => {
        //   if (loggedIn) {
        //     // First request
        //     sendTradingSessionStatusRequest();
        //     // Second request after 500ms
        //     setTimeout(() => {
        //       if (loggedIn) {
        //         sendSecurityListRequestForEquity();
        //         // Third request after another 500ms
        //         setTimeout(() => {
        //           if (loggedIn) {
        //             sendSecurityListRequestForIndex();
        //             // Start index updates after all initial requests
        //             setTimeout(() => {
        //               if (loggedIn) {
        //                 startIndexUpdates();
        //               }
        //             }, 500);
        //           }
        //         }, 500);
        //       }
        //     }, 500);
        //   }
        // }, 1000);
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
            socket.write("8=FIXT.1.19=25435=W49=realtime56=NMDUFISQ000134=5952=20230104-09:40:37.62442=20230104-09:40:37.00010201=30211500=08055=ASCR8538=T1140=2.57008503=0387=0.008504=0.0000268=2269=xe270=4.570000271=0.001023=0346=0269=xf270=0.570000271=0.001023=0346=010=250");
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
                .setSenderCompID('realtime')
                .setTargetCompID('NMDUFISQ0001')
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add PartyID group (required by PSX)
            message
                .addField('453', '1') // NoPartyIDs = 1
                .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
                .addField('447', 'D') // PartyIDSource = D (custom)
                .addField('452', '3'); // PartyRole = 3 (instead of 2)
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
     * Send a trading session status request for REG market
     */
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
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent trading session status request for REG market (seq: ${msgSeqNum - 1})`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending trading session status request:', error);
            return null;
        }
    };
    /**
     * Send a security list request for REG and FUT markets (EQUITY)
     */
    const sendSecurityListRequestForEquity = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('Cannot send security list request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
                .addField(constants_1.FieldTag.SECURITY_TYPE, 'EQUITY') // Product type EQUITY
                .addField(constants_1.FieldTag.MARKET_ID, 'REG') // Regular market
                .addField(constants_1.FieldTag.MARKET_ID, 'FUT'); // Futures market
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent security list request for REG and FUT markets (EQUITY) (seq: ${msgSeqNum - 1})`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending security list request:', error);
            return null;
        }
    };
    /**
     * Send a security list request for REG market (INDEX)
     */
    const sendSecurityListRequestForIndex = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('Cannot send security list request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
                .addField(constants_1.FieldTag.SECURITY_TYPE, 'INDEX') // Product type INDEX
                .addField(constants_1.FieldTag.MARKET_ID, 'REG'); // Regular market
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent security list request for REG market (INDEX) (seq: ${msgSeqNum - 1})`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending security list request:', error);
            return null;
        }
    };
    /**
     * Send a market data request for index values
     */
    const sendIndexMarketDataRequest = (symbols) => {
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
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types (3 = Index Value)
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1');
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3');
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent market data request for indices: ${symbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    /**
     * Send a market data subscription request for symbol data
     */
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
                .setMsgSeqNum(msgSeqNum++)
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
    // Start index data updates every 20 seconds
    const startIndexUpdates = () => {
        const indexSymbols = ['KSE100', 'KMI30'];
        setInterval(() => {
            sendIndexMarketDataRequest(indexSymbols);
        }, 20000);
    };
    /**
     * Send a logon message to the server
     */
    const sendLogon = () => {
        logger_1.default.info('Sending logon message...');
        if (!connected) {
            logger_1.default.warn('Cannot send logon, not connected');
            return;
        }
        try {
            // Always reset sequence number on logon
            msgSeqNum = 1;
            logger_1.default.info('Resetting sequence number to 1 for new logon');
            const sendingTime = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
            logger_1.default.debug(`Generated SendingTime: ${sendingTime}`);
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGON)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum)
                .addField(constants_1.FieldTag.SENDING_TIME, sendingTime)
                .addField(constants_1.FieldTag.ENCRYPT_METHOD, '0')
                .addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
                .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9')
                .addField('1408', 'FIX5.00_PSX_1.00')
                .addField(constants_1.FieldTag.USERNAME, options.username)
                .addField(constants_1.FieldTag.PASSWORD, options.password)
                .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always request sequence number reset
            const message = builder.buildMessage();
            logger_1.default.info(`Sending Logon Message with sequence number ${msgSeqNum}: ${message.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            sendMessage(message);
            // Don't increment sequence number here - wait for server's response
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
            emitter.emit('logout', {
                message: 'Logged out in to FIX server',
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
    /**
     * Handle a reject message from the server
     */
    const handleReject = (message) => {
        try {
            const refSeqNum = message[constants_1.FieldTag.REF_SEQ_NUM];
            const refTagId = message[constants_1.FieldTag.REF_TAG_ID];
            const text = message[constants_1.FieldTag.TEXT];
            logger_1.default.error(`Received REJECT message for sequence number ${refSeqNum}`);
            logger_1.default.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);
            // If it's a sequence number issue, try to resync
            if (refTagId === '11') { // 11 is the tag for sequence number
                logger_1.default.info('Sequence number mismatch detected, attempting to resync...');
                // Get server's current sequence number
                const serverSeq = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
                msgSeqNum = serverSeq + 1; // Set our next sequence number to be one more than server's
                logger_1.default.info(`Resynced sequence numbers. Server sequence: ${serverSeq}, Next sequence: ${msgSeqNum}`);
            }
            // Emit reject event
            emitter.emit('reject', {
                refSeqNum,
                refTagId,
                text
            });
        }
        catch (error) {
            logger_1.default.error(`Error handling reject message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
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
        stop
    };
    return client;
}
