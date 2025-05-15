"use strict";
/**
 * Example of using the improved PSX FIX client
 *
 * This example demonstrates how to use the improved components:
 * - SequenceManager
 * - SessionManager
 * - SecurityListHandler
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runImprovedClient = runImprovedClient;
const fix_client_1 = require("../fix/fix-client");
const logger_1 = __importDefault(require("../utils/logger"));
// FIX connection parameters for PSX
const fixConfig = {
    host: 'ip-90-0-209-72.ip.secureserver.net',
    port: 9877,
    senderCompId: 'realtime',
    targetCompId: 'NMDUFISQ0001',
    username: 'realtime',
    password: 'realtime',
    heartbeatIntervalSecs: 30,
    connectTimeoutMs: 30000
};
/**
 * Example of using the improved FIX client
 */
async function runImprovedClient() {
    logger_1.default.info('[EXAMPLE] Starting improved PSX FIX client example');
    // Create the FIX client
    const client = (0, fix_client_1.createFixClient)(fixConfig);
    // Track received securities
    const equities = [];
    const indices = [];
    // Set up event handlers
    client.on('connected', () => {
        logger_1.default.info('[EXAMPLE] Connected to FIX server');
    });
    client.on('disconnected', () => {
        logger_1.default.info('[EXAMPLE] Disconnected from FIX server');
    });
    client.on('error', (error) => {
        logger_1.default.error(`[EXAMPLE] Error: ${error.message}`);
    });
    client.on('logon', (message) => {
        logger_1.default.info('[EXAMPLE] Successfully logged in to FIX server');
        // Wait a bit after logon before sending requests
        setTimeout(() => {
            logger_1.default.info('[EXAMPLE] Requesting security lists');
            // Request security lists - this now automatically handles sequence numbers
            client.requestAllSecurities();
        }, 3000);
    });
    client.on('securityList', (securities) => {
        // Determine if these are equities or indices based on productType
        const isIndex = securities.length > 0 &&
            (securities[0].productType === '5' || securities[0].productType === 'INDEX');
        if (isIndex) {
            indices.push(...securities);
            logger_1.default.info(`[EXAMPLE] Received ${securities.length} index securities (total: ${indices.length})`);
        }
        else {
            equities.push(...securities);
            logger_1.default.info(`[EXAMPLE] Received ${securities.length} equity securities (total: ${equities.length})`);
        }
        // Log a sample
        if (securities.length > 0) {
            logger_1.default.info(`[EXAMPLE] Sample security: ${JSON.stringify(securities[0])}`);
        }
    });
    client.on('reject', (rejectInfo) => {
        logger_1.default.error(`[EXAMPLE] Received REJECT: ${JSON.stringify(rejectInfo)}`);
        // Handle sequence number errors
        if (rejectInfo.text && rejectInfo.text.includes('MsgSeqNum')) {
            logger_1.default.info('[EXAMPLE] Sequence number issue detected, resetting connection');
            client.reset();
        }
    });
    // Connect to the server
    logger_1.default.info('[EXAMPLE] Connecting to FIX server...');
    await client.connect();
    // Return a cleanup function
    return async () => {
        logger_1.default.info('[EXAMPLE] Cleaning up...');
        // Print summary
        logger_1.default.info(`[EXAMPLE] Received ${equities.length} equities and ${indices.length} indices`);
        // Disconnect
        await client.disconnect();
        logger_1.default.info('[EXAMPLE] Disconnected from FIX server');
    };
}
// Run the example if this file is executed directly
if (require.main === module) {
    // Create a promise to prevent immediate exit
    const runningPromise = new Promise(async (resolve) => {
        const cleanup = await runImprovedClient();
        // Handle Ctrl+C
        process.on('SIGINT', async () => {
            logger_1.default.info('[EXAMPLE] Received SIGINT, shutting down...');
            await cleanup();
            resolve();
        });
        // Auto-shutdown after 2 minutes
        setTimeout(async () => {
            logger_1.default.info('[EXAMPLE] Auto-shutdown after timeout');
            await cleanup();
            resolve();
        }, 120000);
    });
    // Wait for the promise to resolve before exiting
    runningPromise.then(() => {
        logger_1.default.info('[EXAMPLE] Example completed');
        process.exit(0);
    }).catch(err => {
        logger_1.default.error(`[EXAMPLE] Error: ${err.message}`);
        process.exit(1);
    });
}
