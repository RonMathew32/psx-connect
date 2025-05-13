"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
const ws_1 = require("ws");
const fix_client_1 = require("./fix/fix-client");
const logger_1 = __importDefault(require("./utils/logger"));
function createWebSocketServer(port, fixConfig = {
    host: '172.21.101.36',
    port: 8016,
    senderCompId: 'realtime',
    targetCompId: 'NMDUFISQ0001',
    username: 'realtime',
    password: 'NMDUFISQ0001',
    heartbeatIntervalSecs: 30,
    resetOnLogon: true
}) {
    const wss = new ws_1.WebSocketServer({
        port,
        perMessageDeflate: false,
        clientTracking: true
    });
    const clients = new Set();
    let fixClient = null;
    let isFixConnected = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectInterval = 5000;
    const broadcast = (message) => {
        try {
            if (!message.type) {
                logger_1.default.warn('Skipping broadcast: Message missing type');
                return;
            }
            const messageStr = JSON.stringify(message);
            if (message.type === 'tradingSessionStatus') {
                logger_1.default.info(`Broadcasting trading session status: ${messageStr}`);
            }
            logger_1.default.debug(`Broadcasting to ${clients.size} clients: ${messageStr}`);
            clients.forEach((client) => {
                if (client.readyState === ws_1.WebSocket.OPEN) {
                    client.send(messageStr);
                }
                else {
                    logger_1.default.debug('Removing closed client');
                    clients.delete(client);
                }
            });
        }
        catch (error) {
            logger_1.default.error(`Broadcast failed: ${error}`);
            broadcastError(`Broadcast failed: ${error}`);
        }
    };
    const broadcastError = (errorMessage) => {
        broadcast({ type: 'error', message: errorMessage, timestamp: Date.now() });
    };
    const initializeFixClient = () => {
        try {
            fixClient = (0, fix_client_1.createFixClient)(fixConfig);
            setupFixClientListeners();
            fixClient.start();
            isFixConnected = true;
            reconnectAttempts = 0;
            logger_1.default.info('FIX client initialized and connected successfully');
            broadcast({ type: 'status', connected: true, timestamp: Date.now() });
            // Schedule regular security list updates - fetch every 30 minutes
            // This ensures frontend always has the latest security list data
            const securityListInterval = 30 * 60 * 1000; // 30 minutes
            logger_1.default.info(`Setting up automatic security list updates every ${securityListInterval / 60000} minutes`);
            // Request initially after 10 seconds to ensure connection is stable
            setTimeout(() => {
                if (fixClient && isFixConnected) {
                    logger_1.default.info('Performing initial security list request after startup');
                    fixClient.requestSecurityList();
                }
            }, 10000);
            // Then set up recurring requests
            setInterval(() => {
                if (fixClient && isFixConnected) {
                    logger_1.default.info('Performing scheduled security list request');
                    fixClient.requestSecurityList();
                }
            }, securityListInterval);
        }
        catch (error) {
            logger_1.default.error(`FIX client initialization failed: ${error}`);
            isFixConnected = false;
            broadcastError(`FIX client initialization failed: ${error}`);
            scheduleReconnect();
        }
    };
    const scheduleReconnect = () => {
        if (reconnectAttempts >= maxReconnectAttempts) {
            logger_1.default.error('Max reconnect attempts reached for FIX client');
            broadcastError('Max reconnect attempts reached for FIX client');
            return;
        }
        reconnectAttempts++;
        logger_1.default.info(`Scheduling FIX client reconnect attempt ${reconnectAttempts} in ${reconnectInterval}ms`);
        setTimeout(() => {
            if (fixClient) {
                fixClient.stop();
            }
            initializeFixClient();
        }, reconnectInterval);
    };
    const setupFixClientListeners = () => {
        if (!fixClient)
            return;
        const events = {
            rawMessage: (data) => {
                return { type: 'rawMessage', data, timestamp: Date.now() };
            },
            marketData: (data) => {
                return { type: 'marketData', data, timestamp: Date.now() };
            },
            tradingSessionStatus: (data) => {
                return { type: 'tradingSessionStatus', data, timestamp: Date.now() };
            },
            securityList: (data) => {
                return { type: 'securityList', data, timestamp: Date.now() };
            },
            kseData: (data) => {
                return { type: 'kseData', data, timestamp: Date.now() };
            },
            logon: (data) => {
                logger_1.default.debug(`Transforming logon: ${JSON.stringify(data)}`);
                return { type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() };
            },
            logout: (data) => {
                logger_1.default.debug(`Transforming logout: ${JSON.stringify(data)}`);
                return { type: 'logout', message: 'Logged out from FIX server', timestamp: Date.now() };
            }
        };
        Object.entries(events).forEach(([event, transformer]) => {
            fixClient.on(event, (data) => {
                try {
                    const message = transformer(data);
                    logger_1.default.info(`Broadcasting ${event} event: ${JSON.stringify(message)}`);
                    broadcast(message);
                }
                catch (error) {
                    logger_1.default.error(`Error processing ${event}: ${error}`);
                    broadcastError(`Error processing ${event}: ${error}`);
                }
            });
        });
        fixClient.on('error', (error) => {
            logger_1.default.error(`FIX client error: ${error.message}`);
            isFixConnected = false;
            broadcastError(`FIX client error: ${error.message}`);
            scheduleReconnect();
        });
        fixClient.on('disconnected', () => {
            logger_1.default.warn('FIX client disconnected');
            isFixConnected = false;
            broadcast({ type: 'status', connected: false, timestamp: Date.now() });
            scheduleReconnect();
        });
    };
    wss.on('connection', (ws) => {
        logger_1.default.info('New WebSocket client connected');
        clients.add(ws);
        // Send initial connection status
        ws.send(JSON.stringify({
            type: 'status',
            connected: isFixConnected,
            timestamp: Date.now()
        }));
        // Handle incoming messages from clients
        ws.on('message', (message) => {
            try {
                const parsedMessage = JSON.parse(message);
                logger_1.default.info(`Received message from client: ${JSON.stringify(parsedMessage)}`);
                // Handle different message types
                switch (parsedMessage.type) {
                    case 'requestSecurityList':
                        // Client is requesting security list data
                        logger_1.default.info('Client requested security list data');
                        if (fixClient && isFixConnected) {
                            // Request security list data
                            logger_1.default.info('Requesting security list data from FIX server');
                            fixClient.requestSecurityList();
                            // Acknowledge the request
                            ws.send(JSON.stringify({
                                type: 'requestAcknowledged',
                                message: 'Security list request sent to server',
                                requestType: 'securityList',
                                timestamp: Date.now()
                            }));
                        }
                        else {
                            // FIX client is not connected
                            logger_1.default.warn('Cannot request security list data: FIX client not connected');
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'Cannot request security list data: FIX server not connected',
                                timestamp: Date.now()
                            }));
                        }
                        break;
                    case 'ping':
                        // Simple ping request
                        ws.send(JSON.stringify({
                            type: 'pong',
                            timestamp: Date.now()
                        }));
                        break;
                    default:
                        logger_1.default.warn(`Unhandled message type: ${parsedMessage.type}`);
                }
            }
            catch (error) {
                logger_1.default.error(`Error processing client message: ${error}`);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Server could not process your request: ${error}`,
                    timestamp: Date.now()
                }));
            }
        });
        ws.on('close', () => {
            logger_1.default.info('WebSocket client disconnected');
            clients.delete(ws);
        });
        ws.on('error', (error) => {
            logger_1.default.error(`WebSocket client error: ${error}`);
            clients.delete(ws);
        });
    });
    wss.on('error', (error) => {
        logger_1.default.error(`WebSocket server error: ${error}`);
        broadcastError(`WebSocket server error: ${error}`);
    });
    initializeFixClient();
    logger_1.default.info(`WebSocket server started on port ${port}`);
    return {
        close: () => {
            try {
                clients.forEach((client) => client.close());
                clients.clear();
                wss.close();
                if (fixClient) {
                    fixClient.stop();
                    fixClient = null;
                }
                logger_1.default.info('WebSocket server closed successfully');
            }
            catch (error) {
                logger_1.default.error(`Error closing WebSocket server: ${error}`);
            }
        },
        getClientCount: () => clients.size,
        isFixConnected: () => isFixConnected,
        emitToClients: (message) => {
            broadcast(message);
        },
        requestImmediateSecurityList: () => {
            if (fixClient && isFixConnected) {
                logger_1.default.info('Manually triggered immediate security list request');
                fixClient.requestSecurityList();
                broadcast({
                    type: 'requestAcknowledged',
                    message: 'Manual security list request initiated',
                    requestType: 'securityList',
                    timestamp: Date.now()
                });
                return true;
            }
            else {
                logger_1.default.warn('Cannot perform manual security list request - not connected');
                return false;
            }
        }
    };
}
