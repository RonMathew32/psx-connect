const net = require('net');

// PSX server details from our configuration
const PSX_HOST = '172.16.67.14';
const PSX_PORT = 50067;

console.log(`Attempting to connect to PSX at ${PSX_HOST}:${PSX_PORT}...`);
console.log('This is a basic TCP connection test to check server reachability.');
console.log('This will NOT attempt to send FIX messages or authenticate.');
console.log('Press Ctrl+C to cancel at any time.\n');

// Create connection with timeout
const socket = net.createConnection({
  host: PSX_HOST,
  port: PSX_PORT,
  timeout: 10000 // 10 second timeout
});

// Handle successful connection
socket.on('connect', () => {
  console.log('✅ SUCCESS! TCP connection established to PSX server.');
  console.log(`Connected to ${PSX_HOST}:${PSX_PORT}`);
  console.log(`Local address: ${socket.localAddress}:${socket.localPort}`);
  console.log('\nPSX server is reachable and accepting connections.');
  console.log('You should be able to authenticate if your FIX credentials are correct.');
  
  // Close the connection after successful test
  socket.end();
  setTimeout(() => process.exit(0), 500);
});

// Handle connection error
socket.on('error', (err) => {
  console.error('❌ ERROR: Failed to connect to PSX server.');
  
  if (err.code === 'ECONNREFUSED') {
    console.error('   Connection refused - PSX server not accepting connections.');
    console.error('   This usually means:');
    console.error('   1. You are not connected to the VPN, or');
    console.error('   2. The PSX server is down, or');
    console.error('   3. The firewall is blocking the connection.');
  } else if (err.code === 'ETIMEDOUT') {
    console.error('   Connection timed out - no response from PSX server.');
    console.error('   This usually means:');
    console.error('   1. You are not connected to the VPN, or');
    console.error('   2. The network path to PSX is blocked.');
  } else {
    console.error(`   Error details: ${err.code} - ${err.message}`);
  }
  
  process.exit(1);
});

// Handle connection timeout
socket.on('timeout', () => {
  console.error('❌ ERROR: Connection timed out while waiting for PSX server.');
  console.error('   The server did not respond within the timeout period (10 seconds).');
  console.error('   Make sure you are connected to the correct VPN and try again.');
  
  socket.destroy();
  process.exit(1);
});

console.log('Connecting...'); 