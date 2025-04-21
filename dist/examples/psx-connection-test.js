"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fix_client_1 = require("../fix/fix-client");
const message_builder_1 = require("../fix/message-builder");
// Load environment variables
dotenv_1.default.config();
// Connection parameters - use realtime/NMDUFISQ0001 credentials for PSX test account
const config = {
    host: process.env.FIX_HOST || '172.21.101.36',
    port: parseInt(process.env.FIX_PORT || '8016'),
    senderCompId: process.env.FIX_SENDER || 'realtime',
    targetCompId: process.env.FIX_TARGET || 'NMDUFISQ0001',
    username: process.env.FIX_USERNAME || 'realtime',
    password: process.env.FIX_PASSWORD || 'NMDUFISQ0001',
    heartbeatIntervalSecs: parseInt(process.env.FIX_HEARTBEAT_INTERVAL || '30')
};
// Print connection information
console.log('PSX FIX Connection Test');
console.log('======================');
console.log(`Host: ${config.host}`);
console.log(`Port: ${config.port}`);
console.log(`Sender ID: ${config.senderCompId}`);
console.log(`Target ID: ${config.targetCompId}`);
console.log(`Username: ${config.username}`);
console.log(`Heartbeat: ${config.heartbeatIntervalSecs} seconds`);
console.log('');
// Generate the exact logon message that will be sent for verification
const logonMessage = message_builder_1.FixMessageBuilder.createLogonMessage(config.senderCompId, config.targetCompId, config.username, config.password, true, // resetSeqNum
config.heartbeatIntervalSecs);
// Display the logon message in human-readable format
console.log('FIX Logon Message that will be sent:');
console.log(logonMessage.replace(/\x01/g, '|'));
console.log('');
let receivedMessages = 0;
let isMarketDataReceived = false;
// Create a FIX client with our configuration
const client = new fix_client_1.FixClient(config);
// Set up event handlers
client.on('connected', () => {
    console.log('✓ Socket connection established');
    console.log('  Sending logon message...');
});
client.on('disconnected', () => {
    console.log('✗ Disconnected from server');
    if (!isMarketDataReceived) {
        console.log('  No market data was received before disconnection');
    }
});
client.on('message', (message) => {
    receivedMessages++;
    console.log(`✓ Received message #${receivedMessages} of type: ${message['35'] || 'Unknown'}`);
});
client.on('logon', (message) => {
    console.log('✓ Logon successful!');
    console.log('  Server accepted our logon message');
    // Request security list to get available symbols
    console.log('  Requesting security list...');
    client.sendSecurityListRequest();
});
client.on('securityList', (securities) => {
    console.log(`✓ Received security list with ${securities.length} securities`);
    if (securities.length > 0) {
        // Take the first 3 symbols to request market data
        const symbols = securities.slice(0, 3).map(s => s.symbol);
        console.log(`  Requesting market data for: ${symbols.join(', ')}`);
        client.sendMarketDataRequest(symbols, ['0', '1', '2'], // Bid, Offer, Trade
        '1', // Snapshot + Updates
        0 // Market depth (full book)
        );
    }
    else {
        console.log('  No securities found. Cannot request market data.');
        cleanup();
    }
});
client.on('marketData', (data) => {
    isMarketDataReceived = true;
    console.log(`✓ Received market data with ${data.length} entries`);
    // Display first 3 entries
    data.slice(0, 3).forEach(item => {
        console.log(`  Symbol: ${item.symbol}, Type: ${item.entryType}, Price: ${item.price}, Size: ${item.size}`);
    });
    // Test passed, clean up after 2 seconds
    console.log('✓ TEST PASSED: Successfully received market data');
    setTimeout(cleanup, 2000);
});
client.on('error', (error) => {
    console.error(`✗ Error: ${error.message}`);
    // On error, attempt to clean up
    setTimeout(cleanup, 1000);
});
// Helper function to gracefully shutdown
function cleanup() {
    console.log('Shutting down...');
    client.stop();
    setTimeout(() => {
        console.log('Test completed.');
        process.exit(0);
    }, 1000);
}
// Handle process termination
process.on('SIGINT', () => {
    console.log('\nTest interrupted. Shutting down...');
    cleanup();
});
// Start the test
console.log('Starting PSX connection test...');
client.start();
