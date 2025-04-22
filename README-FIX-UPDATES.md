# PSX Connect FIX Protocol Fixes

## Issues Fixed

1. **Logon Message Format**
   - Updated the Logon message to include all required PSX-specific fields
   - Added proper field ordering based on the original Go implementation
   - Ensured correct handling of the message sequence numbers

2. **PSX-Specific Fields**
   - Added PSX-specific fields to all outgoing messages
   - Implemented fields required by the PSX server:
     - `1137=9` (DefaultApplVerID)
     - `1129=FIX5.00_PSX_1.00` (DefaultCstmApplVerID)
     - `115=600` (OnBehalfOfCompID)
     - `96=kse` (RawData)
     - `95=3` (RawDataLength)

3. **Connection Handling**
   - Improved socket connection with better timeout handling
   - Added better error detection for various connection scenarios
   - Reset sequence numbers properly on reconnect

4. **Message Processing**
   - Added better parsing and validation of incoming messages
   - Improved checksum verification
   - Better handling of incomplete messages

5. **Logging**
   - Enhanced logging to include more detailed connection and message information
   - Added rotating log files for better log management
   - Added separate error and exception logs

## Troubleshooting Connection Issues

If you're still unable to connect to the PSX FIX server, please check:

1. **Network Connectivity**
   - Ensure you can reach the PSX server at 172.21.101.36:8016
   - Try using a network diagnostic tool like `ping` or `telnet`

2. **VPN Connection**
   - Verify if a VPN connection is required to access the PSX server
   - Ensure your VPN connection is active and functioning

3. **Firewall Rules**
   - Check if there are any firewall rules blocking outgoing connections on port 8016
   - Consult with your network administrator if needed

4. **Server Status**
   - Verify with PSX that the FIX server is operational
   - Confirm your account credentials are correct

5. **Debug Using Raw FIX Test**
   - Run the raw FIX test script (`./run-raw-fix-test.sh`) for basic connectivity testing
   - Check the logs in the `raw-logs` directory for connection details

6. **Configuration Parameters**
   - Verify all connection parameters in `.env` match those provided by PSX
   - Check that your SenderCompID and TargetCompID are correctly configured

## FIX Message Structure for PSX

For reference, here is the structure of a valid logon message for PSX:

```
8=FIXT.1.1|9=145|35=A|34=1|49=realtime|56=NMDUFISQ0001|52=20250422-05:29:41.616|98=0|108=30|141=Y|553=realtime|554=NMDUFISQ0001|1137=9|1129=FIX5.00_PSX_1.00|115=600|96=kse|95=3|10=005|
```

Each outgoing message (except Logon and Logout) needs to include the PSX-specific fields. 