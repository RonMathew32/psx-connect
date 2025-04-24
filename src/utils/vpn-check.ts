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
    
    // Get VPN password from vpn file
    let password = '';
    const vpnFilePath = process.env.VPN_FILE || path.join(process.cwd(), 'vpn');
    
    if (fs.existsSync(vpnFilePath)) {
      logger.info(`Reading VPN configuration from ${vpnFilePath}`);
      const content = fs.readFileSync(vpnFilePath, 'utf8');
      
      // Parse simple key-value pairs to find password
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('pass ')) {
          password = line.substring(5).trim();
          break;
        }
      }
    }
    
    if (!password) {
      logger.error('VPN password not found in vpn file');
      return false;
    }
    
    // VPN credentials
    const vpnServer = process.env.VPN_SERVER || '172.16.73.18';
    const group = process.env.VPN_GROUP || 'PSX-Staff';
    
    // Try a command that's as simple and direct as possible
    try {
      logger.info('Attempting simplified VPN connection approach...');
      
      // Create a temporary file for connection  
      const tmpConnectionFile = path.join(os.tmpdir(), `vpn-creds-${Date.now()}.txt`);
      fs.writeFileSync(tmpConnectionFile, password);
      fs.chmodSync(tmpConnectionFile, 0o600); // Secure permissions
      
      // Use a simple approach which is most likely to work
      // This avoids all the complexities with stdin/stdout and just uses the password file
      const connectCmd = `sudo openconnect --background --authgroup="${group}" --passwd-file="${tmpConnectionFile}" --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= --interface="tun0" "${vpnServer}"`;
      
      logger.info('Executing simplified VPN connection command...');
      await execAsync(connectCmd, { timeout: 30000 });
      
      // Clean up credentials file
      try {
        fs.unlinkSync(tmpConnectionFile);
      } catch (error) {
        logger.warn(`Could not delete temporary credentials file: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if connected
      const vpnActive = await isVpnActive();
      if (vpnActive) {
        logger.info('Successfully connected to PSX VPN');
        
        // Add PSX route manually
        try {
          logger.info('Adding route for PSX subnet...');
          await execAsync('sudo ip route add 172.16.64.0/19 dev tun0', { timeout: 5000 });
        } catch (error) {
          // Ignore route errors, connection might still work
          logger.warn(`Could not add route: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed with simplified approach: ${errorMessage}`);
    }
    
    // Last resort - try to use sudo directly with echo  
    try {
      logger.info('Trying last resort VPN connection method...');
      
      // Using the most direct approach that works in a standard terminal
      // This approach avoids all the complicated redirection issues
      const connectCmd = `sudo sh -c 'echo ${password} | openconnect --background --authgroup=${group} --passwd-on-stdin --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= --interface=tun0 ${vpnServer}'`;
      
      logger.info('Executing last resort command...');
      await execAsync(connectCmd, { timeout: 30000 });
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if connected
      const vpnActive = await isVpnActive();
      if (vpnActive) {
        logger.info('Successfully connected to PSX VPN with last resort method');
        
        // Add PSX route manually
        try {
          logger.info('Adding route for PSX subnet...');
          await execAsync('sudo ip route add 172.16.64.0/19 dev tun0', { timeout: 5000 });
        } catch (error) {
          // Ignore route errors, connection might still work
          logger.warn(`Could not add route: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed with last resort method: ${errorMessage}`);
    }
    
    // Ultra-last resort - execute exact commands from fn-psx/src/fixpkf/etc/start-psx-vpn
    try {
      logger.info('Trying ultra-last resort VPN connection method (mimicking fn-psx exactly)...');
      
      // Kill existing connections
      try {
        await execAsync('sudo killall openconnect', { timeout: 5000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        // Ignore error if no openconnect processes found
      }
      
      // Try to apply netplan if available
      try {
        await execAsync('sudo netplan apply', { timeout: 5000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        // Ignore error if netplan isn't available
      }
      
      // This is exactly what fn-psx uses based on src/fixpkf/etc/start-psx-vpn
      // We're using authgroup even though the original script doesn't, to avoid the group selection issue
      const connectCmd = `sudo sh -c 'echo ${password} | openconnect --authgroup=${group} --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= ${vpnServer}'`;
      
      logger.info('Executing ultra-last resort command...');
      // Using a higher timeout since we're not using background mode
      await execAsync(connectCmd, { timeout: 60000 });
      
      // Check if connected
      const vpnActive = await isVpnActive();
      if (vpnActive) {
        logger.info('Successfully connected to PSX VPN with ultra-last resort method');
        
        // Add PSX route manually
        try {
          logger.info('Adding route for PSX subnet...');
          await execAsync('sudo ip route add 172.16.64.0/19 dev tun0', { timeout: 5000 });
        } catch (error) {
          // Ignore route errors, connection might still work
          logger.warn(`Could not add route: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed with ultra-last resort method: ${errorMessage}`);
    }
    
    logger.error('All VPN connection attempts failed');
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