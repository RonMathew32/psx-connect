/**
 * Test script for sending a security list request with a specific sequence number
 */
const { createFixClient } = require('./dist/fix/fix-client');
const logger = require('./dist/utils/logger').default;

// FIX connection parameters - adjust as needed for your environment
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

// Create the FIX client
const client = createFixClient(fixConfig);

// Flag to track if we've already set sequence number
let sequenceSet = false;

// Listen for events
client.on('connected', () => {
  logger.info('[TEST] Connected to FIX server');
});

client.on('disconnected', () => {
  logger.info('[TEST] Disconnected from FIX server');
});

client.on('error', (error) => {
  logger.error(`[TEST] Error: ${error.message}`);
});

client.on('logon', (message) => {
  logger.info('[TEST] Successfully logged in to FIX server');
  
  // Wait 3 seconds after login, then set sequence number and send request
  setTimeout(() => {
    if (!sequenceSet) {
      // CRITICAL: Directly set the sequence number to 2 
      client.setSequenceNumber(2);
      logger.info('[TEST] Sequence number manually set to 2');
      sequenceSet = true;
      
      // Now send the security list request
      const requestId = client.sendSecurityListRequestForEquity();
      logger.info(`[TEST] Security list request sent with ID: ${requestId}`);
      
      // Wait 10 seconds, then try index securities
      setTimeout(() => {
        // CRITICAL: Set sequence number to 2 again
        client.setSequenceNumber(2);
        logger.info('[TEST] Sequence number reset to 2 for index request');
        
        const indexRequestId = client.sendSecurityListRequestForIndex();
        logger.info(`[TEST] Index securities request sent with ID: ${indexRequestId}`);
      }, 10000);
    }
  }, 3000);
});

client.on('securityList', (securities) => {
  logger.info(`[TEST] Received security list with ${securities.length} securities`);
  if (securities.length > 0) {
    // Log the first few securities
    const samplesToLog = Math.min(5, securities.length);
    for (let i = 0; i < samplesToLog; i++) {
      logger.info(`[TEST] Sample ${i+1}: ${JSON.stringify(securities[i])}`);
    }
  }
});

client.on('reject', (rejectInfo) => {
  logger.error(`[TEST] Received REJECT: ${JSON.stringify(rejectInfo)}`);
  
  if (rejectInfo.text && rejectInfo.text.includes('MsgSeqNum') && rejectInfo.text.includes('expected')) {
    logger.info('[TEST] Sequence number error detected, resetting connection');
    
    // Give it a moment, then reset and try again
    setTimeout(() => {
      client.reset();
    }, 2000);
  }
});

// Start the client
logger.info('[TEST] Starting FIX client...');
client.connect();

// Graceful shutdown on CTRL+C
process.on('SIGINT', async () => {
  logger.info('[TEST] Shutting down...');
  await client.disconnect();
  process.exit(0);
}); 