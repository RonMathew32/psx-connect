import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { createWebSocketServer } from './utils/websocket-server';
import { FixClientOptions } from './types';
import { createFixClient } from './fix/fix-client';
import { validateFixOptions } from './utils/validate-fix-options';

dotenv.config();

logger.info('PSX-Connect starting...');
logger.info(`Node.js version: ${process.version}`);
logger.info(`Operating system: ${process.platform} ${process.arch}`);

async function main() {
  try {
    const wss = createWebSocketServer(8080);

    const fixOptions: FixClientOptions = {
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

    validateFixOptions(fixOptions);

    const fixClient = createFixClient(fixOptions);

    fixClient.on('connected', () => {
      logger.info('TCP connection established to PSX server.');
    });

    fixClient.on('logon', () => {
      logger.info('Successfully logged in to PSX server.');
    });

    fixClient.on('message', (message) => {
      logger.info(`Received message: ${(message)}`);
    });

    fixClient.on('error', (error) => {
      logger.error(`FIX client error: ${error.message}`);
    });

    fixClient.on('disconnected', () => {
      logger.warn('Disconnected from PSX server.');
    });

    await fixClient.connect();

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT. Shutting down...');
      await fixClient.disconnect();
      wss.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM. Shutting down...');
      await fixClient.disconnect();
      wss.close();
      process.exit(0);
    });

    logger.info('PSX-Connect running. Press Ctrl+C to exit.');

  } catch (error) {
    logger.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}


main().catch(error => {
  logger.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}); 