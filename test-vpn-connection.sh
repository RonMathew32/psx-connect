#!/bin/bash

# Script to test VPN connection with verbose output
# This helps debug connection issues

# Configuration
VPN_SERVER=${VPN_SERVER:-"172.21.101.36"}
VPN_USERNAME=${VPN_USERNAME:-"$(whoami)"}
VPN_PASSWORD_FILE=${VPN_PASSWORD_FILE:-"$HOME/.psx-vpn-password"}
VPN_CERT_BYPASS="--servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY="

# Create logs directory if it doesn't exist
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/vpn-test-$(date +%Y%m%d-%H%M%S).log"

echo "==============================================="
echo "       PSX-Connect VPN Connection Test         "
echo "==============================================="
echo "This script will test the VPN connection with verbose output"
echo "The log will be saved to: $LOG_FILE"
echo ""

# Check if OpenConnect is installed
if ! command -v openconnect &> /dev/null; then
    echo "OpenConnect is not installed. Please install it first."
    if [ "$(uname)" == "Darwin" ]; then
        echo "You can install it with: brew install openconnect"
    elif [ "$(uname)" == "Linux" ]; then
        echo "You can install it with: sudo apt-get install openconnect"
    fi
    exit 1
fi

# Check if password file exists
if [ ! -f "$VPN_PASSWORD_FILE" ]; then
    echo "VPN password file not found at $VPN_PASSWORD_FILE"
    echo "Please run ./update-vpn-password.sh first to create it."
    exit 1
fi

# Check version of OpenConnect
OPENCONNECT_VERSION=$(openconnect --version | head -n 1)
echo "Using $OPENCONNECT_VERSION"
echo ""

echo "Testing connection to VPN server: $VPN_SERVER"
echo "Using certificate verification bypass: $VPN_CERT_BYPASS"
echo "Using password file: $VPN_PASSWORD_FILE"
echo "Username: $VPN_USERNAME"
echo ""
echo "Starting test connection in verbose mode..."
echo "(Press Ctrl+C to stop the test)"
echo ""

# Run OpenConnect in verbose mode but without background
PASSWORD=$(cat "$VPN_PASSWORD_FILE")
echo "$ sudo openconnect --verbose $VPN_CERT_BYPASS --user=\"$VPN_USERNAME\" \"$VPN_SERVER\""
echo "Running..."
echo ""

# Use tee to capture output to file and terminal
echo "$PASSWORD" | sudo openconnect --verbose $VPN_CERT_BYPASS --user="$VPN_USERNAME" "$VPN_SERVER" 2>&1 | tee "$LOG_FILE"

# This part will only execute if openconnect is interrupted
echo ""
echo "Connection test completed or interrupted"
echo "Log file saved to: $LOG_FILE" 