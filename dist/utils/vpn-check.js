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
exports.VpnChecker = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * Simple logger for the application
 */
class Logger {
    constructor(context) {
        this.prefix = `[${context}]`;
    }
    info(message) {
        console.log(`${this.prefix} ${message}`);
    }
    warn(message) {
        console.warn(`${this.prefix} ${message}`);
    }
    error(message) {
        console.error(`${this.prefix} ${message}`);
    }
    debug(message) {
        if (process.env.DEBUG) {
            console.debug(`${this.prefix} DEBUG: ${message}`);
        }
    }
}
/**
 * Class to check and manage VPN connectivity for PSX
 * Uses the same approach as fn-psx
 */
class VpnChecker {
    /**
     * Get the VpnChecker singleton instance
     */
    static getInstance() {
        if (!VpnChecker.instance) {
            VpnChecker.instance = new VpnChecker();
        }
        return VpnChecker.instance;
    }
    constructor() {
        this.logger = new Logger('VpnChecker');
        this.directVpnScriptPath = path.join(process.cwd(), 'connect-vpn-direct.sh');
        this.ensureScriptExecutable();
    }
    /**
     * Ensure the VPN script is executable
     */
    ensureScriptExecutable() {
        try {
            if (fs.existsSync(this.directVpnScriptPath)) {
                fs.chmodSync(this.directVpnScriptPath, '755');
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to make VPN script executable: ${errorMessage}`);
        }
    }
    /**
     * Check if the VPN is currently active
     * @returns Promise<boolean> True if VPN is active
     */
    async isVpnActive() {
        try {
            // Check for tun0 interface which indicates active VPN
            const { stdout } = await execAsync('ip link show tun0 2>/dev/null || ifconfig tun0 2>/dev/null');
            return stdout.trim().length > 0;
        }
        catch (error) {
            // Command failed, which means tun0 doesn't exist
            return false;
        }
    }
    /**
     * Alias for isVpnActive to match expected method name in other files
     */
    async checkVpnActive() {
        return this.isVpnActive();
    }
    /**
     * Test connectivity to PSX by pinging a known PSX IP
     * @returns Promise<boolean> True if connectivity test succeeds
     */
    async testPsxConnectivity() {
        try {
            // Try to ping the PSX server
            const targetIp = process.env.PSX_IP || '172.16.73.18';
            const { stdout } = await execAsync(`ping -c 1 -W 2 ${targetIp}`);
            return stdout.includes('1 received');
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Check if VPN password file exists and create if needed
     * @returns Promise<boolean> True if password file is ready
     */
    async ensureVpnPasswordFile() {
        const passwordFile = process.env.VPN_PASSWORD_FILE || path.join(os.homedir(), '.psx-vpn-password');
        try {
            // Check if file exists
            if (!fs.existsSync(passwordFile)) {
                this.logger.warn(`VPN password file not found at ${passwordFile}`);
                this.logger.info('Creating default password file. Please update it with your actual password.');
                // Create default password file
                fs.writeFileSync(passwordFile, 'default_password');
                fs.chmodSync(passwordFile, 0o600);
                this.logger.info(`Created password file at ${passwordFile}`);
                this.logger.info(`Please update this file with your actual VPN password.`);
            }
            else {
                // Make sure permissions are correct
                fs.chmodSync(passwordFile, 0o600);
            }
            return true;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error with VPN password file: ${errorMessage}`);
            return false;
        }
    }
    /**
     * Connect to the VPN using the direct script like fn-psx does
     * @returns Promise<boolean> True if connection was successful
     */
    async connectToVpn() {
        try {
            // Make sure the password file exists
            await this.ensureVpnPasswordFile();
            this.logger.info('Attempting to connect to PSX VPN using direct connection...');
            if (fs.existsSync(this.directVpnScriptPath)) {
                try {
                    this.logger.info('Using direct VPN connection script...');
                    // Use the script
                    await execAsync(this.directVpnScriptPath, {
                        timeout: 30000
                    });
                    // Wait for connection
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // Check if connected
                    const isActive = await this.isVpnActive();
                    if (isActive) {
                        this.logger.info('Successfully connected to PSX VPN');
                        return true;
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.logger.error(`VPN script failed: ${errorMessage}`);
                }
            }
            // Direct connection as fallback
            this.logger.info('Trying direct VPN connection without script...');
            // Get VPN password
            const passwordFile = process.env.VPN_PASSWORD_FILE || path.join(os.homedir(), '.psx-vpn-password');
            const password = fs.readFileSync(passwordFile, 'utf8').trim();
            // VPN credentials
            const vpnServer = process.env.VPN_SERVER || '172.16.73.18';
            const vpnUsername = process.env.VPN_USERNAME || os.userInfo().username;
            // Connect directly using openconnect
            try {
                await execAsync(`echo "${password}" | sudo -S openconnect --background --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= --no-cert-check --user="${vpnUsername}" --passwd-on-stdin "${vpnServer}"`, {
                    timeout: 30000
                });
                // Wait for connection
                await new Promise(resolve => setTimeout(resolve, 3000));
                // Check if connected
                const isActive = await this.isVpnActive();
                if (isActive) {
                    this.logger.info('Successfully connected to PSX VPN');
                    return true;
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error(`Failed to connect to VPN: ${errorMessage}`);
            }
            this.logger.error('VPN connection attempts failed');
            return false;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error connecting to VPN: ${errorMessage}`);
            return false;
        }
    }
    /**
     * Ensures VPN connection is active, attempting to connect if needed
     * @returns Promise<boolean> True if VPN is or becomes active
     */
    async ensureVpnConnection() {
        const isActive = await this.isVpnActive();
        if (isActive) {
            this.logger.info('VPN is already active');
            // Test PSX connectivity to confirm VPN is working properly
            const hasConnectivity = await this.testPsxConnectivity();
            if (hasConnectivity) {
                this.logger.info('PSX connectivity confirmed');
                return true;
            }
            else {
                this.logger.warn('VPN is active but PSX connectivity test failed');
            }
        }
        this.logger.info('VPN is not active, attempting to connect...');
        return this.connectToVpn();
    }
}
exports.VpnChecker = VpnChecker;
