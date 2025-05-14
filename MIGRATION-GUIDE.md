# Migration Guide to Optimized PSX Connect Implementation

This guide explains how to migrate from the original PSX Connect FIX client implementation to the optimized version. The optimized version offers better performance, more robust error handling, and improved code organization.

## 1. File Renaming and Updates

First, rename the optimized files to replace the original files:

```bash
# Backup original files
mv src/fix/fix-client.ts src/fix/fix-client.ts.bak
mv src/fix/message-builder.ts src/fix/message-builder.ts.bak
mv src/fix/message-parser.ts src/fix/message-parser.ts.bak
mv src/fix/fix-parser.ts src/fix/fix-parser.ts.bak
mv src/index.ts src/index.ts.bak

# Move optimized files into place
mv src/fix/fix-client-refactored.ts src/fix/fix-client.ts
mv src/fix/message-builder-optimized.ts src/fix/message-builder.ts
mv src/fix/message-parser-optimized.ts src/fix/message-parser.ts
mv src/fix/fix-parser-optimized.ts src/fix/fix-parser.ts
mv src/index-optimized.ts src/index.ts
```

## 2. API Changes

The optimized implementation maintains the same public API as the original version, but with a few minor differences:

### Added Methods

- `getStatus()`: Returns the current status of the FIX client, including connection state and sequence numbers

### Changed Parameters

- `sendTradingSessionStatusRequest()`: No longer takes a `tradingSessionID` parameter, as it always uses 'REG'

### Improved Event Handling

- More reliable event emission
- Additional `messageSent` event for debugging purposes

## 3. Update Import Statements

If you have code that imports from these files directly, update the import statements:

```typescript
// Before
import { parseFixMessage } from './fix/message-parser';

// After - no change needed if you followed the file renaming steps
import { parseFixMessage } from './fix/message-parser';
```

## 4. Configuration Updates

The configuration object remains compatible with the original implementation. However, for better performance, consider adding these configuration options:

```typescript
const config: FixClientOptions = {
  // Existing options
  host: 'example.com',
  port: 8016,
  senderCompId: 'client',
  targetCompId: 'server',
  username: 'user',
  password: 'pass',
  heartbeatIntervalSecs: 30,
  
  // New/optimized options
  connectTimeoutMs: 30000,     // Connection timeout in milliseconds
  resetOnLogon: true,          // Reset sequence numbers on logon
};
```

## 5. Testing the Migration

After migration, test the following key functionality:

1. **Connection and Authentication**
   - Verify connection to FIX server
   - Verify successful logon/logout

2. **Market Data**
   - Request and receive market data
   - Test incremental updates

3. **Security Lists**
   - Request security lists
   - Verify parsing of security information

4. **Error Handling**
   - Test disconnection and reconnection
   - Test sequence number recovery

## 6. Performance Monitoring

Monitor the performance improvements after migration:

1. **Memory Usage**
   - Check reduced memory allocations
   - Monitor for memory leaks

2. **CPU Usage**
   - Lower CPU utilization expected
   - Faster message processing

3. **Latency**
   - Reduced latency for message processing
   - Faster response to market data requests

## 7. Logging Changes

The optimized implementation includes more structured logging. You may see different log formats and levels:

- `[SESSION]` - Session management logs
- `[SEQUENCE]` - Sequence number management logs
- `[MARKET_DATA]` - Market data handling logs
- `[SECURITY_LIST]` - Security list handling logs

## 8. Troubleshooting

If you encounter issues after migration:

1. **Connection Issues**
   - Check FIX server connection parameters
   - Review session management logs

2. **Sequence Number Problems**
   - The new implementation should handle these automatically
   - Check sequence manager logs

3. **Message Parsing Errors**
   - Review the structure of problematic messages
   - Ensure compatibility with PSX FIX format

## 9. Rollback Procedure

If necessary, you can roll back to the original implementation:

```bash
# Restore original files
mv src/fix/fix-client.ts.bak src/fix/fix-client.ts
mv src/fix/message-builder.ts.bak src/fix/message-builder.ts
mv src/fix/message-parser.ts.bak src/fix/message-parser.ts
mv src/fix/fix-parser.ts.bak src/fix/fix-parser.ts
mv src/index.ts.bak src/index.ts
```

## 10. Contact and Support

For questions or issues with the optimized implementation, please contact the development team.

---

## Benefits Summary

- **Performance**: Faster message processing and reduced resource usage
- **Robustness**: Improved error handling and recovery
- **Maintainability**: Better code organization and separation of concerns
- **Scalability**: More efficient handling of high message volumes 