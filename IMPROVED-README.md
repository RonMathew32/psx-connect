# PSX-Connect Improved Implementation

This is an improved version of the PSX-Connect library for connecting to the Pakistan Stock Exchange (PSX) using the FIX protocol. The code has been refactored to address sequence number issues and improve the reliability of security list requests.

## Key Improvements

1. **Enhanced Sequence Number Management**
   - Dedicated `SequenceManager` class to properly track and control sequence numbers
   - Special handling for security list requests that need fixed sequence number = 2
   - Ability to switch between normal mode and security list mode

2. **Improved Session State Management**
   - New `SessionManager` class to track connection state and handle FIX session lifecycle
   - Better handling of disconnections and reconnections
   - More reliable heartbeat monitoring and test request handling

3. **Specialized Security List Request Handling**
   - Dedicated `SecurityListHandler` class for handling PSX-specific security list requests
   - Proper sequence number handling for both equity and index security requests
   - Improved response parsing and error handling

4. **Better Error Recovery**
   - Enhanced reconnection logic with exponential backoff
   - Automatic sequence number reset on certain error conditions
   - Automatic retries for failed security list requests

## Usage Examples

### Basic Connection and Security List Requests

```javascript
const { createFixClient } = require('./dist/fix/fix-client');

// FIX connection parameters for PSX
const fixConfig = {
  host: 'ip-90-0-209-72.ip.secureserver.net',
  port: 9877,
  senderCompId: 'realtime',
  targetCompId: 'NMDUFISQ0001',
  username: 'realtime',
  password: 'realtime',
  heartbeatIntervalSecs: 30,
  connectTimeoutMs: 30000
};

// Create and start the client
const client = createFixClient(fixConfig);

// Handle events
client.on('connected', () => console.log('Connected to FIX server'));
client.on('logon', () => console.log('Logged in successfully'));
client.on('securityList', (securities) => {
  console.log(`Received ${securities.length} securities`);
});

// Connect to PSX
client.connect();

// Request securities after login
client.on('logon', () => {
  // Allow some time after login before sending requests
  setTimeout(() => {
    // This method properly manages sequence numbers
    client.requestSecurityList();
  }, 3000);
});
```

### Handling Sequence Number Errors

The improved client automatically handles sequence number issues, but you can also manually control sequence numbers when needed:

```javascript
// Set a specific sequence number
client.setSequenceNumber(2);

// Reset the connection and sequence numbers
client.reset();
```

### Running the Test Scripts

1. Run the improved security list test:
   ```
   node improved-security-list.js
   ```

2. Run the original test scripts for comparison:
   ```
   node test-security-list.js
   node force-security-list.js
   ```

## Implementation Details

### Sequence Manager

The `SequenceManager` class handles:
- Tracking outgoing and incoming sequence numbers
- Special mode for security list requests (using fixed sequence number 2)
- Sequence number validation and resetting

### Session Manager

The `SessionManager` class handles:
- FIX session state (DISCONNECTED, CONNECTING, CONNECTED, LOGGED_IN, etc.)
- Heartbeat monitoring and test requests
- Reconnection logic with exponential backoff

### Security List Handler

The `SecurityListHandler` class handles:
- Correctly formatted security list requests for both equities and indices
- Specialized sequence number handling for PSX's requirements
- Security list response parsing with support for different formats

## Troubleshooting

If you encounter issues with security list requests:

1. **Sequence Number Errors**
   - The client now automatically handles sequence number issues
   - For manual control, use `client.setSequenceNumber(2)` before security list requests

2. **Connection Issues**
   - Check network connectivity to the PSX server
   - Use `client.reset()` to completely reset the connection and sequence numbers

3. **No Data Received**
   - PSX may be offline or experiencing issues
   - Try using the raw, low-level approach in `force-security-list.js`

## License

This project is licensed under the MIT License - see the LICENSE file for details. 