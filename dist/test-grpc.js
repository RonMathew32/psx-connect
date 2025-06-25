"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const grpc_client_1 = require("./utils/grpc-client");
const logger_1 = require("./utils/logger");
const client = grpc_client_1.grpcClient.client;
const now = Math.floor(Date.now() / 1000);
function done() {
    client.close();
    process.exit(0);
}
// FeedHeartbeat
client.FeedHeartbeat({ timestamp: { seconds: now, nanos: 0 } }, (err, res) => {
    logger_1.logger.info('FeedHeartbeat:', err ? err : res);
});
// MarketStatus
client.MarketStatus({
    timestamp: { seconds: now, nanos: 0 },
    session_id: "REG",
    status: "open"
}, (err, res) => {
    logger_1.logger.info('MarketStatus:', err ? err : res);
});
// IndexList
client.IndexList({
    timestamp: { seconds: now, nanos: 0 },
    product: "INDEX",
    session_id: "REG"
}, (err, res) => {
    logger_1.logger.info('IndexList:', err ? err : res);
});
// SymbolList
client.SymbolList({
    timestamp: { seconds: now, nanos: 0 },
    product: "EQUITY",
    session_id: "REG",
    symbols: ["PSX", "HBL"]
}, (err, res) => {
    logger_1.logger.info('SymbolList:', err ? err : res);
});
// IndexSnapshot
client.IndexSnapshot({
    timestamp: { seconds: now, nanos: 0 },
    indexname: "KSE100",
    value: "50000",
    volume: "1000000",
    net_change: "100"
}, (err, res) => {
    logger_1.logger.info('IndexSnapshot:', err ? err : res);
});
// SymbolSnapshot
client.SymbolSnapshot({
    timestamp: { seconds: now, nanos: 0 },
    symbol: "PSX",
    entry_time: "12:00:00",
    entry_date: "2024-06-24",
    price: "100.50",
    quantity: "500",
    price_delta: "0.25",
    net_change: "1.00"
}, (err, res) => {
    logger_1.logger.info('SymbolSnapshot:', err ? err : res);
});
// SymbolUpdate
client.SymbolUpdate({
    timestamp: { seconds: now, nanos: 0 },
    symbol: "PSX",
    entry_time: "12:05:00",
    entry_date: "2024-06-24",
    price: "101.00",
    quantity: "200",
    price_delta: "0.50",
    net_change: "1.50"
}, (err, res) => {
    logger_1.logger.info('SymbolUpdate:', err ? err : res);
    done();
});
