#!/bin/bash

# This is a simplified script to connect to PSX VPN directly 
# It avoids permission issues by not relying on external scripts

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

# Connect directly with OpenConnect
echo "Connecting to PSX VPN..."
echo "${PASSWORD}" | sudo openconnect --background \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  --user="fn" --authgroup="PSX-Staff" --passwd-on-stdin "172.16.73.18"

# Add route for PSX subnet manually
sleep 2
echo "Adding route for PSX subnet..."
sudo ip route add 172.16.64.0/19 dev tun0 2>/dev/null || true 

# (as root or via sudo)
sudo setcap cap_net_admin+ep $(which openconnect)
sudo setcap cap_net_admin+ep $(which ip) 