#!/bin/bash

# Test script that tries different ports for the OpenConnect server
# The 404 error might be because we're using the wrong port

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

# Try common VPN ports
echo "Attempting to connect to VPN on various ports..."
echo "Using password: ${PASSWORD}"
echo "Press Ctrl+C to stop at any time"

# Try port 443 (HTTPS default)
echo ""
echo "Trying port 443 (HTTPS default)..."
echo "${PASSWORD}" | sudo openconnect --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18:443

# If that fails, try port 8443 (alternate HTTPS)
echo ""
echo "Trying port 8443 (alternate HTTPS)..."
echo "${PASSWORD}" | sudo openconnect --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18:8443

# Try port 4433 (another common OpenConnect port)
echo ""
echo "Trying port 4433 (another common OpenConnect port)..."
echo "${PASSWORD}" | sudo openconnect --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18:4433

# Try port 1194 (OpenVPN)
echo ""
echo "Trying port 1194 (OpenVPN default)..."
echo "${PASSWORD}" | sudo openconnect --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18:1194 