"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./utils/logger");
const websocket_server_1 = require("./utils/websocket-server");
const fix_client_1 = require("./fix/fix-client");
const validate_fix_options_1 = require("./utils/validate-fix-options");
// Load environment variables
dotenv_1.default.config();
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
 * @returns FIX client instance
 */
function initializeFixClient(options) {
    (0, validate_fix_options_1.validateFixOptions)(options);
    const fixClient = (0, fix_client_1.createFixClient)(options);
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
    });
    return fixClient;
}
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
        const fixClient = initializeFixClient(DEFAULT_FIX_CONFIG);
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
