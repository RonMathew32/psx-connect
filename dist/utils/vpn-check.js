"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVpnConnection = exports.connectToVpn = exports.testPsxConnectivity = exports.checkVpnActive = exports.isVpnActive = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Simple logger for the application
 */
const createLogger = (context) => {
    const prefix = `[${context}]`;
    return {
        info: (message) => {
            console.log(`${prefix} ${message}`);
        },
        warn: (message) => {
            console.warn(`${prefix} ${message}`);
        },
        error: (message) => {
            console.error(`${prefix} ${message}`);
        },
        debug: (message) => {
            if (process.env.DEBUG) {
                console.debug(`${prefix} DEBUG: ${message}`);
            }
        }
    };
};
// Create a logger instance for VPN utilities
const logger = createLogger('VpnUtils');
// Path to the VPN script
const directVpnScriptPath = path.join(process.cwd(), 'connect-vpn-direct.sh');
// We'll skip trying to make the script executable since that's causing permission issues
// The script should be made executable manually with: chmod +x connect-vpn-direct.sh
/**
 * Check if the VPN is currently active
 * @returns Promise<boolean> True if VPN is active
 */
const isVpnActive = async () => {
    try {
        const isMacOS = os.platform() === 'darwin';
        if (isMacOS) {
            // On macOS, use ifconfig to check for tun/utun interfaces
            const { stdout } = await execAsync('ifconfig | grep -E "tun|utun"');
            return stdout.trim().length > 0;
        }
        else {
            // On Linux, check for tun0 interface
            const { stdout } = await execAsync('ip link show tun0 2>/dev/null || ifconfig tun0 2>/dev/null');
            return stdout.trim().length > 0;
        }
    }
    catch (error) {
        // Command failed, which means tun0 doesn't exist
        return false;
    }
};
exports.isVpnActive = isVpnActive;
/**
 * Alias for isVpnActive to match expected method name in other files
 */
const checkVpnActive = async () => {
    return (0, exports.isVpnActive)();
};
exports.checkVpnActive = checkVpnActive;
/**
 * Test connectivity to PSX by pinging a known PSX IP
 * @returns Promise<boolean> True if connectivity test succeeds
 */
const testPsxConnectivity = async () => {
    try {
        // Try to ping the PSX server
        const targetIp = process.env.PSX_IP || '172.16.73.18';
        // Mac and Linux use different ping syntax
        const isMacOS = os.platform() === 'darwin';
        const pingCmd = isMacOS ?
            `ping -c 1 -t 2 ${targetIp}` : // macOS uses -t for timeout
            `ping -c 1 -W 2 ${targetIp}`; // Linux uses -W for timeout
        const { stdout } = await execAsync(pingCmd);
        return stdout.includes('1 received') || stdout.includes('1 packets received');
    }
    catch (error) {
        return false;
    }
};
exports.testPsxConnectivity = testPsxConnectivity;
/**
 * Check if VPN password file exists and create if needed
 * @returns Promise<boolean> True if password file is ready
 */
const ensureVpnPasswordFile = async () => {
    const passwordFile = process.env.VPN_PASSWORD_FILE || path.join(os.homedir(), '.psx-vpn-password');
    try {
        // Check if file exists
        if (!fs.existsSync(passwordFile)) {
            logger.warn(`VPN password file not found at ${passwordFile}`);
            logger.info('Creating default password file. Please update it with your actual password.');
            // Create default password file
            fs.writeFileSync(passwordFile, 'default_password');
            fs.chmodSync(passwordFile, 0o600);
            logger.info(`Created password file at ${passwordFile}`);
            logger.info(`Please update this file with your actual VPN password.`);
        }
        else {
            // Make sure permissions are correct
            fs.chmodSync(passwordFile, 0o600);
        }
        return true;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error with VPN password file: ${errorMessage}`);
        return false;
    }
};
/**
 * Connect to the VPN using the direct script like fn-psx does
 * @returns Promise<boolean> True if connection was successful
 */
const connectToVpn = async () => {
    try {
        logger.info('Attempting to connect to PSX VPN using direct connection...');
        // Run the direct VPN connection script
        logger.info(`Executing VPN script: ${directVpnScriptPath}`);
        try {
            await execAsync(`bash "${directVpnScriptPath}"`, { timeout: 60000 });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`VPN script execution failed: ${msg}`);
            return false;
        }
        // Wait for interface to come up
        await new Promise(resolve => setTimeout(resolve, 5000));
        const vpnActive = await (0, exports.isVpnActive)();
        if (!vpnActive) {
            logger.error('VPN interface tun0 not found after script execution');
            return false;
        }
        logger.info('Successfully connected to PSX VPN via script');
        // Add PSX route
        try {
            logger.info('Adding route for PSX subnet...');
            await execAsync('sudo ip route add 172.16.64.0/19 dev tun0', { timeout: 5000 });
        }
        catch (err) {
            logger.warn(`Could not add PSX route: ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
    }
    catch (error) {
        logger.error(`Error connecting to VPN: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
};
exports.connectToVpn = connectToVpn;
/**
 * Ensures VPN connection is active, attempting to connect if needed
 * @returns Promise<boolean> True if VPN is or becomes active
 */
const ensureVpnConnection = async () => {
    const vpnActive = await (0, exports.isVpnActive)();
    if (vpnActive) {
        logger.info('VPN is already active');
        // Test PSX connectivity to confirm VPN is working properly
        const hasConnectivity = await (0, exports.testPsxConnectivity)();
        if (hasConnectivity) {
            logger.info('PSX connectivity confirmed');
            return true;
        }
        else {
            logger.warn('VPN is active but PSX connectivity test failed');
        }
    }
    logger.info('VPN is not active, attempting to connect...');
    return (0, exports.connectToVpn)();
};
exports.ensureVpnConnection = ensureVpnConnection;
