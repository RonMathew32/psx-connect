#!/bin/bash

# Direct VPN Connection Script for PSX
# This script connects to the PSX VPN the same way fn-psx does

set -e  # Exit on any error

# Configuration
VPN_SERVER=${VPN_SERVER:-"172.21.101.36"}
VPN_USERNAME=${VPN_USERNAME:-"$(whoami)"}
VPN_PASSWORD_FILE=${VPN_PASSWORD_FILE:-"$HOME/.psx-vpn-password"}
VPN_ROUTES="172.21.101.0/24"  # Routes for vpn-slice

echo "Starting direct VPN connection to $VPN_SERVER using fn-psx approach"

# Check if openconnect exists
if ! command -v openconnect >/dev/null; then
    echo "OpenConnect is not installed. Installing with brew..."
    brew install openconnect || { echo "Failed to install openconnect"; exit 1; }
fi

# Check if password file exists
if [ ! -f "$VPN_PASSWORD_FILE" ]; then
    echo "VPN password file not found at $VPN_PASSWORD_FILE"
    echo "Please enter your VPN password:"
    read -s VPN_PASSWORD
    echo "$VPN_PASSWORD" > "$VPN_PASSWORD_FILE"
    chmod 600 "$VPN_PASSWORD_FILE"
    echo "Password file created"
else
    # Make sure permission is secure
    chmod 600 "$VPN_PASSWORD_FILE"
    echo "Using existing password file at $VPN_PASSWORD_FILE"
fi

# Get the password from file
PASSWORD=$(cat "$VPN_PASSWORD_FILE")

# Simple approach - no vpn-slice, just direct connection
echo "Connecting directly to VPN..."
echo "$PASSWORD" | sudo openconnect --background \
    --passwd-on-stdin \
    --user="$VPN_USERNAME" \
    "$VPN_SERVER"

# Check if connection was successful
sleep 3
if ip link show tun0 >/dev/null 2>&1 || ifconfig tun0 >/dev/null 2>&1; then
    echo "VPN connection established successfully."
    exit 0
else
    echo "Failed to establish VPN connection."
    exit 1
fi 