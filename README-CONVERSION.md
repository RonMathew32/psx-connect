# PSX-Connect Class to Functional Conversion

This project has been converted from a class-based architecture to a functional one. This README explains the key changes made and how to use the new functional approach.

## Changes Made

1. **VPN Checker**
   - Converted `VpnChecker` class to individual exported utility functions
   - Removed the singleton pattern in favor of pure functions
   - All VPN-related functionality is now exposed as top-level functions

2. **FIX Client**
   - Converted `FixClient` class to a function factory pattern with `createFixClient()`
   - Client now returns an object with methods rather than being instantiated as a class
   - Internal state is managed through closures instead of class properties

## How to Use the New API

### VPN Utilities

```typescript
import * as vpnUtils from './utils/vpn-check';

// Check if VPN is active
const isActive = await vpnUtils.isVpnActive();

// Ensure VPN connection (will try to connect if not active)
const isConnected = await vpnUtils.ensureVpnConnection();

// Connect to VPN explicitly
await vpnUtils.connectToVpn();

// Test connectivity to PSX server
const hasConnectivity = await vpnUtils.testPsxConnectivity();
```

### FIX Client

```typescript
import { createFixClient, FixClientOptions } from './fix/fix-client';

// Create client options
const fixOptions: FixClientOptions = {
  host: '172.21.101.36',
  port: 8016,
  senderCompId: 'realtime',
  targetCompId: 'NMDUFISQ0001',
  username: 'realtime',
  password: 'password123',
  heartbeatIntervalSecs: 30
};

// Create the client instance
const fixClient = createFixClient(fixOptions);

// Register event handlers
fixClient.on('connected', () => {
  console.log('TCP connection established');
});

fixClient.on('logon', () => {
  console.log('Successfully logged in');
});

// Connect to FIX server
await fixClient.connect();

// Send requests
fixClient.sendMarketDataRequest(['AAPL', 'MSFT'], ['0', '1'], 'V', 1);

// Disconnect when done
await fixClient.disconnect();
```

## Benefits of the Functional Approach

1. **Easier Testing** - Pure functions are simpler to test in isolation
2. **Reduced State Complexity** - State management is more explicit
3. **Better Reusability** - Functions can be composed and reused more easily
4. **Modern React Compatibility** - Aligns with React hooks and functional component patterns

## Implementation Notes

The conversion was done while maintaining the same external API behaviors. The application should function identically to the class-based version, but with a more functional architecture. 