"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const grpc_client_1 = require("./utils/grpc-client");
const logger_1 = require("./utils/logger");
// Access the raw gRPC client instance
const client = grpc_client_1.grpcClient.client;
const call = client.SymbolSnapshot();
call.on('data', (response) => {
    logger_1.logger.info('Received: ' + JSON.stringify(response, null, 2));
});
call.on('end', () => {
    logger_1.logger.info('Stream ended');
    client.close();
    process.exit(0);
});
call.on('error', (err) => {
    logger_1.logger.error('Stream error:', err);
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
    //   symbol: "HBL",
    entry_time: "13:45:00",
    entry_date: "2024-06-24",
    price: "250.75",
    quantity: "1000",
    //   price_delta: "-0.50",
    //   net_change: "-2.00"
});
// If you are done sending messages:
call.end();
