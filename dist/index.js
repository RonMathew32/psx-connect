"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = __importDefault(require("./utils/logger"));
const fix_client_1 = require("./fix/fix-client");
const constants_1 = require("./fix/constants");
// Load environment variables from .env file if present
dotenv_1.default.config();
// Log startup information
logger_1.default.info('PSX-Connect starting...');
logger_1.default.info(`Node.js version: ${process.version}`);
logger_1.default.info(`Operating system: ${process.platform} ${process.arch}`);
/**
 * Main application function
 */
async function main() {
    try {
        // Configure FIX client with defaults (can be overridden with environment variables)
        const fixOptions = {
            host: process.env.PSX_HOST || '172.21.101.36',
            port: parseInt(process.env.PSX_PORT || '8016', 10),
            senderCompId: process.env.SENDER_COMP_ID || 'realtime',
            targetCompId: process.env.TARGET_COMP_ID || 'NMDUFISQ0001',
            username: process.env.FIX_USERNAME || 'realtime',
            password: process.env.FIX_PASSWORD || 'NMDUFISQ0001',
            heartbeatIntervalSecs: parseInt(process.env.HEARTBEAT_INTERVAL || '30', 10),
            connectTimeoutMs: parseInt(process.env.CONNECT_TIMEOUT || '30000', 10),
            onBehalfOfCompId: process.env.ON_BEHALF_OF_COMP_ID || '600',
            rawDataLength: parseInt(process.env.RAW_DATA_LENGTH || '3', 10),
            rawData: process.env.RAW_DATA || 'kse',
            resetOnLogon: true
        };
        // Create and connect FIX client
        const fixClient = (0, fix_client_1.createFixClient)(fixOptions);
        // Set up event handlers for FIX client
        fixClient.on('connected', () => {
            logger_1.default.info('TCP connection established to PSX server.');
        });
        fixClient.on('logon', () => {
            logger_1.default.info('Successfully logged in to PSX server.');
            // Subscribe to trading session status (REG)
            fixClient.sendTradingSessionStatusRequest('REG');
            // Request security list
            fixClient.sendSecurityListRequest();
            // Subscribe to market data for configured symbols (replace with actual symbol list)
            // You can load symbols from a config file or environment
            const symbols = (process.env.MARKET_FEED_SYMBOLS || 'WAVE,OGDC').split(',');
            fixClient.sendMarketDataRequest(symbols, [constants_1.MDEntryType.TRADE], constants_1.SubscriptionRequestType.SNAPSHOT_PLUS_UPDATES);
            // Send notification about successful connection
            sendLogNotification('PSX connection established and subscriptions sent.');
        });
        // Add handler for KSE data
        fixClient.on('kseData', (marketData) => {
            logger_1.default.info('Received KSE data:');
            marketData.forEach((item) => {
                const entryTypeDesc = item.entryType === '3' ? 'Index Value' :
                    item.entryType === '0' ? 'Bid' :
                        item.entryType === '1' ? 'Offer' :
                            item.entryType === 'f' ? 'Trading Status' :
                                item.entryType;
                logger_1.default.info(`Symbol: ${item.symbol}, Type: ${entryTypeDesc}, Value: ${item.price}`);
            });
            // Send notification with KSE index values
            const kse100Item = marketData.find((item) => item.symbol === 'KSE100' && item.entryType === '3');
            if (kse100Item && kse100Item.price) {
                sendLogNotification(`KSE-100 Index: ${kse100Item.price.toFixed(2)} points`);
            }
        });
        // Add handler for KSE trading status
        fixClient.on('kseTradingStatus', (status) => {
            logger_1.default.info('Received KSE trading status:');
            logger_1.default.info(`Symbol: ${status.symbol}, Status: ${status.status}, Time: ${status.timestamp}`);
            // Map status code to readable description
            const statusDesc = mapTradingStatusCode(status.status);
            // Send notification about trading status
            sendLogNotification(`Trading Status for ${status.symbol}: ${statusDesc}`);
        });
        fixClient.on('message', (message) => {
            // Log the full parsed FIX message
            logger_1.default.info(`Received message: ${JSON.stringify(message)}`);
        });
        fixClient.on('error', (error) => {
            logger_1.default.error(`FIX client error: ${error.message}`);
            // Send notification about error
            sendLogNotification(`PSX connection error: ${error.message}`);
        });
        fixClient.on('disconnected', () => {
            logger_1.default.warn('Disconnected from PSX server.');
            // Send notification about disconnection
            sendLogNotification('PSX connection lost. Attempting to reconnect...');
        });
        // Connect to PSX
        await fixClient.connect();
        // Handle process termination
        process.on('SIGINT', async () => {
            logger_1.default.info('Received SIGINT. Shutting down...');
            await fixClient.disconnect();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.default.info('Received SIGTERM. Shutting down...');
            await fixClient.disconnect();
            process.exit(0);
        });
        // Log successful startup
        logger_1.default.info('PSX-Connect running. Press Ctrl+C to exit.');
    }
    catch (error) {
        logger_1.default.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
/**
 * Send a log notification message
 * This could be modified to send via email, SMS, Slack, etc.
 */
function sendLogNotification(message) {
    logger_1.default.info(`NOTIFICATION: ${message}`);
    // Log to a separate notification log file
    const notificationLogPath = path_1.default.join(process.cwd(), 'logs', 'notifications.log');
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}\n`;
    try {
        fs_1.default.appendFileSync(notificationLogPath, logEntry);
    }
    catch (error) {
        logger_1.default.error(`Failed to write notification to log: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Additional notification methods could be added here (email, SMS, etc.)
}
/**
 * Map trading status code to readable description
 */
function mapTradingStatusCode(code) {
    const statusCodes = {
        '1': 'Trading Halt',
        '2': 'Trading Resume',
        '3': 'Trading Suspension',
        '4': 'Pre-Open',
        '5': 'Open',
        '6': 'Close',
        '7': 'No Change'
    };
    return statusCodes[code] || `Unknown Status (${code})`;
}
// Start the application
main().catch(error => {
    logger_1.default.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
