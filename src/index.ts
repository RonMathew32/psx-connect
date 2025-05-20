import dotenv from 'dotenv';
import logger from './utils/logger';
import { createWebSocketServer } from './websocket-server';
import { FixClientOptions } from './types';
import { createFixClient } from './fix/fix-client';

dotenv.config();

logger.info('PSX-Connect starting...');
logger.info(`Node.js version: ${process.version}`);
logger.info(`Operating system: ${process.platform} ${process.arch}`);

async function main() {
  try {
    const wss = createWebSocketServer(8080);

    const fixOptions: FixClientOptions = {
      host: process.env.PSX_HOST || '',
      port: parseInt(process.env.PSX_PORT || ''),
      senderCompId: process.env.SENDER_COMP_ID || '',
      targetCompId: process.env.TARGET_COMP_ID || '',
      username: process.env.FIX_USERNAME || '',
      password: process.env.FIX_PASSWORD || '',
      heartbeatIntervalSecs: parseInt(process.env.HEARTBEAT_INTERVAL || ''),
      connectTimeoutMs: parseInt(process.env.CONNECT_TIMEOUT || '30000', 10),
      onBehalfOfCompId: process.env.ON_BEHALF_OF_COMP_ID || '600',
      rawDataLength: parseInt(process.env.RAW_DATA_LENGTH || '3', 10),
      rawData: process.env.RAW_DATA || 'kse',
      resetOnLogon: true
    };

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