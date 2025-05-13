"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fix_client_1 = require("../fix/fix-client");
const logger_1 = __importDefault(require("../utils/logger"));
// Load environment variables from .env file
dotenv_1.default.config();
// Extract required connection details from environment variables
const host = process.env.PSX_HOST || 'localhost';
const port = parseInt(process.env.PSX_PORT || '0', 10);
const senderCompId = process.env.PSX_SENDER_COMP_ID || '';
const targetCompId = process.env.PSX_TARGET_COMP_ID || '';
const username = process.env.PSX_USERNAME || '';
const password = process.env.PSX_PASSWORD || '';
// Check if required environment variables are set
if (!port || !senderCompId || !targetCompId || !username || !password) {
    logger_1.default.error('Missing required environment variables. Please check your .env file.');
    logger_1.default.error('Required variables: PSX_HOST, PSX_PORT, PSX_SENDER_COMP_ID, PSX_TARGET_COMP_ID, PSX_USERNAME, PSX_PASSWORD');
    process.exit(1);
}
// Create FIX client options
const options = {
    host,
    port,
    senderCompId,
    targetCompId,
    username,
    password,
    heartbeatIntervalSecs: 30,
    connectTimeoutMs: 30000
};
// Create the FIX client
const client = (0, fix_client_1.createFixClient)(options);
// Set up event handlers
client.on('connected', () => {
    logger_1.default.info('Connected to PSX server');
});
client.on('disconnected', () => {
    logger_1.default.info('Disconnected from PSX server');
    process.exit(0);
});
client.on('error', (error) => {
    logger_1.default.error(`Error: ${error.message}`);
});
// Add raw message handler to see all incoming messages
client.on('rawMessage', (message) => {
    // Check if this is a trading session status message
    if (message['35'] === 'h') { // 35 = MsgType, 'h' = TradingSessionStatus
        logger_1.default.info('----------------------------------------');
        logger_1.default.info('Raw Trading Session Status Message:');
        // Log all fields in the message for debugging
        Object.entries(message).forEach(([tag, value]) => {
            logger_1.default.info(`Tag ${tag}: ${value}`);
        });
        logger_1.default.info('----------------------------------------');
    }
});
// Handle trading session status response
client.on('tradingSessionStatus', (sessionInfo) => {
    logger_1.default.info('Received trading session status:');
    // Check if we got undefined values and log them
    if (!sessionInfo.sessionId || !sessionInfo.status) {
        logger_1.default.warn('Warning: Received incomplete trading session data:');
        logger_1.default.warn(JSON.stringify(sessionInfo, null, 2));
    }
    logger_1.default.info(`Session ID: ${sessionInfo.sessionId || 'UNDEFINED'}`);
    logger_1.default.info(`Status: ${sessionInfo.status || 'UNDEFINED'}`);
    if (sessionInfo.startTime) {
        logger_1.default.info(`Start Time: ${sessionInfo.startTime}`);
    }
    else {
        logger_1.default.warn('Start Time: UNDEFINED');
    }
    if (sessionInfo.endTime) {
        logger_1.default.info(`End Time: ${sessionInfo.endTime}`);
    }
    else {
        logger_1.default.warn('End Time: UNDEFINED');
    }
    // Map session status code to readable format
    const statusMap = {
        '1': 'Halted',
        '2': 'Open',
        '3': 'Closed',
        '4': 'Pre-Open',
        '5': 'Pre-Close',
        '6': 'Request Rejected'
    };
    const statusText = sessionInfo.status ? statusMap[sessionInfo.status] || 'Unknown' : 'UNDEFINED';
    logger_1.default.info(`Status (decoded): ${statusText}`);
    // Exit after receiving trading session status
    setTimeout(() => {
        logger_1.default.info('Disconnecting...');
        client.disconnect().then(() => {
            process.exit(0);
        });
    }, 5000);
});
// Add manual request option after a delay if no status is received
setTimeout(() => {
    logger_1.default.info('Manually requesting trading session status...');
    const reqId = client.sendTradingSessionStatusRequest();
    if (reqId) {
        logger_1.default.info(`Sent manual trading session status request with ID: ${reqId}`);
    }
    else {
        logger_1.default.error('Failed to send manual trading session status request');
    }
}, 10000); // Wait 10 seconds for automatic request, then try manual
// Start the client
logger_1.default.info('Starting FIX client...');
client.start();
// Handle termination signals
process.on('SIGINT', async () => {
    logger_1.default.info('Received SIGINT, shutting down...');
    await client.disconnect();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    logger_1.default.info('Received SIGTERM, shutting down...');
    await client.disconnect();
    process.exit(0);
});
