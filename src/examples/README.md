# PSX Connect Examples

This directory contains examples for using the PSX Connect library to interact with the Pakistan Stock Exchange (PSX) using the FIX protocol.

## Trading Session Status Examples

We provide two examples for getting trading session status from PSX:

1. **get-trading-session-status.ts**: The standard implementation that automatically requests the trading session status after login
2. **manual-trading-session-status.ts**: An enhanced version with additional debugging and fallback mechanisms for handling PSX-specific implementations

### Configuration

Before running the examples, you need to create a `.env` file in the root of the project with the following information:

```
# PSX FIX Connection Details
PSX_HOST=<server_ip_address>
PSX_PORT=<server_port>
PSX_SENDER_COMP_ID=<your_sender_id>
PSX_TARGET_COMP_ID=<target_comp_id>
PSX_USERNAME=<your_username>
PSX_PASSWORD=<your_password>
```

Replace the placeholders with your actual PSX connection details.

### Running the Examples

To run the standard trading session status example:

```bash
npm run trading-status
```

To run the enhanced debugging version with fallback mechanisms:

```bash
npm run manual-trading-status
```

### Troubleshooting Undefined Data

If you're getting undefined data in the trading session status response, try the following:

1. **Use the manual example**: The `manual-trading-session-status.ts` example provides more detailed logging and fallback mechanisms.

2. **Check raw messages**: Both examples now log the raw FIX messages, which can help identify how PSX is formatting its responses.

3. **Check for non-standard field tags**: Some exchanges use non-standard field tags or positions for the standard FIX fields. The manual example tries to handle various alternative tags.

4. **Connection issues**: Make sure your connection details are correct and that you have proper authorization to request trading session status.

5. **Look at server logs**: If possible, check server-side logs to see if your request is being received and processed.

### Understanding the Response

The trading session status response will include:

- **Session ID**: The ID of the trading session (e.g., 'REG' for regular trading)
- **Status**: A numeric code indicating the session status
- **Start Time**: The start time of the session
- **End Time**: The end time of the session

The status codes are interpreted as follows:

| Status Code | Meaning      |
|-------------|--------------|
| 1           | Halted       |
| 2           | Open         |
| 3           | Closed       |
| 4           | Pre-Open     |
| 5           | Pre-Close    |
| 6           | Request Rejected |

This information is useful for understanding the current state of the market and determining whether trading is possible. 