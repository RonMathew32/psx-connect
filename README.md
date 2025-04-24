# PSX-Connect

FIX Protocol implementation for Pakistan Stock Exchange in Node.js with VPN support.

## Overview

PSX-Connect provides a FIX protocol implementation for connecting to the Pakistan Stock Exchange (PSX) trading system. It includes built-in VPN connectivity to securely connect to the PSX network.

This application is designed to work similarly to the `fn-psx` implementation, but implemented in TypeScript/Node.js rather than Go.

## Features

- **Automatic VPN Management**: Establishes and monitors VPN connections
- **FIX Protocol Support**: Implements the FIX protocol for communication with PSX
- **Connection Management**: Automatic reconnection and recovery
- **Logging**: Comprehensive logging with notifications
- **TypeScript Implementation**: Type-safe and maintainable code

## Prerequisites

- Node.js 14.x or later
- npm or yarn
- sudo access (for VPN connectivity)
- OpenConnect VPN client

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/psx-connect.git
   cd psx-connect
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the TypeScript code:
   ```
   npm run build
   ```

## Configuration

### VPN Configuration

VPN details are stored in the `vpn` file in the root directory. The file contains connection parameters in a simple format:

```
host 172.16.73.18
pass YourPassword
FFU60017

client 172.31.101.35
dtls rsa_aes_256_sha1

email your.email@example.com

local address:
172.21.101.35
mask 255.255.255.224
gw 172.21.101.33
```

Make sure to update this file with your actual VPN credentials.

### Application Configuration

Create a `.env` file in the root directory with the following parameters:

```
# PSX Server Configuration
PSX_HOST=172.21.101.36
PSX_PORT=8016
SENDER_COMP_ID=realtime
TARGET_COMP_ID=NMDUFISQ0001
FIX_USERNAME=realtime
FIX_PASSWORD=NMDUFISQ0001

# VPN Configuration
VPN_SERVER=172.16.73.18
VPN_USERNAME=your_username

# Logging
LOG_LEVEL=info
```

## Usage

### Starting the Application

Run the start script to automatically establish the VPN connection and start the application:

```
./start.sh
```

This script will:
1. Check for sudo access (needed for VPN)
2. Verify the VPN configuration file exists
3. Make required scripts executable
4. Start the application with proper logging

### Manual Operation

If you want to handle the VPN connection separately:

1. Connect to VPN:
   ```
   ./connect-vpn-direct.sh
   ```

2. Start the application:
   ```
   npm start
   ```

### Checking VPN Connection

To check if the VPN is properly connected:

```
./check-vpn.sh
```

## Logs and Notifications

The application creates several log files in the `logs` directory:

- `psx-connect.log`: Main application log
- `error.log`: Error-level messages only
- `notifications.log`: Important notifications
- `exceptions.log`: Unexpected exceptions
- `rejections.log`: Unhandled promise rejections

## Troubleshooting

If you encounter issues connecting to PSX:

1. Check if VPN is connected:
   ```
   ./check-vpn.sh
   ```

2. Test direct connectivity to PSX server:
   ```
   node test-connection.js
   ```

3. Check the logs for error messages:
   ```
   tail -f logs/error.log
   ```

## License

[MIT License](LICENSE)

## Acknowledgements

- Based on the `fn-psx` design
- Uses the FIX protocol for financial data exchange

## Directory Structure

- `src/fix/` - FIX protocol client implementation
- `src/examples/` - Example scripts demonstrating usage
- `pkf-log/` - Log directory for application logs
- `pkf-store/` - Storage directory for market data snapshots

## Running the Application

```bash
# Build the TypeScript code
npm run build

# Run the PSX connection test example
npm run test-psx
```

## Troubleshooting

If you're experiencing connection issues with the PSX FIX server, try the following troubleshooting steps:

### 1. Run the Test Connection Script

```bash
./test-psx-connection.sh
```

This script will attempt to connect to the PSX FIX server and log the results.

### 2. Check Network Connectivity

Ensure you have network access to the PSX FIX server:

```bash
nc -zv 172.21.101.36 8016
```

If this fails, you may need to:
- Connect to the correct VPN
- Check firewall settings
- Verify the server is running

### 3. Inspect the FIX Protocol Messages

Run the connection test with packet capture to see the exact messages being sent:

```bash
./test-psx-connection-with-wireshark.sh
```

This will create a packet capture file that can be analyzed with Wireshark.

### 4. Try a Raw FIX Message

Test sending a raw FIX message to isolate Node.js implementation issues:

```bash
./test-raw-fix.sh
```

### 5. Check Server Logs

If you have access to the server, check its logs for any rejection messages:

```bash
./check-server-logs.sh
```

### 6. Common Issues

- **Message format errors**: Ensure your FIX messages follow the correct format with proper checksums
- **Authentication failures**: Verify SenderCompID, TargetCompID, username, and password
- **Sequence number issues**: Check if the server expects a specific sequence number
- **Heartbeat timing**: Make sure heartbeats are being sent within the expected interval

## Logging

- **Debug logging**: Set `DEBUG=*` and `LOG_LEVEL=debug` environment variables
- **Log files**: Check the `pkf-log` directory for application logs

## License

MIT

## Features

- Connects to PSX Market Data Gateway (MDGW) using FIX Protocol
- Manages authentication, heartbeats, and connection state
- Handles market data requests and responses
- Processes security lists
- Monitors trading session status
- Provides an event-based interface for easy integration

## Example Code

```typescript
import { FixClient } from './fix/fix-client';
import { MDEntryType, SubscriptionRequestType } from './fix/constants';

// Create and configure the client
const client = new FixClient({
  host: '172.21.101.36',
  port: 8016,
  senderCompId: 'your_sender_id',
  targetCompId: 'NMDUFISQ0001',
  username: 'your_username',
  password: 'your_password',
  heartbeatIntervalSecs: 30
});

// Listen for events
client.on('connected', () => {
  console.log('Connected to PSX');
});

client.on('logon', () => {
  console.log('Logged in successfully');
  
  // Request market data for specific symbols
  client.sendMarketDataRequest(
    ['OGDC', 'PPL', 'FFC'], // symbols
    [MDEntryType.BID, MDEntryType.OFFER], // entry types
    SubscriptionRequestType.SNAPSHOT_PLUS_UPDATES,
    0 // market depth
  );
});

client.on('marketData', (data) => {
  console.log('Received market data:', data);
});

// Start the client
client.start();
```

## FIX Protocol Details

This library implements the following FIX message types:

| Message Type | Code | Description |
|--------------|------|-------------|
| Logon | A | Initiates a FIX session |
| Logout | 5 | Terminates a FIX session |
| Heartbeat | 0 | Keeps the connection alive |
| TestRequest | 1 | Tests connection status |
| MarketDataRequest | V | Requests market data |
| SecurityListRequest | x | Requests list of securities |
| TradingSessionStatusRequest | g | Requests trading session status |

## Contributors

- Your Name <your.email@example.com> 