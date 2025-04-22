#!/bin/bash

# Test Raw FIX Message Script
# This script sends a raw FIX message to the PSX server to test basic connectivity
# without the complexities of the Node.js implementation

echo "===== PSX Raw FIX Protocol Connection Test ====="
echo "This script will send a raw FIX Logon message to the PSX server (172.21.101.36:8016)"
echo

# Create log directories if they don't exist
mkdir -p pkf-log
mkdir -p pkf-store

# Variables
HOST="172.21.101.36"
PORT="8016"
SENDER="realtime"
TARGET="NMDUFISQ0001"
LOGFILE="pkf-log/raw-fix-test-$(date +%Y%m%d-%H%M%S).log"

# Check if nc (netcat) is available
if ! command -v nc &> /dev/null; then
    echo "Error: netcat (nc) is not installed. Please install it and try again."
    exit 1
fi

# Test basic connectivity first
echo "Testing basic connectivity to $HOST:$PORT..."
nc -z -w 5 $HOST $PORT
if [ $? -ne 0 ]; then
    echo "Error: Cannot connect to $HOST:$PORT. Check your network connection."
    exit 1
fi
echo "Basic connectivity test successful!"
echo

# Calculate current UTC time in FIX format (YYYYMMDD-HH:MM:SS.sss)
SENDING_TIME=$(date -u +"%Y%m%d-%H:%M:%S.000")

# Construct a FIX Logon message (tag=value separated by SOH character)
# SOH is represented as a literal ^A or \x01
echo "Constructing a raw FIX Logon message..."

# Build the message without checksum and body length for now
RAW_MESSAGE="8=FIXT.1.1^A9=00000^A35=A^A34=1^A49=$SENDER^A52=$SENDING_TIME^A56=$TARGET^A98=0^A108=30^A141=Y^A1137=9^A"

# Replace the ^A with the actual SOH character
MESSAGE=$(echo -e "${RAW_MESSAGE}" | tr '^A' '\001')

# Calculate body length (excluding 8=FIXT.1.1^A9=00000^A)
BODY_LENGTH=$(echo -e "${MESSAGE}" | cut -d$'\001' -f3- | wc -c)
BODY_LENGTH=$((BODY_LENGTH - 1))  # Adjust for the extra newline

# Replace the placeholder body length
MESSAGE=$(echo -e "${MESSAGE}" | sed "s/9=00000/9=$BODY_LENGTH/")

# Calculate checksum as the sum of ASCII values of all characters modulo 256
SUM=0
for (( i=0; i<${#MESSAGE}; i++ )); do
    char="${MESSAGE:$i:1}"
    val=$(printf "%d" "'$char")
    SUM=$((SUM + val))
done
SUM=$((SUM % 256))
CHECKSUM=$(printf "%03d" $SUM)

# Add the checksum to the message
MESSAGE="${MESSAGE}10=$CHECKSUM"$'\001'

# Show the message (human-readable form)
echo "Sending FIX message (with ^A representing SOH character):"
echo "${MESSAGE}" | tr '\001' '^A'
echo

# Connect to the server and send the message
echo "Connecting to $HOST:$PORT and sending FIX message..."
echo "Output will be logged to $LOGFILE"
(echo -ne "${MESSAGE}" | nc -w 10 $HOST $PORT | hexdump -C) > $LOGFILE 2>&1

# Check if we got a response
if [ -s "$LOGFILE" ]; then
    echo "Received response from server!"
    echo "Raw response (first 200 bytes):"
    head -c 200 $LOGFILE | hexdump -C
    
    # Check if the response contains "35=A" which would indicate a Logon response
    if grep -q "35=A" $LOGFILE; then
        echo "SUCCESS: Received Logon response from server!"
    # Check if the response contains "35=5" which would indicate a Logout
    elif grep -q "35=5" $LOGFILE; then
        echo "WARNING: Received Logout message from server."
    # Check if the response contains "35=3" which would indicate a Reject
    elif grep -q "35=3" $LOGFILE; then
        echo "ERROR: Received Reject message from server."
    else
        echo "Received response, but not a recognizable FIX message type."
    fi
else
    echo "No response received from server within timeout period."
fi

echo
echo "Test completed. Full response details in $LOGFILE"
echo "You can use a FIX message analyzer to decode the full response." 