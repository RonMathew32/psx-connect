#!/bin/bash

# Script to check if the VPN connection required for PSX is active

echo "Checking VPN connectivity to PSX server..."

# PSX server address from config
PSX_HOST="172.16.67.14"
PSX_PORT="50067"

# Check if the PSX host is reachable
if ping -c 2 $PSX_HOST > /dev/null 2>&1; then
  echo "✅ PSX server at $PSX_HOST is reachable (ping successful)"
else
  echo "❌ PSX server at $PSX_HOST is NOT reachable (ping failed)"
  echo "Please ensure you are connected to the correct VPN"
  
  # Check if VPN connection appears active
  if ip addr | grep -q "tun0"; then
    echo "  - VPN interface tun0 is present, but cannot reach PSX"
    echo "  - Your VPN might be connected but routing is incorrect"
    
    # Get the VPN IP address
    VPN_IP=$(ip addr show tun0 | grep -Po 'inet \K[\d.]+')
    echo "  - Your VPN IP address: $VPN_IP"
  else
    echo "  - No VPN interface (tun0) detected"
    echo "  - Please connect to the VPN first"
  fi
  
  exit 1
fi

# Test TCP connection to the PSX FIX port
if nc -z -w 5 $PSX_HOST $PSX_PORT > /dev/null 2>&1; then
  echo "✅ PSX FIX service at $PSX_HOST:$PSX_PORT is reachable"
  echo "VPN connectivity looks good! You can connect to PSX."
  exit 0
else
  echo "❌ PSX FIX service at $PSX_HOST:$PSX_PORT is NOT reachable"
  echo "Please check firewall settings or VPN configuration"
  exit 1
fi 