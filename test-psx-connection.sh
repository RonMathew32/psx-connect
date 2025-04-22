#!/bin/bash

# Set debug environment variables
export DEBUG=*
export LOG_LEVEL=debug

# Create logs and store directories if they don't exist
mkdir -p pkf-log
mkdir -p pkf-store

# Clean up old log files
rm -f pkf-log/*.log

# Test basic connectivity to the server
echo "Testing basic connectivity to PSX server..."
nc -zv 172.21.101.36 8016 || {
  echo "Cannot connect to PSX server at 172.21.101.36:8016"
  echo "Please ensure you're connected to the VPN and the server is accessible."
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

# Check exit status
if [ $? -eq 0 ]; then
  echo "Test completed. Check pkf-log/ directory for detailed logs."
else
  echo "Test failed. Please check the error messages in pkf-log/ directory."
  echo "Most recent errors:"
  tail -n 20 pkf-log/error.log
fi 