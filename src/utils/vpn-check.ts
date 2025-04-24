import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

/**
 * Ensure the VPN script is executable
 */
const ensureScriptExecutable = (): void => {
  try {
    if (fs.existsSync(directVpnScriptPath)) {
      fs.chmodSync(directVpnScriptPath, '755');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to make VPN script executable: ${errorMessage}`);
  }
};

// Initialize by ensuring script is executable
ensureScriptExecutable();

/**
 * Check if the VPN is currently active
 * @returns Promise<boolean> True if VPN is active
 */
export const isVpnActive = async (): Promise<boolean> => {
  try {
    // Check for tun0 interface which indicates active VPN
    const { stdout } = await execAsync('ip link show tun0 2>/dev/null || ifconfig tun0 2>/dev/null');
    return stdout.trim().length > 0;
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
    const { stdout } = await execAsync(`ping -c 1 -W 2 ${targetIp}`);
    return stdout.includes('1 received');
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
    // Make sure the password file exists
    await ensureVpnPasswordFile();
    
    logger.info('Attempting to connect to PSX VPN using direct connection...');
    
    if (fs.existsSync(directVpnScriptPath)) {
      try {
        logger.info('Using direct VPN connection script...');
        
        // Use the script
        await execAsync(directVpnScriptPath, { 
          timeout: 30000
        });
        
        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if connected
        const vpnActive = await isVpnActive();
        if (vpnActive) {
          logger.info('Successfully connected to PSX VPN');
          return true;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`VPN script failed: ${errorMessage}`);
      }
    }
    
    // Direct connection as fallback
    logger.info('Trying direct VPN connection without script...');
    
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
      const vpnActive = await isVpnActive();
      if (vpnActive) {
        logger.info('Successfully connected to PSX VPN');
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to connect to VPN: ${errorMessage}`);
    }
    
    logger.error('VPN connection attempts failed');
    return false;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error connecting to VPN: ${errorMessage}`);
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