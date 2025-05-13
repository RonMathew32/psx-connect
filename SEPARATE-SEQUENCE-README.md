# PSX-Connect with Separate Sequence Numbers for Security Lists

This modified version of PSX-Connect implements completely separate sequence number tracking for security list requests, addressing the specific requirements of the Pakistan Stock Exchange (PSX) FIX protocol implementation.

## The Problem

The PSX FIX server requires security list requests to use a fixed sequence number of 2, regardless of other message sequence numbers in the session. This creates conflicts with normal FIX messaging which maintains a single incrementing sequence counter.

## The Solution

This implementation:

1. **Completely separates sequence number tracking**
   - Normal FIX messages use one sequence number stream (starting at 1 and incrementing)
   - Security list requests use a separate stream fixed at sequence number 2
   - Each stream has its own incoming and outgoing sequence counters

2. **Automatic mode switching**
   - The system automatically enters "security list mode" when sending security list requests
   - When not in security list mode, normal sequence numbers are used
   - The system tracks which mode it's in to correctly interpret server responses

3. **Independent error recovery**
   - Sequence number errors for security lists only reset the security list sequence numbers
   - Errors in the normal message flow don't affect security list functionality

## Key Components

### SequenceManager

The `SequenceManager` class has been enhanced to:

- Maintain two separate sets of sequence numbers
- Track which sequence number stream is active
- Provide methods to explicitly manage each stream independently

```typescript
// Example of separate sequence numbers
sequenceManager.getState();
// Returns:
// {
//   regular: { outgoing: 5, incoming: 4 },
//   securityList: { outgoing: 2, incoming: 1 },
//   inSecurityListMode: false
// }
```

### SecurityListHandler

The `SecurityListHandler` now:

- Uses the dedicated security list sequence numbers
- Ensures security list requests always use sequence number 2
- Handles responses in the correct sequence number context

## Usage

### Running the Example Script

The `separate-security-list.js` script demonstrates the separate sequence number functionality:

```bash
node separate-security-list.js
```

This script:
1. Connects to the PSX server
2. Sends security list requests using the dedicated sequence number (always 2)
3. In parallel, sends normal market data requests using the regular sequence numbers
4. Shows how errors in one stream don't affect the other

### Using in Your Code

```javascript
const { createFixClient } = require('./dist/fix/fix-client');

const client = createFixClient({
  // connection configuration
});

// Normal market data request (uses regular sequence numbers)
client.sendMarketDataRequest(['KSE100', 'LUCK']);

// Security list request (uses dedicated sequence numbers)
client.requestSecurityList();

// Explicitly control sequence numbers when needed
client.setSecurityListSequenceNumbers(2, 1);
```

## Key API Methods

- `client.requestSecurityList()` - Automatically uses the security list sequence numbers
- `client.setSecurityListSequenceNumbers(outgoing, incoming)` - Explicitly sets the security list sequence numbers
- `client.setSequenceNumber(num)` - Sets the sequence number for the current mode (normal or security list)
- `client.reset()` - Resets all sequence numbers and the connection

## Error Handling

The system intelligently handles sequence number errors:

1. **For security list sequence errors**:
   ```javascript
   client.setSecurityListSequenceNumbers(2, 1);
   ```

2. **For normal sequence errors**:
   ```javascript
   client.reset();
   ```

## Implementation Details

The separation of sequence numbers is achieved by:

1. Maintaining separate counter variables for each stream
2. Using a mode flag to determine which stream to use
3. Inspecting message types to determine which stream a response belongs to

This approach allows the system to maintain proper sequence numbers for both security list requests and normal FIX messaging concurrently, without one affecting the other.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 