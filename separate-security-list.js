/**
 * Test script for PSX-connect with separate sequence number handling for security lists
 * 
 * This script demonstrates the use of completely separate sequence number tracking
 * for security list requests, allowing normal FIX messaging to continue with its
 * own sequence number stream while security list requests maintain their own stream.
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
const receivedSecurities = {
  EQUITY: 0,
  INDEX: 0,
  TOTAL: 0
};

// Listen for connection events
client.on('connected', () => {
  logger.info('[SEQUENCE] Connected to FIX server');
});

client.on('disconnected', () => {
  logger.info('[SEQUENCE] Disconnected from FIX server');
});

client.on('error', (error) => {
  logger.error(`[SEQUENCE] Error: ${error.message}`);
});

// Handle logon
client.on('logon', (message) => {
  logger.info('[SEQUENCE] Successfully logged in to FIX server');
  logger.info('[SEQUENCE] Waiting 3 seconds before starting requests...');
  
  // Wait a moment before sending requests
  setTimeout(startRequests, 3000);
});

// Handle security list data
client.on('securityList', (securities) => {
  // Determine type from first security
  let type = 'UNKNOWN';
  if (securities.length > 0) {
    if (securities[0].productType === '5' || securities[0].productType === 'INDEX') {
      type = 'INDEX';
    } else {
      type = 'EQUITY';
    }
  }
  
  receivedSecurities[type] += securities.length;
  receivedSecurities.TOTAL += securities.length;
  
  logger.info(`[SEQUENCE] Received ${securities.length} ${type} securities`);
  logger.info(`[SEQUENCE] Total received: ${receivedSecurities.TOTAL} (${receivedSecurities.EQUITY} equities, ${receivedSecurities.INDEX} indices)`);
  
  // Log a sample of the received securities
  if (securities.length > 0) {
    const sample = securities[0];
    logger.info(`[SEQUENCE] Sample security: ${JSON.stringify(sample)}`);
  }
});

// Handle normal market data in parallel to show separate sequence number handling
client.on('marketData', (data) => {
  logger.info(`[SEQUENCE] Received market data for symbol: ${data.symbol}`);
  // This comes through the normal sequence number stream
});

// Handle rejects (especially sequence number related)
client.on('reject', (rejectInfo) => {
  logger.error(`[SEQUENCE] Received reject: ${JSON.stringify(rejectInfo)}`);
  
  // If this is a sequence number error
  if (rejectInfo.text && rejectInfo.text.includes('MsgSeqNum')) {
    logger.info('[SEQUENCE] Detected sequence number error, will handle appropriately');
    
    // Check if the text identifies which sequence number stream is affected
    if (rejectInfo.text.includes('security list') || rejectInfo.refMsgType === 'x') {
      // This is related to security list sequence
      logger.info('[SEQUENCE] Error in security list sequence stream, resetting those sequence numbers');
      resetSecurityListSequence();
    } else {
      // This is related to the normal sequence numbers
      logger.info('[SEQUENCE] Error in normal sequence stream, resetting connection');
      resetConnection();
    }
  }
});

// Connect to the server
logger.info('[SEQUENCE] Starting connection to FIX server...');
client.connect();

// Start request sequence
function startRequests() {
  logger.info('[SEQUENCE] Starting test sequence with separate sequence number handling');
  
  // First, request security lists (first test)
  logger.info('[SEQUENCE] Step 1: Requesting security lists first - using dedicated sequence numbers');
  requestSecurityLists();
  
  // After a delay, try to request security lists again to show separate sequence numbers
  setTimeout(() => {
    logger.info('[SEQUENCE] Step 2: Requesting security lists again - using dedicated sequence numbers');
    requestSecurityLists();
    
    // Then schedule a market data request to show normal sequence numbers still work
    setTimeout(() => {
      logger.info('[SEQUENCE] Step 3: Sending market data request - using normal sequence numbers');
      requestMarketData();
    }, 10000);
  }, 15000);
}

// Request security lists using the improved handler with separate sequence numbers
function requestSecurityLists() {
  logger.info('[SEQUENCE] Requesting full security lists with dedicated sequence numbers');
  
  // The improved client uses separate sequence numbers for these requests
  client.requestSecurityList();
}

// Request some market data to show normal sequence numbers still work
function requestMarketData() {
  // Just request a few symbols to show normal sequence numbering working in parallel
  const symbols = ['KSE100', 'LUCK', 'OGDC'];
  logger.info(`[SEQUENCE] Requesting market data for symbols: ${symbols.join(', ')}`);
  
  // This will use the normal sequence number stream
  client.sendMarketDataRequest(symbols);
}

// Reset just the security list sequence numbers
function resetSecurityListSequence() {
  logger.info('[SEQUENCE] Resetting security list sequence numbers to 2/1');
  
  // The client should have a way to just reset security list sequences
  client.setSecurityListSequenceNumbers(2, 1);
  
  // Try again after a short delay
  setTimeout(requestSecurityLists, 2000);
}

// Reset the connection entirely (both sequence number streams)
function resetConnection() {
  logger.info('[SEQUENCE] Resetting entire connection and all sequence numbers');
  
  // This resets everything
  client.reset();
  
  // Let it reconnect before we try again
  setTimeout(startRequests, 5000);
}

// Handle Ctrl+C shutdown
process.on('SIGINT', async () => {
  logger.info('[SEQUENCE] Shutting down...');
  
  // Log final statistics
  logger.info('[SEQUENCE] Final security list statistics:');
  logger.info(`[SEQUENCE] - Equities: ${receivedSecurities.EQUITY}`);
  logger.info(`[SEQUENCE] - Indices: ${receivedSecurities.INDEX}`);
  logger.info(`[SEQUENCE] - Total: ${receivedSecurities.TOTAL}`);
  
  // Disconnect properly
  await client.disconnect();
  process.exit(0);
}); 