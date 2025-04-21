"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fix_client_1 = require("./fix/fix-client");
const constants_1 = require("./fix/constants");
const logger_1 = __importDefault(require("./utils/logger"));
// Load environment variables
dotenv_1.default.config();
// Fix client configuration
const fixClientConfig = {
    host: process.env.FIX_HOST || '172.21.101.36',
    port: parseInt(process.env.FIX_PORT || '8016'),
    senderCompId: process.env.FIX_SENDER || 'realtime',
    targetCompId: process.env.FIX_TARGET || 'NMDUFISQ0001',
    username: process.env.FIX_USERNAME || 'realtime',
    password: process.env.FIX_PASSWORD || 'NMDUFISQ0001',
    heartbeatIntervalSecs: parseInt(process.env.FIX_HEARTBEAT_INTERVAL || '30')
};
// Create and start the FIX client
const client = new fix_client_1.FixClient(fixClientConfig);
// Set up event handlers
client.on('connected', () => {
    logger_1.default.info('Connected to PSX FIX server');
});
client.on('disconnected', () => {
    logger_1.default.info('Disconnected from PSX FIX server');
});
client.on('logon', () => {
    logger_1.default.info('Successfully logged in to PSX FIX server');
    // Example: Request trading session status
    client.sendTradingSessionStatusRequest();
    // Example: Request security list
    client.sendSecurityListRequest();
    // Example: Request market data for specific symbols
    // Use after you've received security list if you don't know the symbols
    /*
    client.sendMarketDataRequest(
      ['OGDC', 'PPL', 'FFC'], // symbols
      [MDEntryType.BID, MDEntryType.OFFER, MDEntryType.TRADE], // entry types
      SubscriptionRequestType.SNAPSHOT_PLUS_UPDATES, // subscription type
      0 // market depth
    );
    */
});
client.on('error', (error) => {
    logger_1.default.error(`FIX client error: ${error.message}`);
});
client.on('marketData', (data) => {
    logger_1.default.info(`Received market data for ${data.length} entries`);
    data.forEach(item => {
        logger_1.default.info(`Symbol: ${item.symbol}, Type: ${item.entryType}, Price: ${item.price}, Size: ${item.size}`);
    });
});
client.on('securityList', (securities) => {
    logger_1.default.info(`Received security list with ${securities.length} securities`);
    securities.forEach(security => {
        logger_1.default.info(`Symbol: ${security.symbol}, Type: ${security.securityType}, Description: ${security.securityDesc || 'N/A'}`);
    });
    // After receiving securities, request market data for some of them
    if (securities.length > 0) {
        const symbols = securities.slice(0, 5).map(s => s.symbol); // Take first 5 symbols
        client.sendMarketDataRequest(symbols, [constants_1.MDEntryType.BID, constants_1.MDEntryType.OFFER, constants_1.MDEntryType.TRADE], constants_1.SubscriptionRequestType.SNAPSHOT_PLUS_UPDATES, 0);
    }
});
client.on('tradingSessionStatus', (sessionInfo) => {
    logger_1.default.info(`Trading session ${sessionInfo.sessionId} status: ${sessionInfo.status}`);
    if (sessionInfo.startTime) {
        logger_1.default.info(`Start time: ${sessionInfo.startTime}`);
    }
    if (sessionInfo.endTime) {
        logger_1.default.info(`End time: ${sessionInfo.endTime}`);
    }
});
// Handle process termination
process.on('SIGINT', () => {
    logger_1.default.info('Received SIGINT. Shutting down...');
    client.stop();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger_1.default.info('Received SIGTERM. Shutting down...');
    client.stop();
    process.exit(0);
});
// Start the client
logger_1.default.info('Starting PSX FIX client...');
client.start();
