#!/bin/bash

# This script checks server logs for FIX protocol errors
# since we're seeing disconnections from the PSX server

# Locations where FIX server logs might be stored
POSSIBLE_LOG_DIRS=(
  "/var/log/fix"
  "/var/log/quickfix"
  "/var/log/psx"
  "/opt/psx/logs"
  "/usr/local/fix/logs"
  "$HOME/fixpkf-50/pkf-log"
  "./pkf-log"
)

echo "Checking for recent FIX server log files..."

# Check if we can find any FIX server logs
for dir in "${POSSIBLE_LOG_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    echo "Found log directory: $dir"
    # Look for recent log files
    find "$dir" -type f -name "*.log" -mtime -1 | while read logfile; do
      echo "Checking log file: $logfile"
      echo "Last 20 lines:"
      tail -20 "$logfile"
      echo ""
      
      # Look for errors or rejections
      echo "Searching for errors or rejections..."
      grep -i "error\|reject\|fail\|disconnect" "$logfile" | tail -10
      echo ""
    done
  fi
done

# Try to check if fixpkf-50 is running
echo "Checking if fixpkf-50 (Go implementation) is running..."
pgrep -f "fixpkf-50" > /dev/null
if [ $? -eq 0 ]; then
  echo "fixpkf-50 process is running"
  ps aux | grep "fixpkf-50" | grep -v grep
else
  echo "fixpkf-50 process is NOT running"
fi

# Check network connections
echo "Checking existing connections to FIX server..."
netstat -an | grep 172.21.101.36:8016

echo "Script completed. If you don't see any useful information above,"
echo "you may need to check with your system administrator for access to the server logs." 