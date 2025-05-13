import dotenv from 'dotenv';
import { createFixClient } from '../fix/fix-client';
import { FixClientOptions, TradingSessionInfo } from '../types';
import logger from '../utils/logger';
import { FieldTag } from '../fix/constants';

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

// Track if we've received a trading session status
let tradingSessionReceived = false;

// Set up event handlers
client.on('connected', () => {
  logger.info('Connected to PSX server');
});

client.on('disconnected', () => {
  logger.info('Disconnected from PSX server');
  
  // If we never received a trading session status, log an error
  if (!tradingSessionReceived) {
    logger.error('Never received a trading session status response');
  }
  process.exit(0);
});

client.on('error', (error) => {
  logger.error(`Error: ${error.message}`);
});

// Handle ALL incoming messages to check for trading status messages
client.on('message', (message) => {
  // Check if this is a trading session status message (MsgType 'h')
  if (message[FieldTag.MSG_TYPE] === 'h') {
    logger.info('----------------------------------------');
    logger.info('Received a Trading Session Status Message (h)');
    logger.info('Complete message details:');
    
    // Log all fields with their names if possible
    const fieldNames: Record<string, string> = {
      '8': 'BeginString',
      '9': 'BodyLength',
      '35': 'MsgType',
      '49': 'SenderCompID',
      '56': 'TargetCompID',
      '34': 'MsgSeqNum',
      '52': 'SendingTime',
      '336': 'TradingSessionID',
      '340': 'TradSesStatus',
      '341': 'TradSesStartTime',
      '342': 'TradSesEndTime',
      '58': 'Text',
      '354': 'EncodedTextLen',
      '355': 'EncodedText',
      '10': 'CheckSum',
      // PSX-specific tags
      '335': 'TradSesReqID',
      '625': 'TradingSessionSubID',
      '1301': 'MarketSegmentID',
      '1300': 'MarketID'
    };
    
    // Log fields with their names
    Object.entries(message).forEach(([tag, value]) => {
      const fieldName = fieldNames[tag] || 'Unknown';
      logger.info(`Tag ${tag} (${fieldName}): ${value}`);
    });
    
    logger.info('----------------------------------------');
  }
});

// Handle trading session status response
client.on('tradingSessionStatus', (sessionInfo: TradingSessionInfo) => {
  tradingSessionReceived = true;
  logger.info('===============================');
  logger.info('TRADING SESSION STATUS RECEIVED');
  logger.info('===============================');
  
  logger.info(JSON.stringify(sessionInfo, null, 2));
  
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
  
  // Exit after receiving trading session status and waiting 3 seconds
  setTimeout(() => {
    logger.info('Disconnecting...');
    client.disconnect().then(() => {
      process.exit(0);
    });
  }, 3000);
});

// Start the client
logger.info('Starting FIX client...');
client.start();

// Send a manual trading session status request after login 
let requestSent = false;

client.on('rawMessage', (message) => {
  // Wait for successful login before sending request
  if (message['35'] === 'A' && !requestSent) { // 'A' is Logon message
    logger.info('Login successful, sending trading session status request in 3 seconds...');
    
    // Wait 3 seconds after login to send request
    setTimeout(() => {
      // Try multiple variations of the trading session request
      
      // First try standard request for REG session
      logger.info('Sending trading session status request for REG session...');
      const regReqId = client.sendTradingSessionStatusRequest();
      
      // Wait 5 seconds and check if we received a response
      setTimeout(() => {
        if (!tradingSessionReceived) {
          // If no response, try a generic request
          logger.info('No response received, sending generic trading session status request...');
          
          // Try a different approach if the standard request didn't work
          tryAlternativeTradingSessionRequest();
        }
      }, 5000);
      
      requestSent = true;
    }, 3000);
  }
});

// Try an alternative approach to request trading session status
function tryAlternativeTradingSessionRequest() {
  // Get the socket and other internals from the client if possible
  // This is a hacky approach but might work in some cases
  
  // Simply try requesting again with a longer timeout
  setTimeout(() => {
    // If we still haven't received a trading session status after 15 seconds
    if (!tradingSessionReceived) {
      logger.warn('Still no trading session status received after waiting 15 seconds');
      logger.warn('Disconnecting...');
      client.disconnect().then(() => {
        process.exit(1);
      });
    }
  }, 10000);
}

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