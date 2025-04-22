const net = require('net');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  host: '172.21.101.36',
  port: 8016,
  senderCompId: 'realtime',
  targetCompId: 'NMDUFISQ0001',
  username: 'realtime',
  password: 'NMDUFISQ0001',
  heartbeatIntervalSecs: 30
};

// Constants
const SOH = String.fromCharCode(1); // ASCII code 1 (Start of Heading)

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'raw-logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file
const logFile = path.join(logsDir, `raw-fix-test-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Logging function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}`;
  console.log(logMessage);
  logStream.write(logMessage + '\n');
}

// Format timestamp for FIX message
function formatTimestamp() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
  return `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// Calculate checksum for a FIX message
function calculateChecksum(message) {
  let sum = 0;
  for (let i = 0; i < message.length; i++) {
    sum += message.charCodeAt(i);
  }
  return (sum % 256).toString().padStart(3, '0');
}

// Create a logon message
function createLogonMessage() {
  const timestamp = formatTimestamp();
  
  // Build the message body first
  const bodyFields = [
    `35=A${SOH}`, // MsgType (Logon)
    `34=1${SOH}`, // MsgSeqNum
    `49=${config.senderCompId}${SOH}`, // SenderCompID
    `56=${config.targetCompId}${SOH}`, // TargetCompID
    `52=${timestamp}${SOH}`, // SendingTime
    `98=0${SOH}`, // EncryptMethod
    `108=${config.heartbeatIntervalSecs}${SOH}`, // HeartBtInt
    `141=Y${SOH}`, // ResetSeqNumFlag
    `553=${config.username}${SOH}`, // Username
    `554=${config.password}${SOH}`, // Password
    `1137=9${SOH}`, // DefaultApplVerID
    `1129=FIX5.00_PSX_1.00${SOH}`, // DefaultCstmApplVerID
    `115=600${SOH}`, // OnBehalfOfCompID
    `96=kse${SOH}`, // RawData
    `95=3${SOH}` // RawDataLength
  ].join('');
  
  // Calculate body length
  const bodyLengthValue = bodyFields.replace(new RegExp(SOH, 'g'), '').length;
  
  // Construct the complete message with header
  const message = [
    `8=FIXT.1.1${SOH}`, // BeginString
    `9=${bodyLengthValue}${SOH}`, // BodyLength
    bodyFields
  ].join('');
  
  // Add the checksum
  const checksum = calculateChecksum(message);
  return message + `10=${checksum}${SOH}`;
}

// Connect to the server
log(`Connecting to ${config.host}:${config.port}...`);
const socket = net.createConnection({
  host: config.host,
  port: config.port
});

let connected = false;
let receivedData = '';
let lastActivityTime = 0;

// Set up event handlers
socket.on('connect', () => {
  connected = true;
  lastActivityTime = Date.now();
  log(`Connected to ${config.host}:${config.port}`);
  log(`Local address: ${socket.localAddress}:${socket.localPort}`);
  
  // Send logon message
  setTimeout(() => {
    const logonMessage = createLogonMessage();
    log(`Sending logon message: ${logonMessage.replace(new RegExp(SOH, 'g'), '|')}`);
    socket.write(logonMessage);
  }, 500);
});

socket.on('data', (data) => {
  lastActivityTime = Date.now();
  const dataStr = data.toString();
  log(`Received raw data (${dataStr.length} bytes): ${dataStr.replace(new RegExp(SOH, 'g'), '|')}`);
  
  receivedData += dataStr;
  
  // Process complete messages
  let endIndex;
  while ((endIndex = receivedData.indexOf(SOH + '10=')) !== -1) {
    const checksumEndIndex = receivedData.indexOf(SOH, endIndex + 1);
    if (checksumEndIndex === -1) {
      log('Found incomplete message, waiting for more data');
      break;
    }

    const completeMessage = receivedData.substring(0, checksumEndIndex + 1);
    receivedData = receivedData.substring(checksumEndIndex + 1);

    log(`Extracted complete message: ${completeMessage.replace(new RegExp(SOH, 'g'), '|')}`);
    
    // Parse message type
    const msgTypeMatch = completeMessage.match(/35=([A-Za-z0-9])/);
    if (msgTypeMatch) {
      const msgType = msgTypeMatch[1];
      log(`Message type: ${msgType}`);
      
      // Handle heartbeat with test request
      if (msgType === '1') { // Test request
        const testReqIdMatch = completeMessage.match(/112=([^${SOH}]*)/);
        if (testReqIdMatch) {
          const testReqId = testReqIdMatch[1];
          log(`Sending heartbeat response for test request: ${testReqId}`);
          
          // Send heartbeat in response to test request
          const timestamp = formatTimestamp();
          const heartbeatBody = [
            `35=0${SOH}`, // MsgType (Heartbeat)
            `34=2${SOH}`, // MsgSeqNum
            `49=${config.senderCompId}${SOH}`, // SenderCompID
            `56=${config.targetCompId}${SOH}`, // TargetCompID
            `52=${timestamp}${SOH}`, // SendingTime
            `112=${testReqId}${SOH}` // TestReqID
          ].join('');
          
          const bodyLengthValue = heartbeatBody.replace(new RegExp(SOH, 'g'), '').length;
          const heartbeatMessage = [
            `8=FIXT.1.1${SOH}`, // BeginString
            `9=${bodyLengthValue}${SOH}`, // BodyLength
            heartbeatBody
          ].join('');
          
          const checksum = calculateChecksum(heartbeatMessage);
          const finalHeartbeat = heartbeatMessage + `10=${checksum}${SOH}`;
          
          log(`Sending heartbeat: ${finalHeartbeat.replace(new RegExp(SOH, 'g'), '|')}`);
          socket.write(finalHeartbeat);
        }
      }
    }
  }
});

socket.on('error', (error) => {
  log(`Socket error: ${error.message}`);
  if (error.stack) {
    log(`Error stack: ${error.stack}`);
  }
});

socket.on('close', (hadError) => {
  log(`Socket disconnected ${hadError ? 'due to error' : 'cleanly'}`);
  connected = false;
  
  // Check if data was ever received
  if (lastActivityTime === 0) {
    log('Connection closed without any data received - server may have rejected the connection');
  }
  
  // Close log file and exit
  logStream.end();
  process.exit(hadError ? 1 : 0);
});

// Handle process termination
process.on('SIGINT', () => {
  log('Received SIGINT. Shutting down gracefully...');
  if (connected) {
    socket.destroy();
  }
  logStream.end();
  process.exit(0);
}); 