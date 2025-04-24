#!/bin/bash

# PSX-Connect startup script
# This script starts the PSX-Connect application after checking the VPN connection

set -e  # Exit on any error

# Configuration
NODE_ENV=${NODE_ENV:-"production"}
export NODE_ENV

# Banner
echo "==============================================="
echo "            PSX-Connect Starter                "
echo "==============================================="
echo "Starting PSX-Connect with VPN integration..."

# Check if we need sudo access for VPN
if [ "$EUID" -ne 0 ]; then
  echo "This script may need sudo access to establish VPN connections."
  echo "Please enter your password if prompted."
  # Cache credentials by running a simple sudo command
  sudo echo "Sudo access granted" || { echo "Failed to get sudo access. VPN may not work correctly."; }
fi

# Set up log file
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/psx-connect-$(date +%Y%m%d-%H%M%S).log"
touch "$LOG_FILE"

# Ensure the vpn file exists
if [ ! -f "vpn" ]; then
  echo "VPN configuration file not found. Creating a default one..."
  cat > vpn << EOF
host 172.16.73.18
pass Yasir01
FFU60017

client 172.31.101.35
dtls rsa_aes_256_sha1

email 172.21.105.35


local address:
172.21.101.35
mask 255.255.255.224
gw 172.21.101.33
EOF
  echo "Default VPN configuration created. Please edit the 'vpn' file with your actual credentials."
fi

# Make scripts executable
chmod +x connect-vpn.sh connect-vpn-direct.sh check-vpn.sh 2>/dev/null || true

echo "Starting PSX-Connect..."
echo "Log file: $LOG_FILE"

# Run the application
if command -v node &> /dev/null; then
  node dist/index.js | tee -a "$LOG_FILE"
else
  echo "Node.js not found. Please install Node.js."
  exit 1
fi 