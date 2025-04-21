# PSX Connect

A Node.js implementation for connecting to the Pakistan Stock Exchange (PSX) using the FIX Protocol.

## Features

- Connects to PSX Market Data Gateway (MDGW) using FIX Protocol
- Manages authentication, heartbeats, and connection state
- Handles market data requests and responses
- Processes security lists
- Monitors trading session status
- Provides an event-based interface for easy integration

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/psx-connect.git
cd psx-connect

# Install dependencies
npm install

# Create .env file from the example
cp .env.example .env

# Edit the .env file with your PSX credentials
nano .env
```

## Configuration

Edit the `.env` file with your PSX connection details:

```
# FIX Protocol Connection Settings
FIX_HOST=172.21.101.36
FIX_PORT=8016
FIX_SENDER=your_sender_id
FIX_TARGET=NMDUFISQ0001
FIX_HEARTBEAT_INTERVAL=30
FIX_VERSION=FIXT.1.1
FIX_DEFAULT_APPL_VER_ID=9

# Logging Settings
LOG_LEVEL=info
LOG_FILE_PATH=logs/psx-connect.log
```

## Usage

```bash
# Build the project
npm run build

# Start the application
npm start

# For development with auto-reload
npm run dev
```

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

## License

MIT

## Contributors

- Your Name <your.email@example.com> 