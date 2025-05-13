/**
 * Direct script to send security list requests with fixed sequence number 2
 * This bypasses any sequence number tracking in the client
 */
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const SOH = String.fromCharCode(1);

// FIX connection parameters
const config = {
  host: 'ip-90-0-209-72.ip.secureserver.net',
  port: 9877,
  senderCompId: 'realtime',
  targetCompId: 'NMDUFISQ0001',
  username: 'realtime',
  password: 'realtime'
};

// Create TCP socket
const socket = new net.Socket();
socket.setKeepAlive(true);
socket.setNoDelay(true);

// Track connection state
let connected = false;
let loggedIn = false;

// Setup event handlers
socket.on('connect', () => {
  console.log(`Connected to ${config.host}:${config.port}`);
  connected = true;
  
  // Send logon message after connection is established
  setTimeout(sendLogon, 500);
});

socket.on('data', (data) => {
  const message = data.toString();
  console.log(`\nReceived: ${message.replace(/\x01/g, '|')}`);
  
  // Check if this is a logon acknowledgment
  if (message.includes('35=A') && !loggedIn) {
    console.log('Received logon acknowledgment');
    loggedIn = true;
    
    // Wait 3 seconds, then send equity security list request
    setTimeout(sendEquitySecurityListRequest, 3000);
  }
  
  // Check if this is a security list
  if (message.includes('35=y')) {
    console.log('Received security list response!');
    
    // Wait 5 seconds, then send index security list request
    setTimeout(sendIndexSecurityListRequest, 5000);
  }
  
  // Check for logout or reject messages
  if (message.includes('35=5') || message.includes('35=3')) {
    console.log('Received logout or reject message, checking for sequence error');
    
    if (message.includes('MsgSeqNum') && message.includes('expected')) {
      console.log('Sequence number error detected, will try reconnecting');
      
      // Disconnect and reconnect
      socket.destroy();
      connected = false;
      loggedIn = false;
      
      // Wait 2 seconds before reconnecting
      setTimeout(() => {
        console.log('Reconnecting after sequence error...');
        socket.connect(config.port, config.host);
      }, 2000);
    }
  }
});

socket.on('error', (error) => {
  console.error(`Socket error: ${error.message}`);
});

socket.on('close', () => {
  console.log('Socket closed');
  connected = false;
  loggedIn = false;
});

// Function to calculate checksum
function calculateChecksum(message) {
  let sum = 0;
  for (let i = 0; i < message.length; i++) {
    sum += message.charCodeAt(i);
  }
  return (sum % 256).toString().padStart(3, '0');
}

// Build a FIX message
function buildFixMessage(type, fields) {
  // Add header fields
  const timestamp = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
  
  const messageFields = [
    `35=${type}`,              // MsgType
    `49=${config.senderCompId}`,  // SenderCompID
    `56=${config.targetCompId}`,  // TargetCompID
    `34=2`,                    // MsgSeqNum HARDCODED TO 2
    `52=${timestamp}`          // SendingTime
  ];
  
  // Add body fields
  for (const [tag, value] of Object.entries(fields)) {
    messageFields.push(`${tag}=${value}`);
  }
  
  // Join fields with SOH
  const message = messageFields.join(SOH);
  
  // Calculate checksum
  const checksumField = `10=${calculateChecksum(message + SOH)}`;
  
  // Construct full message with header and trailer
  return `8=FIXT.1.1${SOH}9=${message.length}${SOH}${message}${SOH}${checksumField}${SOH}`;
}

// Send a logon message
function sendLogon() {
  if (!connected) {
    console.error('Cannot send logon, not connected');
    return;
  }
  
  console.log('Sending logon message...');
  
  const fields = {
    '98': '0',                  // EncryptMethod
    '108': '30',                // HeartBtInt
    '141': 'Y',                 // ResetSeqNumFlag
    '553': config.username,     // Username
    '554': config.password,     // Password
    '1137': '9',                // DefaultApplVerID
    '1408': 'FIX5.00_PSX_1.00'  // DefaultCstmApplVerID
  };
  
  const message = buildFixMessage('A', fields);
  socket.write(message);
  console.log(`Sent: ${message.replace(/\x01/g, '|')}`);
}

// Send an equity security list request
function sendEquitySecurityListRequest() {
  if (!connected || !loggedIn) {
    console.error('Cannot send request, not connected or not logged in');
    return;
  }
  
  console.log('Sending EQUITY security list request...');
  
  const requestId = uuidv4();
  const fields = {
    '320': requestId,           // SecurityReqID
    '559': '0',                 // SecurityListRequestType = Symbol
    '55': 'NA',                 // Symbol = NA
    '460': '4',                 // Product = EQUITY (4)
    '336': 'REG'                // TradingSessionID = REG
  };
  
  const message = buildFixMessage('x', fields);
  socket.write(message);
  console.log(`Sent EQUITY list request: ${message.replace(/\x01/g, '|')}`);
}

// Send an index security list request
function sendIndexSecurityListRequest() {
  if (!connected || !loggedIn) {
    console.error('Cannot send request, not connected or not logged in');
    return;
  }
  
  console.log('Sending INDEX security list request...');
  
  const requestId = uuidv4();
  const fields = {
    '320': requestId,           // SecurityReqID
    '559': '0',                 // SecurityListRequestType = Symbol
    '55': 'NA',                 // Symbol = NA
    '460': '5',                 // Product = INDEX (5)
    '336': 'REG'                // TradingSessionID = REG
  };
  
  const message = buildFixMessage('x', fields);
  socket.write(message);
  console.log(`Sent INDEX list request: ${message.replace(/\x01/g, '|')}`);
}

// Connect to the server
console.log(`Connecting to ${config.host}:${config.port}...`);
socket.connect(config.port, config.host);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  socket.destroy();
  process.exit(0);
}); 