"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = __importDefault(require("./utils/logger"));
const websocket_server_1 = require("./websocket-server");
const fix_client_refactored_1 = require("./fix/fix-client-refactored");
dotenv_1.default.config();
logger_1.default.info('PSX-Connect starting...');
logger_1.default.info(`Node.js version: ${process.version}`);
logger_1.default.info(`Operating system: ${process.platform} ${process.arch}`);
async function main() {
    try {
        const wss = (0, websocket_server_1.createWebSocketServer)(8080);
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
        const fixClient = (0, fix_client_refactored_1.createFixClient)(fixOptions);
        fixClient.on('connected', () => {
            logger_1.default.info('TCP connection established to PSX server.');
        });
        fixClient.on('logon', () => {
            logger_1.default.info('Successfully logged in to PSX server.');
        });
        fixClient.on('message', (message) => {
            logger_1.default.info(`Received message: ${(message)}`);
        });
        fixClient.on('error', (error) => {
            logger_1.default.error(`FIX client error: ${error.message}`);
        });
        fixClient.on('disconnected', () => {
            logger_1.default.warn('Disconnected from PSX server.');
        });
        await fixClient.connect();
        process.on('SIGINT', async () => {
            logger_1.default.info('Received SIGINT. Shutting down...');
            await fixClient.disconnect();
            wss.close();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.default.info('Received SIGTERM. Shutting down...');
            await fixClient.disconnect();
            wss.close();
            process.exit(0);
        });
        logger_1.default.info('PSX-Connect running. Press Ctrl+C to exit.');
    }
    catch (error) {
        logger_1.default.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
main().catch(error => {
    logger_1.default.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
