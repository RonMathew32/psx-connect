import { rawClient } from './utils/grpc-client';
import { logger } from './utils/logger';

logger.info(`Available client methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(rawClient))}`);

const now = Math.floor(Date.now() / 1000);

const tests = [
  {
    name: 'MarketStatus',
    call: (cb: (err: any, res: any) => void) => rawClient.MarketStatus({
      timestamp: { seconds: now, nanos: 0 },
      session_id: "REG",
      status: "open"
    }, cb)
  },
  {
    name: 'IndexList',
    call: (cb: (err: any, res: any) => void) => rawClient.IndexList({
      timestamp: { seconds: now, nanos: 0 },
      product: "INDEX",
      session_id: "REG"
    }, cb)
  },
  {
    name: 'SymbolList',
    call: (cb: (err: any, res: any) => void) => rawClient.SymbolList({
      timestamp: { seconds: now, nanos: 0 },
      product: "EQUITY",
      session_id: "REG",
      symbols: ["PSX", "HBL"]
    }, cb)
  }
];

function runTests(i = 0) {
  if (i >= tests.length) {
    rawClient.close();
    process.exit(0);
    return;
  }
  logger.info(`Testing ${tests[i].name}`);
  tests[i].call((err: any, res: any) => {
    logger.info(`${tests[i].name} callback fired`);
    logger.info(`${tests[i].name}:`, err ? err : res);
    runTests(i + 1);
  });
}

runTests();

setTimeout(() => {
  logger.warn('Forcing process exit after 10 seconds (no response from server)');
  process.exit(1);
}, 10000);

// const now = Math.floor(Date.now() / 1000);

// function done() {
//   client.close();
//   process.exit(0);
// }

// const feedHeartbeatCall = client.feedHeartbeat();
// // FeedHeartbeat

// feedHeartbeatCall.on('data', (response: any) => {
//   logger.info('FeedHeartbeat received:', response);
// });
// feedHeartbeatCall.on('end', () => {
//   logger.info('FeedHeartbeat stream ended');
// });
// feedHeartbeatCall.on('error', (err: any) => {
//   logger.error('FeedHeartbeat stream error:', err);
// });

// // Send a message
// feedHeartbeatCall.write({ timestamp: { seconds: now, nanos: 0 } });
// // End the stream if you don't want to send more
// feedHeartbeatCall.end();

// // MarketStatus
// client.MarketStatus({
//   timestamp: { seconds: now, nanos: 0 },
//   session_id: "REG",
//   status: "open"
// }, (err: any, res: any) => {
//   logger.info('MarketStatus:', err ? err : res);
// });

// // IndexList
// client.IndexList({
//   timestamp: { seconds: now, nanos: 0 },
//   product: "INDEX",
//   session_id: "REG"
// }, (err: any, res: any) => {
//   logger.info('IndexList:', err ? err : res);
// });

// // SymbolList
// client.SymbolList({
//   timestamp: { seconds: now, nanos: 0 },
//   product: "EQUITY",
//   session_id: "REG",
//   symbols: ["PSX", "HBL"]
// }, (err: any, res: any) => {
//   logger.info('SymbolList:', err ? err : res);
// });

// // IndexSnapshot
// client.IndexSnapshot({
//   timestamp: { seconds: now, nanos: 0 },
//   indexname: "KSE100",
//   value: "50000",
//   volume: "1000000",
//   net_change: "100"
// }, (err: any, res: any) => {
//   logger.info('IndexSnapshot:', err ? err : res);
// });

// // SymbolSnapshot
// client.SymbolSnapshot({
//   timestamp: { seconds: now, nanos: 0 },
//   symbol: "PSX",
//   entry_time: "12:00:00",
//   entry_date: "2024-06-24",
//   price: "100.50",
//   quantity: "500",
//   price_delta: "0.25",
//   net_change: "1.00"
// }, (err: any, res: any) => {
//   logger.info('SymbolSnapshot:', err ? err : res);
// });

// // SymbolUpdate
// client.SymbolUpdate({
//   timestamp: { seconds: now, nanos: 0 },
//   symbol: "PSX",
//   entry_time: "12:05:00",
//   entry_date: "2024-06-24",
//   price: "101.00",
//   quantity: "200",
//   price_delta: "0.50",
//   net_change: "1.50"
// }, (err: any, res: any) => {
//   logger.info('SymbolUpdate:', err ? err : res);
//   done();
// });