#!/bin/bash

# Script to update VPN password for PSX-Connect

# Password file location
VPN_PASSWORD_FILE="$HOME/.psx-vpn-password"

# Clear the screen
clear

echo "==============================================="
echo "       PSX-Connect VPN Password Update         "
echo "==============================================="

# Check if the password file exists
if [ -f "$VPN_PASSWORD_FILE" ]; then
  echo "Current password file exists at: $VPN_PASSWORD_FILE"
else
  echo "Password file not found, will create at: $VPN_PASSWORD_FILE"
fi

# Prompt for new password
echo ""
echo "Please enter your VPN password:"
read -s PASSWORD
echo ""
echo "Confirm your VPN password:"
read -s PASSWORD_CONFIRM
echo ""

# Validate password
if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
  echo "Error: Passwords do not match. No changes made."
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  echo "Error: Password cannot be empty. No changes made."
  exit 1
fi

# Save the password
echo "$PASSWORD" > "$VPN_PASSWORD_FILE"
chmod 600 "$VPN_PASSWORD_FILE"

echo "Password updated successfully!"
echo "The password file is located at: $VPN_PASSWORD_FILE"
echo "It will be used for VPN connections when running psx-connect."
echo ""
echo "You can now run ./start.sh to connect to PSX." 