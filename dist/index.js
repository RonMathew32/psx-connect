"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = __importDefault(require("./utils/logger"));
const vpn_check_1 = require("./utils/vpn-check");
const fix_client_1 = require("./fix/fix-client");
// Load environment variables from .env file if present
dotenv_1.default.config();
// Log startup information
logger_1.default.info('PSX-Connect starting...');
logger_1.default.info(`Node.js version: ${process.version}`);
logger_1.default.info(`Operating system: ${process.platform} ${process.arch}`);
// VPN file path
const vpnFilePath = process.env.VPN_FILE || path_1.default.join(process.cwd(), 'vpn');
/**
 * Read VPN configuration from file
 */
function readVpnConfig() {
    const config = {};
    try {
        if (fs_1.default.existsSync(vpnFilePath)) {
            logger_1.default.info(`Reading VPN configuration from ${vpnFilePath}`);
            const content = fs_1.default.readFileSync(vpnFilePath, 'utf8');
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
            logger_1.default.info('VPN configuration loaded successfully');
        }
        else {
            logger_1.default.warn(`VPN configuration file not found at ${vpnFilePath}`);
        }
    }
    catch (error) {
        logger_1.default.error(`Error reading VPN configuration: ${error instanceof Error ? error.message : String(error)}`);
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
            logger_1.default.info(`Using VPN server: ${vpnConfig.host}`);
        }
        // Check and establish VPN connection
        const vpnChecker = vpn_check_1.VpnChecker.getInstance();
        logger_1.default.info('Checking VPN connection...');
        const isVpnActive = await vpnChecker.ensureVpnConnection();
        if (!isVpnActive) {
            logger_1.default.error('Failed to establish VPN connection. Exiting.');
            process.exit(1);
        }
        logger_1.default.info('VPN connection established successfully.');
        // Configure FIX client with defaults (can be overridden with environment variables)
        const fixOptions = {
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
        const fixClient = new fix_client_1.FixClient(fixOptions);
        // Set up event handlers for FIX client
        fixClient.on('connected', () => {
            logger_1.default.info('TCP connection established to PSX server.');
        });
        fixClient.on('logon', () => {
            logger_1.default.info('Successfully logged in to PSX server.');
            // Send notification about successful connection
            sendLogNotification('PSX connection established successfully.');
        });
        fixClient.on('message', (message) => {
            logger_1.default.info(`Received message: Type=${message['35']}`);
        });
        fixClient.on('error', (error) => {
            logger_1.default.error(`FIX client error: ${error.message}`);
            // Send notification about error
            sendLogNotification(`PSX connection error: ${error.message}`);
        });
        fixClient.on('disconnected', () => {
            logger_1.default.warn('Disconnected from PSX server.');
            // Send notification about disconnection
            sendLogNotification('PSX connection lost. Attempting to reconnect...');
        });
        // Connect to PSX
        await fixClient.connect();
        // Handle process termination
        process.on('SIGINT', async () => {
            logger_1.default.info('Received SIGINT. Shutting down...');
            await fixClient.disconnect();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            logger_1.default.info('Received SIGTERM. Shutting down...');
            await fixClient.disconnect();
            process.exit(0);
        });
        // Log successful startup
        logger_1.default.info('PSX-Connect running. Press Ctrl+C to exit.');
    }
    catch (error) {
        logger_1.default.error(`Application error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
/**
 * Send a log notification message
 * This could be modified to send via email, SMS, Slack, etc.
 */
function sendLogNotification(message) {
    logger_1.default.info(`NOTIFICATION: ${message}`);
    // Log to a separate notification log file
    const notificationLogPath = path_1.default.join(process.cwd(), 'logs', 'notifications.log');
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}\n`;
    try {
        fs_1.default.appendFileSync(notificationLogPath, logEntry);
    }
    catch (error) {
        logger_1.default.error(`Failed to write notification to log: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Additional notification methods could be added here (email, SMS, etc.)
}
// Start the application
main().catch(error => {
    logger_1.default.error(`Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
