#!/bin/bash

# This script will run OpenConnect in verbose mode to show what input it's expecting
# This might help us understand the correct format for authentication

# Kill any active connections
echo "Stopping any active OpenConnect sessions..."
sudo killall openconnect 2>/dev/null || true
sleep 2

echo "Running OpenConnect in verbose mode to see what it's expecting..."
echo "This will show the prompts that OpenConnect displays"
echo "Press Ctrl+C when you've seen enough information"

# Run OpenConnect with all debugging output
sudo openconnect --verbose --dump-http-traffic \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18 