"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
const ws_1 = require("ws");
const fix_client_1 = require("../fix/fix-client");
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
            fixClient = (0, fix_client_1.createFixClient)(fixConfig);
            setupFixClientListeners();
            fixClient?.start();
            isFixConnected = true;
            logger_1.logger.info('FIX client initialized and connected');
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
        // Market data events
        fixClient.on('marketData', (data) => {
            try {
                // Ensure we have valid parsed data before broadcasting
                if (Array.isArray(data) && data.length > 0) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting market data with ${data.length} entries`);
                    broadcast({ type: 'marketData', data, timestamp: Date.now() });
                }
                else {
                    // Handle raw message case
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting raw market data message`);
                    broadcast({ type: 'marketData', data, timestamp: Date.now() });
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing market data: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        // Trading session status events
        fixClient.on('tradingSessionStatus', (data) => {
            try {
                // Validate and process data before broadcasting
                if (data && data.sessionId) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting trading session status: ${JSON.stringify(data)}`);
                    broadcast({ type: 'tradingSessionStatus', data, timestamp: Date.now() });
                }
                else {
                    logger_1.logger.warn(`[WEBSOCKET] Received invalid trading session data: ${JSON.stringify(data)}`);
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing trading session status: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        // Security list events
        fixClient.on('securityList', (data) => {
            try {
                // Validate and process security list before broadcasting
                if (Array.isArray(data)) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting security list with ${data.length} symbols`);
                    // Categorize securities for better frontend handling
                    const categorizedData = {
                        equities: data.filter(s => s.securityType === 'CS' || s.securityType === '4'),
                        indices: data.filter(s => s.securityType === 'MLEG' || s.securityType === '5'),
                        other: data.filter(s => s.securityType !== 'CS' && s.securityType !== '4' &&
                            s.securityType !== 'MLEG' && s.securityType !== '5')
                    };
                    broadcast({
                        type: 'securityList',
                        data: data,
                        categorized: categorizedData,
                        count: data.length,
                        timestamp: Date.now()
                    });
                }
                else {
                    logger_1.logger.warn(`[WEBSOCKET] Received invalid security list data`);
                    broadcast({ type: 'securityList', data: [], count: 0, timestamp: Date.now() });
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing security list: ${error instanceof Error ? error.message : String(error)}`);
                broadcast({ type: 'securityList', data: [], count: 0, timestamp: Date.now() });
            }
        });
        // Equity security list events
        fixClient.on('equitySecurityList', (data) => {
            try {
                // Validate and process security list before broadcasting
                if (Array.isArray(data)) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting equity security list with ${data.length} symbols`);
                    broadcast({
                        type: 'equitySecurityList',
                        data: data,
                        count: data.length,
                        timestamp: Date.now()
                    });
                }
                else {
                    logger_1.logger.warn(`[WEBSOCKET] Received invalid equity security list data`);
                    broadcast({ type: 'equitySecurityList', data: [], count: 0, timestamp: Date.now() });
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing equity security list: ${error instanceof Error ? error.message : String(error)}`);
                broadcast({ type: 'equitySecurityList', data: [], count: 0, timestamp: Date.now() });
            }
        });
        // Index security list events
        fixClient.on('indexSecurityList', (data) => {
            try {
                // Validate and process security list before broadcasting
                if (Array.isArray(data)) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting index security list with ${data.length} symbols`);
                    broadcast({
                        type: 'indexSecurityList',
                        data: data,
                        count: data.length,
                        timestamp: Date.now()
                    });
                }
                else {
                    logger_1.logger.warn(`[WEBSOCKET] Received invalid index security list data`);
                    broadcast({ type: 'indexSecurityList', data: [], count: 0, timestamp: Date.now() });
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing index security list: ${error instanceof Error ? error.message : String(error)}`);
                broadcast({ type: 'indexSecurityList', data: [], count: 0, timestamp: Date.now() });
            }
        });
        // KSE data events
        fixClient.on('kseData', (data) => {
            try {
                // Validate and process KSE data before broadcasting
                if (Array.isArray(data) && data.length > 0) {
                    logger_1.logger.info(`[WEBSOCKET] Broadcasting KSE data for ${data[0].symbol}`);
                    broadcast({ type: 'kseData', data, timestamp: Date.now() });
                }
                else {
                    logger_1.logger.warn(`[WEBSOCKET] Received empty KSE data`);
                }
            }
            catch (error) {
                logger_1.logger.error(`[WEBSOCKET] Error processing KSE data: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        // Connection events
        fixClient.on('logon', () => {
            try {
                logger_1.logger.info(`[WEBSOCKET] Broadcasting logon event`);
                broadcast({ type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() });
                // After successful login, request security lists with proper sequencing
                // First request equity securities
                setTimeout(() => {
                    logger_1.logger.info(`[WEBSOCKET] Requesting equity security list after logon`);
                    if (fixClient) {
                        fixClient.sendSecurityListRequestForEquity();
                    }
                    // Then request index securities after a delay to allow the first request to complete
                    setTimeout(() => {
                        logger_1.logger.info(`[WEBSOCKET] Requesting index security list after equity list`);
                        if (fixClient) {
                            fixClient.sendSecurityListRequestForIndex();
                        }
                    }, 5000); // 5 second delay between equity and index requests
                }, 2000); // 2 second delay after logon
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
