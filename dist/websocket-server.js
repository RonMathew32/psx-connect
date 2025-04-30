"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
const ws_1 = require("ws");
const fix_client_1 = require("./fix/fix-client");
const logger_1 = __importDefault(require("./utils/logger"));
function createWebSocketServer(port) {
    const wss = new ws_1.WebSocketServer({ port });
    const clients = new Set();
    let fixClient = null;
    // Initialize FIX client
    const initFixClient = () => {
        fixClient = (0, fix_client_1.createFixClient)({
            host: '172.21.101.36',
            port: 8016,
            senderCompId: 'realtime',
            targetCompId: 'NMDUFISQ0001',
            username: 'realtime',
            password: 'NMDUFISQ0001',
            heartbeatIntervalSecs: 30,
            resetOnLogon: true
        });
        // Handle market data events
        fixClient?.on('marketData', (data) => {
            // Broadcast to all connected clients
            broadcastToClients({
                type: 'marketData',
                data
            });
        });
        // Handle KSE data events
        fixClient?.on('kseData', (data) => {
            // Broadcast to all connected clients
            broadcastToClients({
                type: 'kseData',
                data
            });
        });
        // Start the FIX client
        fixClient?.start();
    };
    // Broadcast data to all connected clients
    const broadcastToClients = (data) => {
        const message = JSON.stringify(data);
        clients.forEach(client => {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(message);
            }
        });
    };
    wss.on('connection', (ws) => {
        logger_1.default.info('New WebSocket client connected');
        clients.add(ws);
        // Send initial data if available
        if (fixClient) {
            // You can send any initial data here
        }
        ws.on('close', () => {
            logger_1.default.info('WebSocket client disconnected');
            clients.delete(ws);
        });
        ws.on('error', (error) => {
            logger_1.default.error(`WebSocket error: ${error}`);
        });
    });
    // Initialize FIX client when server starts
    initFixClient();
    logger_1.default.info(`WebSocket server started on port ${port}`);
    return {
        close: () => {
            wss.close();
            if (fixClient) {
                fixClient.stop();
            }
        }
    };
}
