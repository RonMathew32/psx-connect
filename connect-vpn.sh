#!/bin/bash

# VPN Connection Script for PSX
# This script connects to the PSX VPN using vpn-slice for routing

set -e  # Exit on any error

# Configuration
VPN_SERVER=${VPN_SERVER:-"172.21.101.36"}
VPN_USERNAME=${VPN_USERNAME:-"$(whoami)"}
VPN_PASSWORD_FILE=${VPN_PASSWORD_FILE:-"$HOME/.psx-vpn-password"}
VPN_ROUTES="172.21.101.0/24"  # Routes for vpn-slice

echo "Starting VPN connection to $VPN_SERVER"

# Check if we have sudo access without asking for password
if sudo -n true 2>/dev/null; then
  echo "Sudo access verified"
else
  echo "This script requires sudo access to establish the VPN connection."
  echo "Please enter your system password when prompted."
  # Ask for password once upfront to cache credentials
  sudo echo "Sudo access granted" || { echo "Failed to get sudo access. Exiting."; exit 1; }
fi

# Find vpn-slice location
VPN_SLICE_PATH=$(which vpn-slice 2>/dev/null || echo "")

# If not found, try common locations
if [ -z "$VPN_SLICE_PATH" ]; then
  # Check common Python installation paths
  for path in \
    "/Library/Frameworks/Python.framework/Versions/3.8/bin/vpn-slice" \
    "/Library/Frameworks/Python.framework/Versions/3.9/bin/vpn-slice" \
    "/Library/Frameworks/Python.framework/Versions/3.10/bin/vpn-slice" \
    "/Library/Frameworks/Python.framework/Versions/3.11/bin/vpn-slice" \
    "$HOME/Library/Python/3.8/bin/vpn-slice" \
    "$HOME/Library/Python/3.9/bin/vpn-slice" \
    "$HOME/Library/Python/3.10/bin/vpn-slice" \
    "$HOME/Library/Python/3.11/bin/vpn-slice" \
    "/usr/local/bin/vpn-slice"
  do
    if [ -f "$path" ]; then
      VPN_SLICE_PATH="$path"
      echo "Found vpn-slice at $VPN_SLICE_PATH"
      break
    fi
  done
fi

# Install vpn-slice if not found
if [ -z "$VPN_SLICE_PATH" ]; then
  echo "vpn-slice is not installed. Installing..."
  pip3 install vpn-slice || pip install vpn-slice || { echo "Failed to install vpn-slice"; exit 1; }
  
  # Try to find it again after installation
  VPN_SLICE_PATH=$(which vpn-slice 2>/dev/null || echo "")
  
  # Check common locations again
  if [ -z "$VPN_SLICE_PATH" ]; then
    for path in \
      "/Library/Frameworks/Python.framework/Versions/3.8/bin/vpn-slice" \
      "/Library/Frameworks/Python.framework/Versions/3.9/bin/vpn-slice" \
      "/Library/Frameworks/Python.framework/Versions/3.10/bin/vpn-slice" \
      "/Library/Frameworks/Python.framework/Versions/3.11/bin/vpn-slice" \
      "$HOME/Library/Python/3.8/bin/vpn-slice" \
      "$HOME/Library/Python/3.9/bin/vpn-slice" \
      "$HOME/Library/Python/3.10/bin/vpn-slice" \
      "$HOME/Library/Python/3.11/bin/vpn-slice" \
      "/usr/local/bin/vpn-slice"
    do
      if [ -f "$path" ]; then
        VPN_SLICE_PATH="$path"
        echo "Found vpn-slice at $VPN_SLICE_PATH after installation"
        break
      fi
    done
  fi
  
  if [ -z "$VPN_SLICE_PATH" ]; then
    echo "Could not find vpn-slice after installation. Please add it to your PATH."
    exit 1
  fi
fi

# Check if password file exists and create if needed
if [ ! -f "$VPN_PASSWORD_FILE" ]; then
  echo "VPN password file not found at $VPN_PASSWORD_FILE"
  echo "Please enter your VPN password:"
  read -s VPN_PASSWORD
  echo "$VPN_PASSWORD" > "$VPN_PASSWORD_FILE"
  chmod 600 "$VPN_PASSWORD_FILE"
  echo "Password file created at $VPN_PASSWORD_FILE"
else
  echo "Using existing password file at $VPN_PASSWORD_FILE"
  # Make sure the permission is secure
  chmod 600 "$VPN_PASSWORD_FILE"
fi

# Check if openconnect is installed
if ! command -v openconnect >/dev/null; then
  echo "openconnect is not installed. Installing..."
  if command -v apt-get >/dev/null; then
    sudo apt-get update && sudo apt-get install -y openconnect
  elif command -v brew >/dev/null; then
    brew install openconnect
  else
    echo "Could not determine package manager. Please install openconnect manually."
    exit 1
  fi
fi

# Create a temporary script for vpn-slice to avoid PATH issues
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << EOF
#!/bin/bash
"$VPN_SLICE_PATH" $VPN_ROUTES
EOF
chmod +x "$TEMP_SCRIPT"

# Connect to VPN with vpn-slice for routing
echo "Connecting to VPN using vpn-slice at $VPN_SLICE_PATH for routing..."
sudo openconnect --background \
  --script "$TEMP_SCRIPT" \
  --user="$VPN_USERNAME" \
  --passwd-on-stdin \
  "$VPN_SERVER" < "$VPN_PASSWORD_FILE"

# Clean up temp script
rm -f "$TEMP_SCRIPT"

# Check if connection was successful
sleep 3
if ip link show tun0 >/dev/null 2>&1 || ifconfig tun0 >/dev/null 2>&1; then
  echo "VPN connection established successfully."
  exit 0
else
  echo "Failed to establish VPN connection."
  # Show any openconnect errors if available
  dmesg | grep -i openconnect | tail -5
  exit 1
fi