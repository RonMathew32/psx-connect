// cat > vpn-connect.js << 'EOF'
const { exec, spawn } = require('child_process');
const readline = require('readline');

// VPN configuration
const config = {
  server: '172.16.73.18',
  user: 'FFU60017',
  password: 'Yasir01',
  group: 'PSX-Staff',
  certPin: 'SPlqKwOKIcJ3ryyWBGSZ5gEuqgPK5dQdDfeIZIJR+EY='
};

console.log('PSX VPN Connection Tool');
console.log('=======================');
console.log(`Connecting to ${config.server} as ${config.user}`);

// Check if already connected
exec('ip addr show tun0', (error) => {
  if (!error) {
    console.log('✅ VPN already connected (tun0 interface exists)');
    console.log('Run your PSX connection test now.');
    return;
  }

  // Start VPN connection
  console.log('Starting VPN connection...');
  
  // Build the openconnect command
  const openconnectCmd = spawn('sudo', [
    'openconnect',
    '--protocol=anyconnect',
    config.server,
    `--authgroup=${config.group}`,
    `--user=${config.user}`,
    `--servercert=pin-sha256:${config.certPin}`,
    '--verbose',
    '--background'
  ]);

  // Set up stdin/stdout handling
  openconnectCmd.stdout.on('data', (data) => {
    console.log(`${data}`);
  });

  openconnectCmd.stderr.on('data', (data) => {
    const output = data.toString();
    console.log(`${output}`);
    
    // When prompted for password, provide it
    if (output.includes('Password:')) {
      openconnectCmd.stdin.write(`${config.password}\n`);
    }
  });

  openconnectCmd.on('close', (code) => {
    if (code === 0) {
      console.log('VPN connection started successfully.');
      
      // Wait for connection to establish
      setTimeout(() => {
        // Check if tun0 interface exists
        exec('ip addr show tun0', (error) => {
          if (!error) {
            console.log('✅ VPN connected successfully!');
            
            // Add specific route for PSX server
            exec('sudo ip route add 172.16.67.0/24 dev tun0', (routeError) => {
              if (!routeError) {
                console.log('Added route for PSX network.');
                console.log('Now you can run your PSX connection tests.');
              } else {
                console.log('Error adding route, but VPN connection may still work.');
              }
            });
          } else {
            console.log('❌ VPN connection failed or tun0 interface not found.');
          }
        });
      }, 5000);
    } else {
      console.error(`❌ VPN connection failed with code ${code}`);
    }
  });
});

// Handle script termination
process.on('SIGINT', () => {
  console.log('\nInterrupted. To disconnect VPN, run:');
  console.log('sudo pkill -SIGINT openconnect');
  process.exit();
});
// EOF