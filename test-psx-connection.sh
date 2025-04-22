#!/bin/bash

# Set debug environment variables
export DEBUG=*
export LOG_LEVEL=debug

# Create logs and store directories if they don't exist
mkdir -p logs
mkdir -p store

# Run the connection test example
echo "Running PSX connection test with debug output..."
npx ts-node src/examples/psx-connection-test.ts

# Check exit status
if [ $? -eq 0 ]; then
  echo "Test completed. Check the output above for connection status."
else
  echo "Test failed. Please check the error messages above."
fi 