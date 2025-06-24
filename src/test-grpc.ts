import { sendSymbolSnapshot } from './utils/grpc-client';
import { logger } from './utils/logger';

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

    const response = await sendSymbolSnapshot(testData);
    logger.info(`Test snapshot response:', ${response}`);
  } catch (error) {
    logger.info(`Test snapshot error:', ${error}`);
  }
}

testGRPC();