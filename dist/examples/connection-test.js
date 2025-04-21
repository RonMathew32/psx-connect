"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fix_client_1 = require("../fix/fix-client");
// Load environment variables
dotenv_1.default.config();
// Configuration
const config = {
    host: process.env.FIX_HOST || '172.21.101.36',
    port: parseInt(process.env.FIX_PORT || '8016'),
    senderCompId: process.env.FIX_SENDER || 'realtime',
    targetCompId: process.env.FIX_TARGET || 'NMDUFISQ0001',
    username: process.env.FIX_SENDER || 'realtime',
    password: process.env.FIX_TARGET || 'NMDUFISQ0001',
    heartbeatIntervalSecs: parseInt(process.env.FIX_HEARTBEAT_INTERVAL || '30')
};
console.log('PSX Connection Test');
console.log('==================');
console.log(`Host: ${config.host}`);
console.log(`Port: ${config.port}`);
console.log(`SenderCompID: ${config.senderCompId}`);
console.log(`TargetCompID: ${config.targetCompId}`);
console.log(`Username: ${config.username}`);
console.log('');
// Create FIX client
const client = new fix_client_1.FixClient(config);
// Set up event handlers
client.on('connected', () => {
    console.log('✓ Connected to PSX FIX server');
});
client.on('disconnected', () => {
    console.log('✗ Disconnected from PSX FIX server');
});
client.on('logon', () => {
    console.log('✓ Successfully logged in');
    console.log('✓ Connection test passed!');
    // Wait a moment before exiting
    setTimeout(() => {
        console.log('Shutting down...');
        client.stop();
        // Give some time for the logout message to be sent
        setTimeout(() => {
            console.log('Test completed.');
            process.exit(0);
        }, 500);
    }, 2000);
});
client.on('error', (error) => {
    console.error(`✗ Error: ${error.message}`);
});
// Handle process termination
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down...');
    client.stop();
    process.exit(0);
});
// Start the client
console.log('Connecting to PSX...');
client.start();
