"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./utils/logger");
const websocket_server_1 = require("./utils/websocket-server");
const fix_1 = require("./fix");
const validate_fix_options_1 = require("./utils/validate-fix-options");
const express_1 = __importDefault(require("express"));
const helpers_1 = require("./utils/helpers");
const messages_formatter_1 = require("./utils/messages-formatter");
const cache_1 = require("./utils/cache");
require("./jobs/redisToDbBatch"); // Import the batch processing job
// Load environment variables
dotenv_1.default.config();
// Initialize Redis and Express
const app = (0, express_1.default)();
/**
 * Configuration for the FIX client
 */
const DEFAULT_FIX_CONFIG = {
    host: process.env.PSX_HOST || '127.0.0.1',
    port: parseInt(process.env.PSX_PORT || '7001', 10),
    senderCompId: process.env.SENDER_COMP_ID || 'realtime',
    targetCompId: process.env.TARGET_COMP_ID || 'NMDUFISQ0001',
    username: process.env.FIX_USERNAME || 'realtime',
    password: process.env.FIX_PASSWORD || 'NMDUFISQ0001',
    heartbeatIntervalSecs: parseInt(process.env.HEARTBEAT_INTERVAL || '30', 10),
    connectTimeoutMs: parseInt(process.env.CONNECT_TIMEOUT || '30000', 10),
    onBehalfOfCompId: process.env.ON_BEHALF_OF_COMP_ID || '600',
    rawDataLength: parseInt(process.env.RAW_DATA_LENGTH || '3', 10),
    rawData: process.env.RAW_DATA || 'kse',
    resetOnLogon: true,
};
/**
 * Initialize the WebSocket server
 * @returns WebSocket server instance
 */
function initializeWebSocketServer() {
    return (0, websocket_server_1.createWebSocketServer)(8080);
}
/**
 * Initialize the FIX client with the provided options
 * @param options FIX client configuration
 * @param wss WebSocket server instance
 * @returns FIX client instance
 */
function initializeFixClient(options, wss) {
    (0, validate_fix_options_1.validateFixOptions)(options);
    const fixClient = (0, fix_1.createFixClient)(options);
    // Set up FIX client event listeners
    fixClient.on('connected', () => {
        logger_1.logger.info('TCP connection established to PSX server.');
    });
    fixClient.on('logon', () => {
        logger_1.logger.info('Successfully logged in to PSX server.');
    });
    fixClient.on('message', (message) => {
        logger_1.logger.info(`Received FIX message: ${JSON.stringify(message)}`);
    });
    fixClient.on('error', (error) => {
        logger_1.logger.error(`FIX client error: ${error.message}`);
    });
    fixClient.on('disconnected', () => {
        logger_1.logger.warn('Disconnected from PSX server.');
        wss.clients.forEach((client) => {
            if (client.readyState === 1 /* WebSocket.OPEN */) {
                client.send(JSON.stringify({ type: "psx_disconnected" }));
            }
        });
    });
    return fixClient;
}
// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'PSX-Connect API is running.' });
});
// Express API endpoint for latest data by channel number
app.get("/api/latest-data/:channelNo", async (req, res) => {
    const { channelNo } = req.params;
    logger_1.logger.info(`[API] Fetching latest data for channelNo: ${channelNo}`);
    const isChannelValid = (0, helpers_1.getMessageTypeByChannelNo)(channelNo);
    if (isChannelValid === "Unknown Message Type") {
        logger_1.logger.warn(`[API] Invalid channelNo received: ${channelNo}`);
        res.status(400).json({ error: "Invalid channelNo." });
        return;
    }
    try {
        const data = await cache_1.redisClient.hgetall(`fix-latest:${channelNo}`);
        if (data && Object.keys(data).length > 0) {
            let messages = Object.values(data).map(msg => JSON.parse(msg));
            logger_1.logger.info(`[API] Returning ${messages.length} messages for channelNo: ${channelNo}`);
            const formattedMessages = (0, messages_formatter_1.formatMessages)(messages);
            res.json(formattedMessages);
        }
        else {
            logger_1.logger.info(`[API] No data found for channelNo: ${channelNo}`);
            res.status(404).json({ error: "No data found for the specified channelNo." });
        }
    }
    catch (err) {
        logger_1.logger.error(`[API] Internal server error for channelNo ${channelNo}: ${err}`);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Start Express server
const EXPRESS_PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3000;
app.listen(EXPRESS_PORT, () => {
    logger_1.logger.info(`API server listening on port ${EXPRESS_PORT}`);
});
/**
 * Set up process signal handlers for graceful shutdown
 * @param fixClient FIX client instance
 * @param wss WebSocket server instance
 */
function setupSignalHandlers(fixClient, wss) {
    const shutdown = async (signal) => {
        logger_1.logger.info(`Received ${signal}. Shutting down...`);
        try {
            await fixClient.disconnect();
            wss.close();
            logger_1.logger.info('Shutdown completed successfully.');
            process.exit(0);
        }
        catch (error) {
            logger_1.logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}
/**
 * Main application entry point
 */
async function main() {
    try {
        logger_1.logger.info('PSX-Connect starting...');
        logger_1.logger.info(`Node.js version: ${process.version}`);
        logger_1.logger.info(`Operating system: ${process.platform} ${process.arch}`);
        // Initialize WebSocket server
        const wss = initializeWebSocketServer();
        // Initialize FIX client
        const fixClient = initializeFixClient(DEFAULT_FIX_CONFIG, wss);
        // Set up signal handlers for graceful shutdown
        setupSignalHandlers(fixClient, wss);
        // Connect to the FIX server
        await fixClient.connect();
        logger_1.logger.info('PSX-Connect running. Press Ctrl+C to exit.');
    }
    catch (error) {
        logger_1.logger.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Start the application
main().catch((error) => {
    logger_1.logger.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
