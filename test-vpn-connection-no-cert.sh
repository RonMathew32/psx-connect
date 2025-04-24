#!/bin/bash

# Test script without certificate pinning
# Sometimes certificate issues can cause 404 errors with OpenConnect

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

# Set username explicitly
USERNAME="fn"

# Try direct connection without certificate pinning
echo "Connecting to PSX VPN server WITHOUT certificate pinning..."
echo "Using username: ${USERNAME}, authgroup: PSX-Staff, password: ${PASSWORD}"
echo "Press Ctrl+C to stop the connection when testing is complete"

# Execute OpenConnect without certificate pinning
echo "${PASSWORD}" | sudo openconnect --user="${USERNAME}" --authgroup=PSX-Staff \
  --no-cert-check \
  172.16.73.18 