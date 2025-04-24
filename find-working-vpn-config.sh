#!/bin/bash

# Comprehensive script to find a working VPN configuration
# This will try various combinations of settings to find what works

# Kill any active connections first
echo "Stopping any active OpenConnect sessions..."
sudo killall openconnect 2>/dev/null || true
sleep 2

# Get the password from the vpn file
if [ -f "./vpn" ]; then
  PASSWORD=$(grep "^pass " "./vpn" | cut -d' ' -f2)
  USER_ID=$(grep -A1 "^pass " "./vpn" | tail -n 1)
  echo "Found password in vpn file"
  echo "User ID appears to be: ${USER_ID}"
else
  PASSWORD="Yasir01"
  USER_ID="FFU60017"
  echo "Using default password and user ID"
fi

# Try different usernames and auth groups
echo "Starting VPN connection tests..."
echo "We will try multiple combinations of settings until we find what works"
echo "Press Ctrl+C to stop the process at any time"

# ATTEMPT 1: Try using ID from vpn file and PSX-Staff group
echo ""
echo "=== ATTEMPT 1: User=${USER_ID}, Group=PSX-Staff ==="
echo "${PASSWORD}" | sudo openconnect --user="${USER_ID}" --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 2: Try using fn as username
echo ""
echo "=== ATTEMPT 2: User=fn, Group=PSX-Staff ==="
echo "${PASSWORD}" | sudo openconnect --user="fn" --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 3: Try using KATS-VPN group
echo ""
echo "=== ATTEMPT 3: User=${USER_ID}, Group=KATS-VPN ==="
echo "${PASSWORD}" | sudo openconnect --user="${USER_ID}" --authgroup=KATS-VPN \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 4: Try using fn username and KATS-VPN group
echo ""
echo "=== ATTEMPT 4: User=fn, Group=KATS-VPN ==="
echo "${PASSWORD}" | sudo openconnect --user="fn" --authgroup=KATS-VPN \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 5: Try using DTLS settings from the vpn file
echo ""
echo "=== ATTEMPT 5: With DTLS settings ==="
echo "${PASSWORD}" | sudo openconnect --user="${USER_ID}" --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  --dtls-ciphers=RSA-AES256-SHA \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 6: Try using the user field as password with fn as username
echo ""
echo "=== ATTEMPT 6: User=fn, Password=${USER_ID} ==="
echo "${USER_ID}" | sudo openconnect --user="fn" --authgroup=PSX-Staff \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18
echo ""
echo "That attempt failed. Trying next configuration..."
sleep 2

# ATTEMPT 7: Try with no auth group
echo ""
echo "=== ATTEMPT 7: No auth group specified ==="
echo "${PASSWORD}" | sudo openconnect --user="${USER_ID}" \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  172.16.73.18

echo ""
echo "All attempts completed. If none worked, please check the VPN configuration on the fn-psx system." 