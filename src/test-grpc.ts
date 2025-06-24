import { grpcClient } from './utils/grpc-client';
import { logger } from './utils/logger';

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

const now = Math.floor(Date.now() / 1000);

const messages = [
  {
    timestamp: { seconds: now, nanos: 0 },
    symbol: "PSX",
    entry_time: "12:34:56",
    entry_date: "2024-06-24",
    price: "100.50",
    quantity: "500",
    price_delta: "0.25",
    net_change: "1.00"
  },
  {
    timestamp: { seconds: now, nanos: 0 },
    symbol: "HBL",
    entry_time: "13:45:00",
    entry_date: "2024-06-24",
    price: "250.75",
    quantity: "1000",
    price_delta: "-0.50",
    net_change: "-2.00"
  },
  {
    timestamp: { seconds: now, nanos: 0 },
    // Yeh message ghalat hai (symbol missing)
    entry_time: "14:00:00",
    entry_date: "2024-06-24",
    price: "0.00",
    quantity: "0"
  }
];

for (const msg of messages) {
  call.write(msg);
}
call.end();