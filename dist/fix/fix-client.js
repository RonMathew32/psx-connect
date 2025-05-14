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
    const messageBuilder = (0, message_builder_1.createMessageBuilder)();
    // Centralized state management
    const state = {
        socket: null,
        connected: false,
        loggedIn: false,
        msgSeqNum: 1,
        serverSeqNum: 1,
        lastActivityTime: 0,
        testRequestCount: 0,
        receivedData: '',
        heartbeatTimer: null,
        reconnectTimer: null,
        logonTimer: null,
    };
    /**
     * Reset sequence numbers
     */
    const resetSequenceNumber = (newSeq = 2) => {
        const oldSeq = state.msgSeqNum;
        state.msgSeqNum = newSeq;
        state.serverSeqNum = newSeq - 1;
        logger_1.default.info(`[SEQUENCE] Reset from ${oldSeq} to ${state.msgSeqNum} (server: ${state.serverSeqNum})`);
    };
    /**
     * Clear all timers
     */
    const clearTimers = () => {
        [state.heartbeatTimer, state.reconnectTimer, state.logonTimer].forEach(timer => {
            if (timer)
                clearTimeout(timer);
        });
        state.heartbeatTimer = state.reconnectTimer = state.logonTimer = null;
    };
    /**
     * Send a FIX message
     */
    const sendMessage = (message) => {
        if (!state.socket || !state.connected) {
            logger_1.default.warn('Cannot send message: not connected');
            return;
        }
        try {
            logger_1.default.debug(`Sending FIX message (seq: ${state.msgSeqNum}): ${message.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            state.socket.write(message);
            state.lastActivityTime = Date.now();
        }
        catch (error) {
            logger_1.default.error(`Send error: ${error}`);
            disconnect();
        }
    };
    /**
     * Connect to the FIX server
     */
    const connect = async () => {
        if (state.connected && state.socket) {
            logger_1.default.warn('Already connected');
            return;
        }
        try {
            state.socket = new net_1.Socket()
                .setKeepAlive(true)
                .setNoDelay(true)
                .setTimeout(options.connectTimeoutMs || 30000);
            state.socket.on('connect', () => {
                state.connected = true;
                logger_1.default.info(`Connected to ${options.host}:${options.port}`);
                clearTimers();
                state.logonTimer = setTimeout(() => sendLogon(), 500);
                emitter.emit('connected');
            });
            state.socket.on('data', (data) => handleData(data.toString()));
            state.socket.on('timeout', () => {
                logger_1.default.error('Connection timed out');
                disconnect();
                emitter.emit('error', new Error('Connection timed out'));
            });
            state.socket.on('error', (error) => {
                logger_1.default.error(`Socket error: ${error.message}`);
                emitter.emit('error', error);
            });
            state.socket.on('close', () => {
                logger_1.default.info('Socket disconnected');
                state.connected = false;
                emitter.emit('disconnected');
                scheduleReconnect();
            });
            logger_1.default.info(`Connecting to ${options.host}:${options.port}...`);
            state.socket.connect(options.port, options.host);
        }
        catch (error) {
            logger_1.default.error(`Connection error: ${error}`);
            emitter.emit('error', new Error(`Connection failed: ${error}`));
        }
    };
    /**
     * Disconnect from the server
     */
    const disconnect = async () => {
        clearTimers();
        if (state.connected && state.loggedIn)
            sendLogout();
        if (state.socket) {
            state.socket.destroy();
            state.socket = null;
        }
        state.connected = false;
        state.loggedIn = false;
    };
    /**
     * Schedule reconnection
     */
    const scheduleReconnect = () => {
        clearTimers();
        state.reconnectTimer = setTimeout(() => {
            logger_1.default.info('Reconnecting...');
            connect();
        }, 5000);
    };
    /**
     * Handle incoming data
     */
    const handleData = (data) => {
        try {
            state.lastActivityTime = Date.now();
            state.receivedData += data;
            const messages = state.receivedData.split(constants_1.SOH).reduce((acc, segment) => {
                if (segment.startsWith('8=FIX'))
                    acc.push(segment);
                else if (acc.length)
                    acc[acc.length - 1] += constants_1.SOH + segment;
                return acc;
            }, []);
            state.receivedData = messages.pop() || '';
            messages.forEach(processMessage);
        }
        catch (error) {
            logger_1.default.error(`Data handling error: ${error}`);
        }
    };
    /**
     * Process a FIX message
     */
    const processMessage = (message) => {
        try {
            if (!message.startsWith('8=FIX')) {
                logger_1.default.warn('Non-FIX message received');
                return;
            }
            logger_1.default.info(`Received: ${message.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            const parsed = (0, message_parser_1.parseFixMessage)(message);
            if (!parsed) {
                logger_1.default.warn('Failed to parse FIX message');
                return;
            }
            // Update sequence numbers
            if (parsed[constants_1.FieldTag.MSG_SEQ_NUM]) {
                const seqNum = parseInt(parsed[constants_1.FieldTag.MSG_SEQ_NUM], 10);
                if (!parsed[constants_1.FieldTag.POSS_DUP_FLAG] || parsed[constants_1.FieldTag.POSS_DUP_FLAG] !== 'Y') {
                    state.serverSeqNum = seqNum;
                    state.msgSeqNum = Math.max(state.msgSeqNum, seqNum + 1);
                }
            }
            const msgType = parsed[constants_1.FieldTag.MSG_TYPE];
            const handlers = {
                [constants_1.MessageType.LOGON]: handleLogon,
                [constants_1.MessageType.LOGOUT]: handleLogout,
                [constants_1.MessageType.HEARTBEAT]: () => state.testRequestCount = 0,
                [constants_1.MessageType.TEST_REQUEST]: () => sendHeartbeat(parsed[constants_1.FieldTag.TEST_REQ_ID]),
                [constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH]: handleMarketDataSnapshot,
                [constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH]: handleMarketDataIncremental,
                [constants_1.MessageType.SECURITY_LIST]: handleSecurityList,
                [constants_1.MessageType.TRADING_SESSION_STATUS]: handleTradingSessionStatus,
                ['f']: handleTradingStatus,
                [constants_1.MessageType.REJECT]: handleReject,
                ['Y']: handleMarketDataRequestReject,
            };
            const handler = handlers[msgType] || (() => logger_1.default.info(`Unhandled message type: ${msgType}`));
            handler(parsed);
        }
        catch (error) {
            logger_1.default.error(`Message processing error: ${error}`);
        }
    };
    /**
     * Handle logon response
     */
    const handleLogon = (message) => {
        state.loggedIn = true;
        state.serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
        state.msgSeqNum = message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === 'Y' ? 2 : state.serverSeqNum + 1;
        logger_1.default.info(`Logged in. Server seq: ${state.serverSeqNum}, Next seq: ${state.msgSeqNum}`);
        startHeartbeatMonitoring();
        emitter.emit('logon', message);
    };
    /**
     * Handle logout
     */
    const handleLogout = (message) => {
        const text = message[constants_1.FieldTag.TEXT];
        state.loggedIn = false;
        clearTimers();
        if (text?.match(/MsgSeqNum|too large|sequence/)) {
            const seqMatch = text.match(/expected ['"]?(\d+)['"]?/);
            const newSeq = seqMatch && !isNaN(parseInt(seqMatch[1], 10)) ? parseInt(seqMatch[1], 10) : 1;
            disconnect().then(() => {
                setTimeout(() => {
                    resetSequenceNumber(newSeq);
                    connect();
                }, 2000);
            });
        }
        else {
            emitter.emit('logout', message);
        }
        logger_1.default.info('Logged out');
    };
    /**
     * Handle market data snapshot
     */
    const handleMarketDataSnapshot = (message) => {
        const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
        const symbol = message[constants_1.FieldTag.SYMBOL];
        const items = [];
        const noEntries = parseInt(message[constants_1.FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);
        for (let i = 0; i < noEntries; i++) {
            const entryType = message[`${constants_1.FieldTag.MD_ENTRY_TYPE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_TYPE];
            if (!entryType)
                break;
            items.push({
                symbol: symbol || '',
                entryType,
                price: parseFloat(message[`${constants_1.FieldTag.MD_ENTRY_PX}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_PX] || '0'),
                size: parseFloat(message[`${constants_1.FieldTag.MD_ENTRY_SIZE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_SIZE] || '0'),
                timestamp: message[constants_1.FieldTag.SENDING_TIME],
            });
        }
        logger_1.default.info(`Market data snapshot for ${symbol}: ${items.length} items`);
        emitter.emit('marketData', message);
        if (items.length && (symbol?.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse')) {
            logger_1.default.info(`KSE data for ${symbol}`);
            emitter.emit('kseData', items);
        }
    };
    /**
     * Handle market data incremental refresh
     */
    const handleMarketDataIncremental = (message) => {
        const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
        logger_1.default.info(`Incremental refresh for ${mdReqId}`);
        emitter.emit('marketData', message);
    };
    /**
     * Handle security list
     */
    const handleSecurityList = (message) => {
        const securities = [];
        const noSecurities = parseInt(message[constants_1.FieldTag.NO_RELATED_SYM] || '0', 10);
        // Standard format parsing
        for (let i = 0; i < Math.max(noSecurities, 100); i++) {
            const symbol = message[`${constants_1.FieldTag.SYMBOL}.${i}`] || (i === 0 ? message[constants_1.FieldTag.SYMBOL] : null);
            if (!symbol)
                break;
            securities.push({
                symbol,
                securityType: message[`${constants_1.FieldTag.SECURITY_TYPE}.${i}`] || message[constants_1.FieldTag.SECURITY_TYPE] || '',
                securityDesc: message[`${constants_1.FieldTag.SECURITY_DESC}.${i}`] || message[constants_1.FieldTag.SECURITY_DESC] || '',
                marketId: message[`${constants_1.FieldTag.MARKET_ID}.${i}`] || message[constants_1.FieldTag.MARKET_ID] || '',
            });
        }
        // Alternative parsing if standard fails
        if (!securities.length) {
            Object.entries(message).forEach(([key, value]) => {
                if (key.match(/55\.?|symbol/i) && typeof value === 'string') {
                    securities.push({
                        symbol: value,
                        securityType: message[key.replace('55', '167')] || '',
                        securityDesc: message[key.replace('55', '107')] || '',
                        marketId: message[key.replace('55', '1301')] || '',
                    });
                }
            });
        }
        const uniqueSecurities = [...new Map(securities.map(s => [s.symbol, s])).values()];
        logger_1.default.info(`Extracted ${uniqueSecurities.length} securities`);
        emitter.emit('securityList', uniqueSecurities);
        if (!uniqueSecurities.length && message['893'] !== 'N') {
            setTimeout(() => state.loggedIn && sendSecurityListRequest(), 5000);
        }
    };
    /**
     * Handle trading session status
     */
    const handleTradingSessionStatus = (message) => {
        let sessionId = message[constants_1.FieldTag.TRADING_SESSION_ID] || message['1151'] || message['1300'] || 'REG';
        let status = message[constants_1.FieldTag.TRAD_SES_STATUS] || message['325'] || '2';
        if (sessionId === '05') {
            status = message['102'] || '2'; // PSX-specific mapping
            sessionId = 'REG';
        }
        const sessionInfo = {
            sessionId,
            status,
            startTime: message[constants_1.FieldTag.START_TIME] || message['341'],
            endTime: message[constants_1.FieldTag.END_TIME] || message['342'],
        };
        logger_1.default.info(`Trading session status: ${JSON.stringify(sessionInfo)}`);
        emitter.emit('tradingSessionStatus', sessionInfo);
    };
    /**
     * Handle trading status (PSX-specific)
     */
    const handleTradingStatus = (message) => {
        const symbol = message[constants_1.FieldTag.SYMBOL];
        const status = message['102'];
        const items = [{
                symbol: symbol || '',
                entryType: 'f',
                price: status ? parseFloat(status) : undefined,
                timestamp: message[constants_1.FieldTag.SENDING_TIME],
            }];
        emitter.emit('kseTradingStatus', {
            symbol,
            status,
            timestamp: message[constants_1.FieldTag.SENDING_TIME],
            origTime: message['42'],
        });
        if (symbol?.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse') {
            emitter.emit('kseData', items);
        }
    };
    /**
     * Handle reject message
     */
    const handleReject = (message) => {
        const text = message[constants_1.FieldTag.TEXT];
        if (text?.match(/MsgSeqNum|too large|sequence/)) {
            const seqMatch = text.match(/expected ['"]?(\d+)['"]?/);
            const newSeq = seqMatch && !isNaN(parseInt(seqMatch[1], 10)) ? parseInt(seqMatch[1], 10) : 1;
            disconnect().then(() => {
                setTimeout(() => {
                    resetSequenceNumber(newSeq);
                    connect();
                }, 2000);
            });
        }
        emitter.emit('reject', {
            refSeqNum: message[constants_1.FieldTag.REF_SEQ_NUM],
            refTagId: message[constants_1.FieldTag.REF_TAG_ID],
            text,
            msgType: message[constants_1.FieldTag.MSG_TYPE],
        });
    };
    /**
     * Handle market data request reject
     */
    const handleMarketDataRequestReject = (message) => {
        emitter.emit('marketDataReject', {
            requestId: message[constants_1.FieldTag.MD_REQ_ID],
            reason: message[constants_1.FieldTag.MD_REJECT_REASON],
            text: message[constants_1.FieldTag.TEXT],
        });
    };
    /**
     * Send heartbeat
     */
    const sendHeartbeat = (testReqId) => {
        if (!state.connected)
            return;
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.HEARTBEAT)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++);
        if (testReqId)
            builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
        sendMessage(builder.buildMessage());
    };
    /**
     * Start heartbeat monitoring
     */
    const startHeartbeatMonitoring = () => {
        clearTimers();
        const interval = options.heartbeatIntervalSecs * 1000;
        state.heartbeatTimer = setInterval(() => {
            if (Date.now() - state.lastActivityTime > interval * 2) {
                if (state.testRequestCount++ > 3) {
                    logger_1.default.warn('No test request response, disconnecting');
                    disconnect();
                    return;
                }
                const builder = messageBuilder
                    .setMsgType(constants_1.MessageType.TEST_REQUEST)
                    .setSenderCompID(options.senderCompId)
                    .setTargetCompID(options.targetCompId)
                    .setMsgSeqNum(state.msgSeqNum++)
                    .addField(constants_1.FieldTag.TEST_REQ_ID, `TEST${Date.now()}`);
                sendMessage(builder.buildMessage());
            }
            else {
                sendHeartbeat();
            }
        }, interval);
    };
    /**
     * Send logon
     */
    const sendLogon = () => {
        if (!state.connected)
            return;
        resetSequenceNumber(1);
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.LOGON)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++)
            .addField(constants_1.FieldTag.ENCRYPT_METHOD, '0')
            .addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
            .addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y')
            .addField(constants_1.FieldTag.USERNAME, options.username)
            .addField(constants_1.FieldTag.PASSWORD, options.password)
            .addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9')
            .addField('1408', 'FIX5.00_PSX_1.00');
        sendMessage(builder.buildMessage());
    };
    /**
     * Send logout
     */
    const sendLogout = (text) => {
        if (!state.connected) {
            emitter.emit('logout', { message: 'Logged out', timestamp: new Date().toISOString() });
            return;
        }
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.LOGOUT)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++);
        if (text)
            builder.addField(constants_1.FieldTag.TEXT, text);
        sendMessage(builder.buildMessage());
    };
    /**
     * Send market data request
     */
    const sendMarketDataRequest = (symbols, entryTypes = ['0', '1'], subscriptionType = '1') => {
        if (!state.connected)
            return null;
        const requestId = (0, uuid_1.v4)();
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++)
            .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
            .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
            .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
            .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0')
            .addField('453', '1')
            .addField('448', options.partyId || options.senderCompId)
            .addField('447', 'D')
            .addField('452', '3')
            .addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
        symbols.forEach(symbol => builder.addField(constants_1.FieldTag.SYMBOL, symbol));
        builder.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
        entryTypes.forEach(type => builder.addField(constants_1.FieldTag.MD_ENTRY_TYPE, type));
        sendMessage(builder.buildMessage());
        return requestId;
    };
    /**
     * Send security list request
     */
    const sendSecurityListRequest = (product, sessionId = 'REG') => {
        if (!state.connected || !state.loggedIn)
            return null;
        resetSequenceNumber(2);
        const requestId = (0, uuid_1.v4)();
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++)
            .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
            .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0')
            .addField('55', 'NA')
            .addField('336', sessionId);
        if (product)
            builder.addField('460', product);
        sendMessage(builder.buildMessage());
        return requestId;
    };
    /**
     * Send trading session status request
     */
    const sendTradingSessionStatusRequest = () => {
        if (!state.connected || !state.loggedIn)
            return null;
        const requestId = (0, uuid_1.v4)();
        const builder = messageBuilder
            .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++)
            .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
            .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0')
            .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG');
        sendMessage(builder.buildMessage());
        return requestId;
    };
    /**
     * Send security status request
     */
    const sendSecurityStatusRequest = (symbol) => {
        if (!state.connected)
            return null;
        const requestId = (0, uuid_1.v4)();
        const builder = messageBuilder
            .setMsgType('e')
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(state.msgSeqNum++)
            .addField(constants_1.FieldTag.SECURITY_STATUS_REQ_ID, requestId)
            .addField(constants_1.FieldTag.SYMBOL, symbol)
            .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0');
        sendMessage(builder.buildMessage());
        return requestId;
    };
    /**
     * Send index market data request
     */
    const sendIndexMarketDataRequest = (symbols) => {
        return sendMarketDataRequest(symbols, ['3'], '0');
    };
    /**
     * Send symbol market data subscription
     */
    const sendSymbolMarketDataSubscription = (symbols) => {
        return sendMarketDataRequest(symbols, ['0', '1', '2'], '1');
    };
    /**
     * Client API
     */
    const client = {
        on: (event, listener) => { emitter.on(event, listener); return client; },
        connect,
        disconnect,
        sendMarketDataRequest,
        sendSecurityListRequest: () => sendSecurityListRequest(),
        sendTradingSessionStatusRequest,
        sendSecurityListRequestForEquity: () => sendSecurityListRequest('4'),
        sendSecurityListRequestForIndex: () => {
            const id = sendSecurityListRequest('5');
            if (id)
                setTimeout(() => state.loggedIn && sendIndexMarketDataRequest(['KSE100', 'KMI30']), 5000);
            return id;
        },
        sendIndexMarketDataRequest,
        sendSymbolMarketDataSubscription,
        sendSecurityStatusRequest,
        sendLogon,
        sendLogout,
        start: connect,
        stop: disconnect,
        setSequenceNumber: (seq) => { resetSequenceNumber(seq); return client; },
        reset: () => {
            disconnect().then(() => {
                resetSequenceNumber(1);
                setTimeout(connect, 3000);
            });
            return client;
        },
        requestSecurityList: () => {
            resetSequenceNumber(2);
            const equityId = sendSecurityListRequest('4');
            if (equityId) {
                setTimeout(() => {
                    resetSequenceNumber(2);
                    sendSecurityListRequest('5');
                    setTimeout(() => {
                        state.loggedIn && (sendSecurityListRequest('4') || sendSecurityListRequest('5'));
                    }, 10000);
                }, 5000);
            }
            return client;
        },
    };
    return client;
}
