import dotenv from 'dotenv';
import { createFixClient } from '../fix/fix-client';
import { FixClientOptions, TradingSessionInfo } from '../types';
import logger from '../utils/logger';

// Load environment variables from .env file
dotenv.config();

// Extract required connection details from environment variables
const host = process.env.PSX_HOST || 'localhost';
const port = parseInt(process.env.PSX_PORT || '0', 10);
const senderCompId = process.env.PSX_SENDER_COMP_ID || '';
const targetCompId = process.env.PSX_TARGET_COMP_ID || '';
const username = process.env.PSX_USERNAME || '';
const password = process.env.PSX_PASSWORD || '';

// Check if required environment variables are set
if (!port || !senderCompId || !targetCompId || !username || !password) {
  logger.error('Missing required environment variables. Please check your .env file.');
  logger.error('Required variables: PSX_HOST, PSX_PORT, PSX_SENDER_COMP_ID, PSX_TARGET_COMP_ID, PSX_USERNAME, PSX_PASSWORD');
  process.exit(1);
}

// Create FIX client options
const options: FixClientOptions = {
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
const client = createFixClient(options);

// Set up event handlers
client.on('connected', () => {
  logger.info('Connected to PSX server');
});

client.on('disconnected', () => {
  logger.info('Disconnected from PSX server');
  process.exit(0);
});

client.on('error', (error) => {
  logger.error(`Error: ${error.message}`);
});

// Add raw message handler to see all incoming messages
client.on('rawMessage', (message) => {
  // Check if this is a trading session status message
  if (message['35'] === 'h') { // 35 = MsgType, 'h' = TradingSessionStatus
    logger.info('----------------------------------------');
    logger.info('Raw Trading Session Status Message:');
    
    // Log all fields in the message for debugging
    Object.entries(message).forEach(([tag, value]) => {
      logger.info(`Tag ${tag}: ${value}`);
    });
    
    logger.info('----------------------------------------');
  }
});

// Handle trading session status response
client.on('tradingSessionStatus', (sessionInfo: TradingSessionInfo) => {
  logger.info('Received trading session status:');
  
  // Check if we got undefined values and log them
  if (!sessionInfo.sessionId || !sessionInfo.status) {
    logger.warn('Warning: Received incomplete trading session data:');
    logger.warn(JSON.stringify(sessionInfo, null, 2));
  }
  
  logger.info(`Session ID: ${sessionInfo.sessionId || 'UNDEFINED'}`);
  logger.info(`Status: ${sessionInfo.status || 'UNDEFINED'}`);
  
  if (sessionInfo.startTime) {
    logger.info(`Start Time: ${sessionInfo.startTime}`);
  } else {
    logger.warn('Start Time: UNDEFINED');
  }
  
  if (sessionInfo.endTime) {
    logger.info(`End Time: ${sessionInfo.endTime}`);
  } else {
    logger.warn('End Time: UNDEFINED');
  }
  
  // Map session status code to readable format
  const statusMap: Record<string, string> = {
    '1': 'Halted',
    '2': 'Open',
    '3': 'Closed',
    '4': 'Pre-Open',
    '5': 'Pre-Close',
    '6': 'Request Rejected'
  };
  
  const statusText = sessionInfo.status ? statusMap[sessionInfo.status] || 'Unknown' : 'UNDEFINED';
  logger.info(`Status (decoded): ${statusText}`);
  
  // Exit after receiving trading session status
  setTimeout(() => {
    logger.info('Disconnecting...');
    client.disconnect().then(() => {
      process.exit(0);
    });
  }, 5000);
});

// Add manual request option after a delay if no status is received
setTimeout(() => {
  logger.info('Manually requesting trading session status...');
  const reqId = client.sendTradingSessionStatusRequest();
  if (reqId) {
    logger.info(`Sent manual trading session status request with ID: ${reqId}`);
  } else {
    logger.error('Failed to send manual trading session status request');
  }
}, 10000); // Wait 10 seconds for automatic request, then try manual

// Start the client
logger.info('Starting FIX client...');
client.start();

// Handle termination signals
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down...');
  await client.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  await client.disconnect();
  process.exit(0);
}); 