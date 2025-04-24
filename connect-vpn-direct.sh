#!/bin/bash

# This script directly connects to the PSX VPN using OpenConnect and VPN-Slice
# It's a simpler alternative to the systemd service-based approach

# Source the environment for vpn-slice
if [ -f "/home/fn/vpn-slice/bin/activate" ]; then
  . /home/fn/vpn-slice/bin/activate
else
  echo "ERROR: Could not find vpn-slice Python environment"
  exit 1
fi

# Path to the PSX Connect directory
PSX_CONNECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kill any existing OpenConnect sessions
sudo killall openconnect 2>/dev/null || true
sleep 1

# Get the VPN password
if [ -f "${PSX_CONNECT_DIR}/vpn" ]; then
  PASSWORD=$(grep "^pass " "${PSX_CONNECT_DIR}/vpn" | cut -d' ' -f2)
fi

# Set a default password if none found
PASSWORD=${PASSWORD:-Yasir01}

# Use the config file if it exists
if [ -f "${PSX_CONNECT_DIR}/etc/openconnect-systemd.conf" ]; then
  echo "Using OpenConnect config file..."
  echo "${PASSWORD}" | sudo openconnect --config "${PSX_CONNECT_DIR}/etc/openconnect-systemd.conf"
else
  # Fallback to direct connection
  echo "Config file not found, using direct connection..."
  echo "${PASSWORD}" | sudo openconnect --background \
    --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
    --user="fn" --authgroup="PSX-Staff" --passwd-on-stdin "172.16.73.18" \
    --script="${PSX_CONNECT_DIR}/bin/vpns"
fi 