# PSX-Connect

A Node.js client for connecting to the Pakistan Stock Exchange (PSX) FIX Protocol server.

## Prerequisites

- Node.js 18.x or later
- npm or yarn package manager
- Network access to the PSX FIX server (172.21.101.36:8016)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/psx-connect.git
cd psx-connect

# Install dependencies
npm install
```

## Configuration

The application uses the following configuration:

- **Host**: 172.21.101.36
- **Port**: 8016
- **SenderCompID**: realtime
- **TargetCompID**: NMDUFISQ0001
- **User**: realtime
- **Password**: NMDUFISQ0001
- **BeginString**: FIXT.1.1
- **DefaultApplVerID**: FIX.5.0SP2

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