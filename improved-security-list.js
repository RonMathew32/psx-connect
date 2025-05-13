/**
 * Improved test script for PSX security list requests
 * 
 * This script demonstrates the improved security list request handling with
 * proper sequence number management, using the new SequenceManager and
 * SecurityListHandler classes.
 */
const { createFixClient } = require('./dist/fix/fix-client');
const logger = require('./dist/utils/logger').default;

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

// Create the FIX client
const client = createFixClient(fixConfig);

// Track received securities
let receivedEquities = 0;
let receivedIndices = 0;

// Listen for events
client.on('connected', () => {
  logger.info('[IMPROVED] Connected to FIX server');
});

client.on('disconnected', () => {
  logger.info('[IMPROVED] Disconnected from FIX server');
});

client.on('error', (error) => {
  logger.error(`[IMPROVED] Error: ${error.message}`);
});

client.on('logon', (message) => {
  logger.info('[IMPROVED] Successfully logged in to FIX server');
  
  // Wait 3 seconds after login, then request securities
  setTimeout(() => {
    logger.info('[IMPROVED] Starting security list requests');
    requestSecurities();
  }, 3000);
});

client.on('securityList', (securities) => {
  // Check if these are equities or indices
  const type = securities.length > 0 && securities[0].productType === '5' ? 'INDEX' : 'EQUITY';
  
  if (type === 'EQUITY') {
    receivedEquities += securities.length;
    logger.info(`[IMPROVED] Received ${securities.length} EQUITY securities (total: ${receivedEquities})`);
  } else {
    receivedIndices += securities.length;
    logger.info(`[IMPROVED] Received ${securities.length} INDEX securities (total: ${receivedIndices})`);
  }
  
  if (securities.length > 0) {
    // Log the first few securities
    const samplesToLog = Math.min(5, securities.length);
    for (let i = 0; i < samplesToLog; i++) {
      logger.info(`[IMPROVED] Sample ${i+1}: ${JSON.stringify(securities[i])}`);
    }
  }
});

client.on('reject', (rejectInfo) => {
  logger.error(`[IMPROVED] Received REJECT: ${JSON.stringify(rejectInfo)}`);
  
  if (rejectInfo.text && rejectInfo.text.includes('MsgSeqNum') && rejectInfo.text.includes('expected')) {
    logger.info('[IMPROVED] Sequence number error detected, will retry with proper sequence');
    
    // Give it a moment, then try again
    setTimeout(retryWithProperSequence, 2000);
  }
});

// Start the client
logger.info('[IMPROVED] Starting FIX client...');
client.connect();

// Function to request securities using the improved client API
function requestSecurities() {
  // Request equity securities first
  logger.info('[IMPROVED] Requesting equity securities');
  
  // The client's requestSecurityList method now properly manages sequence numbers
  client.requestSecurityList();
}

// Function to retry with proper sequence number handling
function retryWithProperSequence() {
  logger.info('[IMPROVED] Resetting connection and sequence numbers');
  
  // Reset the connection and sequence numbers
  client.reset();
  
  // The reset method will automatically reconnect
  logger.info('[IMPROVED] Reconnection in progress with reset sequence numbers');
}

// Graceful shutdown on CTRL+C
process.on('SIGINT', async () => {
  logger.info('[IMPROVED] Shutting down...');
  await client.disconnect();
  
  logger.info('[IMPROVED] Summary:');
  logger.info(`[IMPROVED] - Received ${receivedEquities} equity securities`);
  logger.info(`[IMPROVED] - Received ${receivedIndices} index securities`);
  
  process.exit(0);
}); 