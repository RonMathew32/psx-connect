"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
const ws_1 = require("ws");
const fix_1 = require("../fix");
const logger_1 = require("./logger");
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
    // Simple function to broadcast messages to all connected clients
    const broadcast = (message) => {
        try {
            const messageStr = JSON.stringify(message);
            logger_1.logger.debug(`Broadcasting to ${clients.size} clients: ${messageStr}`);
            clients.forEach((client) => {
                if (client.readyState === ws_1.WebSocket.OPEN) {
                    client.send(messageStr);
                }
                else {
                    clients.delete(client);
                }
            });
        }
        catch (error) {
            logger_1.logger.error(`Broadcast failed: ${error}`);
        }
    };
    // Initialize the FIX client
    const initializeFixClient = () => {
        try {
            fixClient = (0, fix_1.createFixClient)(fixConfig);
            setupFixClientListeners();
            fixClient?.start();
            isFixConnected = true;
            // logger.info('FIX client initialized and connected');
            broadcast({ type: 'status', connected: true, timestamp: Date.now() });
        }
        catch (error) {
            logger_1.logger.error(`FIX client initialization failed: ${error}`);
            isFixConnected = false;
            broadcast({ type: 'error', message: `FIX client initialization failed: ${error}`, timestamp: Date.now() });
        }
    };
    // Set up event listeners for the FIX client
    const setupFixClientListeners = () => {
        if (!fixClient)
            return;
        fixClient.on('realtime', (data) => {
            try {
                if (Array.isArray(data) && data.length > 0) {
                    logger_1.logger.info('[WEBSOCKET] Emitting realtime data');
                    broadcast({ type: 'realtime', data, timestamp: Date.now() });
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing market data: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        // Connection events
        fixClient.on('logon', () => {
            try {
                logger_1.logger.info(`[WEBSOCKET] Broadcasting logon event`);
                broadcast({ type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() });
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error handling logon event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        fixClient.on('logout', () => {
            broadcast({ type: 'logout', message: 'Logged out from FIX server', timestamp: Date.now() });
        });
        fixClient.on('error', (error) => {
            logger_1.logger.error(`FIX client error: ${error.message}`);
            isFixConnected = false;
            broadcast({ type: 'error', message: `FIX client error: ${error.message}`, timestamp: Date.now() });
        });
        fixClient.on('disconnected', () => {
            logger_1.logger.warn('FIX client disconnected');
            isFixConnected = false;
            broadcast({ type: 'status', connected: false, timestamp: Date.now() });
        });
    };
    // Handle WebSocket connections
    wss.on('connection', (ws) => {
        logger_1.logger.info('New WebSocket client connected');
        clients.add(ws);
        // Send initial connection status
        ws.send(JSON.stringify({
            type: 'status',
            connected: isFixConnected,
            timestamp: Date.now()
        }));
        // Handle client disconnection
        ws.on('close', () => {
            logger_1.logger.info('WebSocket client disconnected');
            clients.delete(ws);
        });
        ws.on('error', () => {
            clients.delete(ws);
        });
    });
    // Start the FIX client
    initializeFixClient();
    logger_1.logger.info(`WebSocket server started on port ${port}`);
    return {
        close: () => {
            clients.forEach((client) => client.close());
            clients.clear();
            wss.close();
            if (fixClient) {
                fixClient.stop();
            }
            logger_1.logger.info('WebSocket server closed');
        },
        isFixConnected: () => isFixConnected
    };
}
