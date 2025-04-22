#!/bin/bash

# This script tests the PSX connection with network packet capture
# to see exactly what data is being sent and received

echo "This script requires root/sudo privileges to capture network traffic"

# Create logs and store directories if they don't exist
mkdir -p pkf-log
mkdir -p pkf-store

# Clean up old log files
rm -f pkf-log/*.log

# Start tcpdump to capture FIX traffic if available
TCPDUMP_PATH=$(which tcpdump 2>/dev/null)
PCAP_FILE="pkf-log/fix-traffic-$(date +%Y%m%d-%H%M%S).pcap"

if [ -n "$TCPDUMP_PATH" ]; then
  echo "Starting packet capture with tcpdump..."
  sudo tcpdump -i any -w "$PCAP_FILE" "host 172.21.101.36 and port 8016" &
  TCPDUMP_PID=$!
  # Give tcpdump a moment to start
  sleep 1
else
  echo "tcpdump not found - packet capture disabled"
  TCPDUMP_PID=""
fi

# Set debug environment variables
export DEBUG=*
export LOG_LEVEL=debug

# Test basic connectivity to the server
echo "Testing basic connectivity to PSX server..."
nc -zv 172.21.101.36 8016 || {
  echo "Cannot connect to PSX server at 172.21.101.36:8016"
  echo "Please ensure you're connected to the VPN and the server is accessible."
  
  # Cleanup tcpdump if it's running
  if [ -n "$TCPDUMP_PID" ]; then
    sudo kill -TERM $TCPDUMP_PID
    echo "Packet capture saved to $PCAP_FILE"
  fi
  
  exit 1
}

# Display network info
echo "Network information:"
echo "-------------------"
echo "Local IP: $(hostname -I | awk '{print $1}')"
echo "Route to PSX:"
ip route get 172.21.101.36 | head -n 1
echo "-------------------"

# Run the connection test example
echo "Running PSX connection test with debug output..."
echo "Press Ctrl+C after 30 seconds to stop the test"
npx ts-node src/examples/psx-connection-test.ts 2>&1 | tee pkf-log/connection-test.log

# Stop packet capture
if [ -n "$TCPDUMP_PID" ]; then
  echo "Stopping packet capture..."
  sudo kill -TERM $TCPDUMP_PID
  
  # Wait for tcpdump to finish writing
  sleep 2
  
  echo "Packet capture saved to $PCAP_FILE"
  echo "You can analyze this file with Wireshark to see the exact FIX messages sent and received"
fi

# Check the logs
echo "Checking logs for error messages..."
if [ -f "pkf-log/error.log" ]; then
  echo "Error log contents:"
  cat pkf-log/error.log
else
  echo "No error log found"
fi

# Provide instructions for next steps
echo ""
echo "Test completed. If the connection failed, try these troubleshooting steps:"
echo "1. Check the packet capture with Wireshark to see exact protocol details"
echo "2. Verify that the PSX server is running and accepting connections"
echo "3. Try the raw FIX test script: ./test-raw-fix.sh"
echo "4. Check server logs for any rejection messages: ./check-server-logs.sh" 