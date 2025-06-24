"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const grpc_client_1 = require("./utils/grpc-client");
const logger_1 = require("./utils/logger");
async function testGRPC() {
    try {
        const testData = {
            symbol: "TEST",
            price: "123.45",
            quantity: "100",
            entry_date: "2024-06-24",
            entry_time: "12:00:00",
            net_change: "+1.23",
            trade_volume: "1000",
            session_status: "open"
        };
        const response = await (0, grpc_client_1.sendSymbolSnapshot)(testData);
        logger_1.logger.info(`Test snapshot response:', ${response}`);
    }
    catch (error) {
        logger_1.logger.info(`Test snapshot error:', ${error}`);
    }
}
testGRPC();
