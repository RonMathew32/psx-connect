#!/usr/bin/env node

/**
 * Low-level connection tester for PSX
 * This bypasses the FIX client library and tests the network connection directly
 */

const net = require('net');

// Configuration
const PSX_HOST = '172.21.101.36';
const PSX_PORT = 8016;
const TEST_TIMEOUT_MS = 10000;

console.log(`Testing direct connection to PSX server at ${PSX_HOST}:${PSX_PORT}`);
console.log('-'.repeat(60));

// Create socket
const socket = new net.Socket();
socket.setNoDelay(true);
socket.setKeepAlive(true);

// Set up timeout
socket.setTimeout(TEST_TIMEOUT_MS);

// Log network interfaces
try {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  
  console.log('Network interfaces:');
  Object.keys(interfaces).forEach(ifname => {
    const iface = interfaces[ifname];
    if (iface) {
      iface.forEach(info => {
        if (info.family === 'IPv4') {
          console.log(`  ${ifname}: ${info.address}`);
        }
      });
    }
  });
  console.log('-'.repeat(60));
} catch (error) {
  console.error('Error checking interfaces:', error);
}

// Set up event handlers
socket.on('connect', () => {
  console.log(`TCP connection established to ${PSX_HOST}:${PSX_PORT}`);
  console.log(`Local address: ${socket.localAddress}:${socket.localPort}`);
  console.log(`Remote address: ${socket.remoteAddress}:${socket.remotePort}`);
  console.log('-'.repeat(60));
  
  // Create timestamp
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
  const timestamp = `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
  
  // Exact logon message used by fn-psx
  const logonMessage = "8=FIXT.1.19=12735=A34=149=realtime52=" + 
    timestamp + 
    "56=NMDUFISQ000198=0108=30141=Y554=NMDUFISQ00011137=91408=FIX5.00_PSX_1.0010=153";
  
  console.log('Sending logon message:');
  console.log(logonMessage);
  console.log('-'.repeat(60));
  
  // Send the message
  const messageBuffer = Buffer.from(logonMessage, 'ascii');
  socket.write(messageBuffer);
  console.log(`Message sent (${messageBuffer.length} bytes)`);
  
  // Set up a delayed check to see if we received a response
  setTimeout(() => {
    if (!socket.destroyed) {
      console.log('No response received after 5 seconds. The server is not responding to the logon request.');
      console.log('This could be due to:');
      console.log('1. The server is not a FIX server');
      console.log('2. The logon credentials are incorrect');
      console.log('3. The message format is incompatible');
      console.log('4. The server requires additional configuration');
      console.log('-'.repeat(60));
      console.log('Trying to send a simple heartbeat message to see if that gets a response...');
      
      // Try sending a simple heartbeat
      const heartbeatMessage = "8=FIXT.1.19=6535=034=249=realtime52=" + 
        timestamp + 
        "56=NMDUFISQ0001115=60096=kse95=310=000";
      
      socket.write(Buffer.from(heartbeatMessage, 'ascii'));
      console.log('Heartbeat sent. Waiting for response...');
    }
  }, 5000);
});

socket.on('data', (data) => {
  console.log(`Received data from server: ${data.length} bytes`);
  console.log(`Raw data: ${data.toString('hex')}`);
  console.log(`As ASCII: ${data.toString('ascii').replace(/[\x00-\x1F]/g, '|')}`);
  console.log('-'.repeat(60));
});

socket.on('timeout', () => {
  console.log('Connection timed out after ' + (TEST_TIMEOUT_MS/1000) + ' seconds');
  console.log('The server did not respond to any messages.');
  socket.destroy();
});

socket.on('error', (error) => {
  console.error(`Socket error: ${error.message}`);
  socket.destroy();
});

socket.on('close', (hadError) => {
  console.log(`Connection closed${hadError ? ' due to error' : ''}`);
  process.exit(hadError ? 1 : 0);
});

// Connect to the server
console.log(`Connecting to ${PSX_HOST}:${PSX_PORT}...`);
socket.connect(PSX_PORT, PSX_HOST); 