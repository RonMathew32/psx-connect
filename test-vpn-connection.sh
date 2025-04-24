#!/bin/bash

# Simple script to test VPN connection to PSX server

# Kill any active connections
echo "Stopping any active OpenConnect sessions..."
sudo killall openconnect 2>/dev/null || true
sleep 2

# Get the password from the vpn file
if [ -f "./vpn" ]; then
  PASSWORD=$(grep "^pass " "./vpn" | cut -d' ' -f2)
  echo "Found password in vpn file"
else
  PASSWORD="Yasir01"
  echo "Using default password"
fi

# Try direct connection to the server
echo "Connecting to PSX VPN server at 172.16.73.18..."
echo "Using PSX-Staff authgroup and password: ${PASSWORD}"
echo "Press Ctrl+C to stop the connection when testing is complete"

# Execute OpenConnect with minimal parameters
echo "${PASSWORD}" | sudo openconnect --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18 