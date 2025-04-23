cat > vpn-disconnect.js << 'EOF'
const { exec } = require('child_process');

console.log('Disconnecting VPN...');

exec('sudo pkill -SIGINT openconnect', (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  
  // Check if VPN was disconnected
  setTimeout(() => {
    exec('ip addr show tun0', (checkError) => {
      if (checkError) {
        console.log('✅ VPN disconnected successfully!');
      } else {
        console.log('❌ VPN is still connected. Trying force disconnect...');
        exec('sudo pkill -SIGKILL openconnect', () => {
          console.log('Force disconnection attempted.');
        });
      }
    });
  }, 2000);
});
EOF