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
    let logonTimer = null;
    const sequenceManager = new sequence_manager_1.SequenceManager();
    const state = new connection_state_1.ConnectionState();
    const start = () => {
        connect();
    };
    const stop = () => {
        state.setShuttingDown(true);
        sendLogout();
        disconnect();
    };
    const connect = async () => {
        if (socket && state.isConnected()) {
            logger_1.logger.warn('Already connected');
            return;
        }
        const fixPort = parseInt(process.env.FIX_PORT || '7001', 10);
        const fixHost = process.env.FIX_HOST || '127.0.0.1';
        if (isNaN(fixPort) || !fixHost) {
            logger_1.logger.error('Invalid FIX_PORT or FIX_HOST environment variable.');
            emitter.emit('error', new Error('Invalid FIX_PORT or FIX_HOST environment variable.'));
            return;
        }
        try {
            logger_1.logger.info(`Establishing TCP connection to ${fixHost}:${fixPort}`);
            socket = new net_1.Socket();
            socket.setKeepAlive(true, 10000);
            socket.setNoDelay(true);
            socket.setTimeout(options.connectTimeoutMs || 60000);
            socket.connect(fixPort, fixHost);
            socket.on('error', (error) => {
                logger_1.logger.error(`Socket error: ${error.message}`);
            });
            socket.on('timeout', () => {
                logger_1.logger.error('Connection timed out');
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                state.setConnected(false);
            });
            socket.on('close', (hadError) => {
                logger_1.logger.info(`Socket disconnected${hadError ? ' due to error' : ''}`);
                state.reset();
                if (!state.isShuttingDown()) {
                    scheduleReconnect();
                }
            });
            socket.on('connect', () => {
                logger_1.logger.info(`Connected to ${fixHost}:${fixPort}`);
                state.setConnected(true);
                if (logonTimer) {
                    clearTimeout(logonTimer);
                }
                logonTimer = setTimeout(() => {
                    try {
                        logger_1.logger.info('Sending logon message...');
                        sendLogon();
                    }
                    catch (error) {
                        logger_1.logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
                        disconnect();
                    }
                }, 500);
            });
            socket.on('data', (data) => {
                logger_1.logger.info(`[SESSION:DATA] Received data: ${data}`);
                try {
                    // const dataStr = data.toString();
                    // if (dataStr.includes('35=1')) { // Test request
                    //   const testReqIdMatch = dataStr.match(/112=([^\x01]+)/);
                    //   if (testReqIdMatch && testReqIdMatch[1]) {
                    //     sendHeartbeat(testReqIdMatch[1]);
                    //   }
                    // }
                    handleData(data);
                }
                catch (err) {
                    logger_1.logger.error(`Error processing data: ${err}`);
                }
            });
        }
        catch (error) {
            logger_1.logger.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    };
    const disconnect = () => {
        return new Promise((resolve) => {
            clearTimers();
            if (state.isConnected() && state.isLoggedIn()) {
                logger_1.logger.info("[SESSION:LOGOUT] Sending logout message");
                sendLogout();
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
        logger_1.logger.info('Scheduling reconnect in 5 seconds');
        state.setRequestSent('equitySecurities', false);
        state.setRequestSent('indexSecurities', false);
        state.setRequestSent('futSecurities', false);
        reconnectTimer = setTimeout(() => {
            logger_1.logger.info('Attempting to reconnect');
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
            const dataStr = data.toString();
            const messages = dataStr.split(constants_1.SOH);
            let currentMessage = '';
            for (const segment of messages) {
                if (segment.startsWith('8=FIX')) {
                    if (currentMessage) {
                        try {
                            processMessage(currentMessage);
                        }
                        catch (err) {
                            logger_1.logger.error(`Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
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
                }
                catch (err) {
                    logger_1.logger.error(`Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
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
            const channelNoField = segments.find((s) => s.startsWith('10201='));
            const channelNo = channelNoField ? channelNoField.substring(5) : '';
            const parsedMessage = (0, message_parser_1.parseFixMessage)(message);
            if (!parsedMessage) {
                logger_1.logger.warn('Could not parse FIX message');
                return;
            }
            const channelNoStr = channelNo?.replace('=', '');
            if (channelNo && parsedMessage) {
                parsedMessage['channelDescription'] = (0, message_builder_1.getMessageTypeByChannelNo)(channelNoStr);
            }
            // if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
            //   const incomingSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
            //   const msgType = parsedMessage[FieldTag.MSG_TYPE];
            //   const text = parsedMessage[FieldTag.TEXT] || '';
            //   const isSequenceError = Boolean(
            //     text.includes('MsgSeqNum') ||
            //     text.includes('too large') ||
            //     text.includes('sequence')
            //   );
            //   if (
            //     (msgType === MessageType.LOGOUT || msgType === MessageType.REJECT) &&
            //     isSequenceError
            //   ) {
            //     logger.warn(`Received ${msgType} with sequence error: ${text}`);
            //   } else {
            //     sequenceManager.updateServerSequence(incomingSeqNum);
            //   }
            // }
            // //I need message with delimeters
            // const messageWithDelimeters = message.split(SOH).join('\n');
            // logger.info(`[SESSION:MESSAGE] Processing message: ${messageWithDelimeters} `);
            logger_1.logger.info(`[SESSION:MESSAGE] Message type: ${msgType} Message channel: ${channelNoStr} channel description: ${(0, message_builder_1.getMessageTypeByChannelNo)(channelNoStr)}`);
            logger_1.logger.info(`[SESSION:PARSED_MESSAGE]: ${parsedMessage}`);
            logger_1.logger.info(`--------------------------------`);
            switch (msgType) {
                case constants_1.MessageType.LOGON:
                    logger_1.logger.info(`[SESSION:LOGON] Processing logon message from server`);
                    (0, message_handler_1.handleLogon)(parsedMessage, sequenceManager, emitter, { value: false });
                    state.setLoggedIn(true);
                    break;
                case constants_1.MessageType.REJECT:
                    const rejectResult = (0, message_handler_1.handleReject)(parsedMessage);
                    if (rejectResult.isSequenceError) {
                        handleSequenceError(rejectResult.expectedSeqNum);
                    }
                    else {
                        emitter.emit('reject', {
                            reason: rejectResult.rejectReason || ''
                        });
                    }
                    break;
                case constants_1.MessageType.LOGOUT:
                    const logoutResult = (0, message_handler_1.handleLogout)(parsedMessage, emitter, sequenceManager, { value: false }, socket, connect);
                    if (logoutResult.isSequenceError) {
                        handleSequenceError(logoutResult.expectedSeqNum);
                    }
                    else {
                        state.setLoggedIn(false);
                        if (heartbeatTimer) {
                            clearInterval(heartbeatTimer);
                            heartbeatTimer = null;
                        }
                    }
                    break;
                case constants_1.MessageType.MARKET_DATA_REQUEST_REJECT:
                    (0, message_handler_1.handleMarketDataRequestReject)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.NEWS:
                    (0, message_handler_1.handleNews)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.SECURITY_LIST:
                    const securityCache = { EQUITY: [], INDEX: [] };
                    (0, message_handler_1.handleSecurityList)(parsedMessage, emitter, securityCache);
                    break;
                case constants_1.MessageType.TRADING_SESSION_STATUS:
                    (0, message_handler_1.handleTradingSessionStatus)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
                    (0, message_handler_1.handleMarketDataSnapshot)(parsedMessage, emitter);
                    break;
                case constants_1.MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
                    (0, message_handler_1.handleMarketDataIncremental)(parsedMessage, emitter);
                    break;
                default:
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
            logger_1.logger.info(`Server expects sequence number: ${expectedSeqNum}`);
            if (socket) {
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                sequenceManager.forceReset(expectedSeqNum);
                connect();
            }, 2000);
        }
        else {
            logger_1.logger.info('Cannot determine expected sequence number, performing full reset');
            if (socket) {
                socket.destroy();
                socket = null;
            }
            setTimeout(() => {
                sequenceManager.resetAll();
                connect();
            }, 2000);
        }
    };
    const sendLogon = () => {
        if (!state.isConnected()) {
            logger_1.logger.warn('Cannot send logon: not connected');
            return;
        }
        try {
            const builder = (0, message_builder_1.createLogonMessageBuilder)(options);
            const message = builder.buildMessage();
            logger_1.logger.info(`[SESSION:LOGON] Sending logon message: ${message}`);
            sendMessage(message);
        }
        catch (error) {
            logger_1.logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendLogout = (text) => {
        if (!state.isConnected()) {
            logger_1.logger.warn("Cannot send logout, not connected");
            emitter.emit("logout", {
                message: "Logged out from FIX server",
                timestamp: new Date().toISOString(),
            });
            return;
        }
        try {
            const builder = (0, message_builder_1.createLogoutMessageBuilder)(options, sequenceManager, text);
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendHeartbeat = (testReqId) => {
        if (!state.isConnected())
            return;
        try {
            const builder = (0, message_builder_1.createHeartbeatMessageBuilder)(options, sequenceManager, testReqId);
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const sendMessage = (message) => {
        if (!state.isConnected()) {
            logger_1.logger.warn("Cannot send message, not connected");
            return;
        }
        try {
            socket?.write(message);
        }
        catch (error) {
            logger_1.logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            socket?.destroy();
            state.setConnected(false);
        }
    };
    const client = {
        on: (event, listener) => {
            emitter.on(event, listener);
            return client;
        },
        connect,
        disconnect,
        sendLogon,
        sendLogout,
        start,
        stop,
    };
    return client;
}
