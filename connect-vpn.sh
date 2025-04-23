# Create the VPN connection script
cat > connect-vpn.sh << 'EOF'
#!/bin/bash

echo "Starting VPN connection for PSX access..."

# Copy the VPN credentials from vpn file
VPN_SERVER="172.16.73.18"
VPN_USER="FFU60017"
VPN_PASSWORD="Yasir01"
VPN_GROUP="PSX-Staff"

# Make sure vpn-slice.py is installed and executable
if [ ! -f "./vpn-slice/vpn-slice.py" ]; then
  echo "❌ Error: vpn-slice.py not found in ./vpn-slice/"
  exit 1
fi

chmod +x ./vpn-slice/vpn-slice.py

# Connect using openconnect with vpn-slice to route only PSX traffic
echo "$VPN_PASSWORD" | sudo openconnect \
  --protocol=anyconnect \
  "$VPN_SERVER" \
  --authgroup="$VPN_GROUP" \
  --user="$VPN_USER" \
  --passwd-on-stdin \
  --servercert pin-sha256:SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY= \
  --script-tun \
  --script "python3 $(pwd)/vpn-slice/vpn-slice.py 172.16.67.0/24" \
  --verbose \
  --background

# Wait for the VPN to establish
echo "Waiting for VPN connection to establish..."
sleep 5

# Check if tun0 interface exists
if ip addr show tun0 &>/dev/null; then
  echo "✅ VPN connected successfully!"
  echo "Now you can run your PSX connection tests."
else
  echo "❌ VPN connection failed."
  echo "Check the openconnect logs for details."
fi
EOF

# Make the script executable
chmod +x connect-vpn.sh