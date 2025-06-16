import { logger } from './utils/logger';
import FixMessage from './models/FixMessage';
import { SOH } from './constants';

async function generateSampleFixMessage(symbol: string, channelNo: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  return `8=FIX.4.2${SOH}9=123${SOH}35=X${SOH}49=PSX${SOH}56=CLIENT${SOH}34=1${SOH}52=${timestamp}${SOH}262=${symbol}${SOH}268=1${SOH}279=0${SOH}269=0${SOH}270=100.50${SOH}271=1000${SOH}10=123${SOH}`;
}

export async function testBatchInsert() {
  try {
    logger.info('[TEST] Starting test batch insert with sample data...');
    
    // Generate sample data for different channels
    const testData = [
      { symbol: 'AAPL', channelNo: '1' },
      { symbol: 'GOOGL', channelNo: '1' },
      { symbol: 'MSFT', channelNo: '2' },
      { symbol: 'AMZN', channelNo: '2' },
      { symbol: 'TSLA', channelNo: '10' }
    ];

    const batch = await Promise.all(testData.map(async ({ symbol, channelNo }) => ({
      symbol,
      channel_no: channelNo,
      message: await generateSampleFixMessage(symbol, channelNo),
      created_at: new Date(),
      updated_at: new Date(),
      last_seen_at: new Date(),
      deleted_at: null
    })));

    logger.info(`[TEST] Generated ${batch.length} sample messages`);

    // Insert into database
    const result = await FixMessage.bulkCreate(batch);
    
    logger.info(`[TEST] Successfully saved ${result.length} messages to DB`);
    
    // Log sample of saved data
    if (result.length > 0) {
      const sample = result[0].toJSON();
      logger.info('[TEST] Sample saved message:', {
        id: sample.id,
        symbol: sample.symbol,
        channel_no: sample.channel_no,
        created_at: sample.created_at
      });
    }

    return result.length;
  } catch (error) {
    logger.error('[TEST] Error in test batch insert:', error);
    throw error;
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  runTest();
}

async function runTest() {
  try {
    logger.info('Starting database insertion test...');
    const totalSaved = await testBatchInsert();
    logger.info(`Test completed. Total messages saved: ${totalSaved}`);
    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
} 