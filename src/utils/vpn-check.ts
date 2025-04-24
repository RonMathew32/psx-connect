import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

const execAsync = promisify(exec);

/**
 * Simple logger for the application
 */
const createLogger = (context: string) => {
  const prefix = `[${context}]`;
  
  return {
    info: (message: string): void => {
      console.log(`${prefix} ${message}`);
    },
    
    warn: (message: string): void => {
      console.warn(`${prefix} ${message}`);
    },
    
    error: (message: string): void => {
      console.error(`${prefix} ${message}`);
    },
    
    debug: (message: string): void => {
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
export const isVpnActive = async (): Promise<boolean> => {
  try {
    const isMacOS = os.platform() === 'darwin';
    
    if (isMacOS) {
      // On macOS, use ifconfig to check for tun/utun interfaces
      const { stdout } = await execAsync('ifconfig | grep -E "tun|utun"');
      return stdout.trim().length > 0;
    } else {
      // On Linux, check for tun0 interface
      const { stdout } = await execAsync('ip link show tun0 2>/dev/null || ifconfig tun0 2>/dev/null');
      return stdout.trim().length > 0;
    }
  } catch (error) {
    // Command failed, which means tun0 doesn't exist
    return false;
  }
};

/**
 * Alias for isVpnActive to match expected method name in other files
 */
export const checkVpnActive = async (): Promise<boolean> => {
  return isVpnActive();
};

/**
 * Test connectivity to PSX by pinging a known PSX IP
 * @returns Promise<boolean> True if connectivity test succeeds
 */
export const testPsxConnectivity = async (): Promise<boolean> => {
  try {
    // Try to ping the PSX server
    const targetIp = process.env.PSX_IP || '172.16.73.18';
    
    // Mac and Linux use different ping syntax
    const isMacOS = os.platform() === 'darwin';
    const pingCmd = isMacOS ? 
      `ping -c 1 -t 2 ${targetIp}` :  // macOS uses -t for timeout
      `ping -c 1 -W 2 ${targetIp}`;   // Linux uses -W for timeout
    
    const { stdout } = await execAsync(pingCmd);
    return stdout.includes('1 received') || stdout.includes('1 packets received');
  } catch (error) {
    return false;
  }
};

/**
 * Check if VPN password file exists and create if needed
 * @returns Promise<boolean> True if password file is ready
 */
const ensureVpnPasswordFile = async (): Promise<boolean> => {
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
    } else {
      // Make sure permissions are correct
      fs.chmodSync(passwordFile, 0o600);
    }
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error with VPN password file: ${errorMessage}`);
    return false;
  }
};

/**
 * Connect to the VPN using the direct script like fn-psx does
 * @returns Promise<boolean> True if connection was successful
 */
export const connectToVpn = async (): Promise<boolean> => {
  try {
    logger.info('Attempting to connect to PSX VPN using direct connection...');
    
    // Run the direct VPN connection script
    logger.info(`Executing VPN script: ${directVpnScriptPath}`);
    try {
      await execAsync(`bash "${directVpnScriptPath}"`, { timeout: 60000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`VPN script execution failed: ${msg}`);
      return false;
    }

    // Wait for interface to come up
    await new Promise(resolve => setTimeout(resolve, 5000));
    const vpnActive = await isVpnActive();
    if (!vpnActive) {
      logger.error('VPN interface tun0 not found after script execution');
      return false;
    }
    logger.info('Successfully connected to PSX VPN via script');

    // Add PSX route
    try {
      logger.info('Adding route for PSX subnet...');
      await execAsync('sudo ip route add 172.16.64.0/19 dev tun0', { timeout: 5000 });
    } catch (err) {
      logger.warn(`Could not add PSX route: ${err instanceof Error ? err.message : String(err)}`);
    }
    return true;
  } catch (error) {
    logger.error(`Error connecting to VPN: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

/**
 * Ensures VPN connection is active, attempting to connect if needed
 * @returns Promise<boolean> True if VPN is or becomes active
 */
export const ensureVpnConnection = async (): Promise<boolean> => {
  const vpnActive = await isVpnActive();
  
  if (vpnActive) {
    logger.info('VPN is already active');
    
    // Test PSX connectivity to confirm VPN is working properly
    const hasConnectivity = await testPsxConnectivity();
    if (hasConnectivity) {
      logger.info('PSX connectivity confirmed');
      return true;
    } else {
      logger.warn('VPN is active but PSX connectivity test failed');
    }
  }
  
  logger.info('VPN is not active, attempting to connect...');
  return connectToVpn();
}; 