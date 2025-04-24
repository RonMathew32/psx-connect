import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import logger from './utils/logger';
import * as vpnUtils from './utils/vpn-check';
import { createFixClient, FixClientOptions } from './fix/fix-client';

// Load environment variables from .env file if present
dotenv.config();

// Log startup information
logger.info('PSX-Connect starting...');
logger.info(`Node.js version: ${process.version}`);
logger.info(`Operating system: ${process.platform} ${process.arch}`);

// VPN file path
const vpnFilePath = process.env.VPN_FILE || path.join(process.cwd(), 'vpn');

/**
 * Read VPN configuration from file
 */
function readVpnConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  
  try {
    if (fs.existsSync(vpnFilePath)) {
      logger.info(`Reading VPN configuration from ${vpnFilePath}`);
      const content = fs.readFileSync(vpnFilePath, 'utf8');
      
      // Parse simple key-value pairs
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#')) {
          const parts = line.split(' ');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join(' ').trim();
            config[key] = value;
          }
        }
      }
      
      logger.info('VPN configuration loaded successfully');
    } else {
      logger.warn(`VPN configuration file not found at ${vpnFilePath}`);
    }
  } catch (error) {
    logger.error(`Error reading VPN configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return config;
}

/**
 * Main application function
 */
async function main() {
  try {
    // Read VPN configuration
    const vpnConfig = readVpnConfig();
    
    // Set VPN environment variables from config if available
    if (vpnConfig.host) {
      process.env.VPN_SERVER = vpnConfig.host;
      logger.info(`Using VPN server: ${vpnConfig.host}`);
    }
    
    // Check and establish VPN connection
    logger.info('Checking VPN connection...');
    
    const isVpnActive = await vpnUtils.ensureVpnConnection();
    if (!isVpnActive) {
      logger.error('Failed to establish VPN connection. Exiting.');
      process.exit(1);
    }
    
    logger.info('VPN connection established successfully.');
    
    // Configure FIX client with defaults (can be overridden with environment variables)
    const fixOptions: FixClientOptions = {
      host: process.env.PSX_HOST || '172.21.101.36',
      port: parseInt(process.env.PSX_PORT || '8016', 10),
      senderCompId: process.env.SENDER_COMP_ID || 'realtime',
      targetCompId: process.env.TARGET_COMP_ID || 'NMDUFISQ0001',
      username: process.env.FIX_USERNAME || 'realtime',
      password: process.env.FIX_PASSWORD || 'NMDUFISQ0001',
      heartbeatIntervalSecs: parseInt(process.env.HEARTBEAT_INTERVAL || '30', 10),
      connectTimeoutMs: parseInt(process.env.CONNECT_TIMEOUT || '30000', 10)
    };
    
    // Create and connect FIX client
    const fixClient = createFixClient(fixOptions);
    
    // Set up event handlers for FIX client
    fixClient.on('connected', () => {
      logger.info('TCP connection established to PSX server.');
    });
    
    fixClient.on('logon', () => {
      logger.info('Successfully logged in to PSX server.');
      
      // Send notification about successful connection
      sendLogNotification('PSX connection established successfully.');
    });
    
    fixClient.on('message', (message) => {
      logger.info(`Received message: Type=${message['35']}`);
    });
    
    fixClient.on('error', (error) => {
      logger.error(`FIX client error: ${error.message}`);
      
      // Send notification about error
      sendLogNotification(`PSX connection error: ${error.message}`);
    });
    
    fixClient.on('disconnected', () => {
      logger.warn('Disconnected from PSX server.');
      
      // Send notification about disconnection
      sendLogNotification('PSX connection lost. Attempting to reconnect...');
    });
    
    // Connect to PSX
    await fixClient.connect();
    
    // Handle process termination
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT. Shutting down...');
      await fixClient.disconnect();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM. Shutting down...');
      await fixClient.disconnect();
      process.exit(0);
    });
    
    // Log successful startup
    logger.info('PSX-Connect running. Press Ctrl+C to exit.');
    
  } catch (error) {
    logger.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Send a log notification message
 * This could be modified to send via email, SMS, Slack, etc.
 */
function sendLogNotification(message: string): void {
  logger.info(`NOTIFICATION: ${message}`);
  
  // Log to a separate notification log file
  const notificationLogPath = path.join(process.cwd(), 'logs', 'notifications.log');
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} - ${message}\n`;
  
  try {
    fs.appendFileSync(notificationLogPath, logEntry);
  } catch (error) {
    logger.error(`Failed to write notification to log: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Additional notification methods could be added here (email, SMS, etc.)
}

// Start the application
main().catch(error => {
  logger.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}); 