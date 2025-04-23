cat > test-psx-connection.js << 'EOF'
const { exec } = require('child_process');

// Check if VPN is connected
exec('ip addr show tun0', (error) => {
  if (error) {
    console.error('❌ ERROR: VPN is not connected!');
    console.error('Please run: node vpn-connect.js');
    console.error('Then try this test again.');
    process.exit(1);
  }
  
  console.log('✅ VPN connection detected. Testing PSX connectivity...');
  
  // Test connectivity to PSX server first
  exec('ping -c 1 -W 5 172.16.67.14', (pingError, pingStdout) => {
    if (pingError) {
      console.error('❌ ERROR: Cannot ping PSX server!');
      console.error('The VPN connection might not be routing traffic correctly.');
      process.exit(1);
    }
    
    console.log('✅ PSX server is reachable. Testing FIX port...');
    
    // Now run the actual connection test
    exec('node check-psx-connection.js', (testError, testStdout, testStderr) => {
      if (testStdout) console.log(testStdout);
      if (testStderr) console.error(testStderr);
      
      if (testError) {
        console.error('❌ PSX FIX port test failed!');
        process.exit(1);
      }
    });
  });
});
EOF