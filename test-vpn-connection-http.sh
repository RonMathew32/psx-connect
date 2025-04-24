#!/bin/bash

# Alternate script to test VPN connection to PSX server using HTTP protocol
# The 404 error might be because we're trying to use HTTPS when the server expects HTTP

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

# Try direct connection to the server using the http:// protocol
echo "Connecting to PSX VPN server using HTTP protocol..."
echo "Using username: ${USERNAME}, authgroup: PSX-Staff, password: ${PASSWORD}"
echo "Press Ctrl+C to stop the connection when testing is complete"

# Execute OpenConnect with minimal parameters and http:// protocol
echo "First trying http://172.16.73.18 ..."
echo "${PASSWORD}" | sudo openconnect --user="${USERNAME}" --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  http://172.16.73.18 