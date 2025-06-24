import { grpcClient } from './utils/grpc-client';
import { logger } from './utils/logger';

// Access the raw gRPC client instance
const client = (grpcClient as any).client;

const call = client.SymbolSnapshot();

call.on('data', (response: any) => {
  logger.info('Received: ' + JSON.stringify(response, null, 2));
});

call.on('end', () => {
  logger.info('Stream ended');
  client.close();
  process.exit(0);
});

call.on('error', (err: any) => {
  logger.error('Stream error:', err);
  process.exit(1);
});

// Send a test message to start the stream
// call.write({
//   symbol: "TEST",
//   price: "123.45",
//   quantity: "100",
//   entry_date: "2024-06-24",
//   entry_time: "12:00:00",
//   net_change: "+1.23",
//   trade_volume: "1000",
//   session_status: "open"
// });

const now = Math.floor(Date.now() / 1000);
call.write({
  timestamp: { seconds: now, nanos: 0 },
  symbol: "PSX",
  entry_time: "12:34:56",
  entry_date: "2024-06-24",
  price: "100.50",
  quantity: "500",
  price_delta: "0.25",
  net_change: "1.00"
});

// If you are done sending messages:
call.end();