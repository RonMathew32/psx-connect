/**
 * Example of using the improved PSX FIX client
 * 
 * This example demonstrates how to use the improved components:
 * - SequenceManager
 * - SessionManager
 * - SecurityListHandler
 */

import { createFixClient } from '../fix/fix-client';
import logger from '../utils/logger';
import { SecurityInfo } from '../types';

// Define message category types
type MessageCategory = 'MARKET_DATA' | 'SECURITY_LIST' | 'TRADING_STATUS' | 'SESSION' | 'HEARTBEAT' | 'REJECT' | 'UNKNOWN';
type SecurityListType = 'EQUITY' | 'INDEX' | 'UNKNOWN';

// Track message statistics
const messageStats: Record<MessageCategory, any> = {
  MARKET_DATA: {
    count: 0,
    symbols: new Set<string>()
  },
  SECURITY_LIST: {
    count: 0,
    types: {
      EQUITY: 0,
      INDEX: 0,
      UNKNOWN: 0
    }
  },
  TRADING_STATUS: {
    count: 0,
    symbols: new Set<string>()
  },
  SESSION: {
    count: 0
  },
  HEARTBEAT: {
    count: 0
  },
  REJECT: {
    count: 0
  },
  UNKNOWN: {
    count: 0
  }
};

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
export async function runImprovedClient() {
  logger.info('[EXAMPLE] Starting improved PSX FIX client example');
  
  // Create the FIX client
  const client = createFixClient(fixConfig);
  
  // Track received securities
  const equities: SecurityInfo[] = [];
  const indices: SecurityInfo[] = [];
  
  // Set up event handlers
  client.on('connected', () => {
    logger.info('[EXAMPLE] Connected to FIX server');
  });
  
  client.on('disconnected', () => {
    logger.info('[EXAMPLE] Disconnected from FIX server');
  });
  
  client.on('error', (error) => {
    logger.error(`[EXAMPLE] Error: ${error.message}`);
  });
  
  client.on('logon', (message) => {
    logger.info('[EXAMPLE] Successfully logged in to FIX server');
    
    // Wait a bit after logon before sending requests
    setTimeout(() => {
      logger.info('[EXAMPLE] Requesting security lists');
      
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
      logger.info(`[EXAMPLE] Received ${securities.length} index securities (total: ${indices.length})`);
    } else {
      equities.push(...securities);
      logger.info(`[EXAMPLE] Received ${securities.length} equity securities (total: ${equities.length})`);
    }
    
    // Log a sample
    if (securities.length > 0) {
      logger.info(`[EXAMPLE] Sample security: ${JSON.stringify(securities[0])}`);
    }
  });
  
  client.on('reject', (rejectInfo) => {
    logger.error(`[EXAMPLE] Received REJECT: ${JSON.stringify(rejectInfo)}`);
    
    // Handle sequence number errors
    if (rejectInfo.text && rejectInfo.text.includes('MsgSeqNum')) {
      logger.info('[EXAMPLE] Sequence number issue detected, resetting connection');
      client.reset();
    }
  });
  
  // Listen for categorized data events to track different message types
  client.on('categorizedData', (data) => {
    // Update statistics based on message category
    const category = data.category as MessageCategory;
    if (messageStats[category]) {
      messageStats[category].count++;
      
      // Track symbols for market data
      if (category === 'MARKET_DATA' && data.symbol) {
        messageStats.MARKET_DATA.symbols.add(data.symbol);
      }
      
      // Track security list types
      if (category === 'SECURITY_LIST' && data.type) {
        const secType = data.type as SecurityListType;
        messageStats.SECURITY_LIST.types[secType] = 
          (messageStats.SECURITY_LIST.types[secType] || 0) + 1;
      }
      
      // Track symbols with trading status updates
      if (category === 'TRADING_STATUS' && data.symbol) {
        messageStats.TRADING_STATUS.symbols.add(data.symbol);
      }
      
      // Log statistics every 10 messages
      const totalMessages = Object.values(messageStats).reduce((sum, category) => sum + category.count, 0);
      if (totalMessages % 10 === 0) {
        logMessageStats();
      }
    }
  });
  
  // Connect to the server
  logger.info('[EXAMPLE] Connecting to FIX server...');
  await client.connect();
  
  // Return a cleanup function
  return async () => {
    logger.info('[EXAMPLE] Cleaning up...');
    
    // Print summary
    logger.info(`[EXAMPLE] Received ${equities.length} equities and ${indices.length} indices`);
    
    // Disconnect
    await client.disconnect();
    logger.info('[EXAMPLE] Disconnected from FIX server');
  };
}

// Run the example if this file is executed directly
if (require.main === module) {
  // Create a promise to prevent immediate exit
  const runningPromise = new Promise<void>(async (resolve) => {
    const cleanup = await runImprovedClient();
    
    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      logger.info('[EXAMPLE] Received SIGINT, shutting down...');
      await cleanup();
      resolve();
    });
    
    // Auto-shutdown after 2 minutes
    setTimeout(async () => {
      logger.info('[EXAMPLE] Auto-shutdown after timeout');
      await cleanup();
      resolve();
    }, 120000);
  });
  
  // Wait for the promise to resolve before exiting
  runningPromise.then(() => {
    logger.info('[EXAMPLE] Example completed');
    process.exit(0);
  }).catch(err => {
    logger.error(`[EXAMPLE] Error: ${err.message}`);
    process.exit(1);
  });
}

// Function to log message statistics
function logMessageStats() {
  logger.info('================ MESSAGE STATISTICS ================');
  logger.info(`MARKET_DATA: ${messageStats.MARKET_DATA.count} messages, ${messageStats.MARKET_DATA.symbols.size} symbols`);
  logger.info(`SECURITY_LIST: ${messageStats.SECURITY_LIST.count} messages (EQUITY: ${messageStats.SECURITY_LIST.types.EQUITY}, INDEX: ${messageStats.SECURITY_LIST.types.INDEX})`);
  logger.info(`TRADING_STATUS: ${messageStats.TRADING_STATUS.count} messages, ${messageStats.TRADING_STATUS.symbols.size} symbols`);
  logger.info(`SESSION: ${messageStats.SESSION.count} messages`);
  logger.info(`HEARTBEAT: ${messageStats.HEARTBEAT.count} messages`);
  logger.info(`REJECT: ${messageStats.REJECT.count} messages`);
  logger.info(`UNKNOWN: ${messageStats.UNKNOWN.count} messages`);
  logger.info('=====================================================');
} 