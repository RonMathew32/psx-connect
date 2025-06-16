"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testBatchInsert = testBatchInsert;
const logger_1 = require("./utils/logger");
const FixMessage_1 = __importDefault(require("./models/FixMessage"));
const constants_1 = require("./constants");
async function generateSampleFixMessage(symbol, channelNo) {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    return `8=FIX.4.2${constants_1.SOH}9=123${constants_1.SOH}35=X${constants_1.SOH}49=PSX${constants_1.SOH}56=CLIENT${constants_1.SOH}34=1${constants_1.SOH}52=${timestamp}${constants_1.SOH}262=${symbol}${constants_1.SOH}268=1${constants_1.SOH}279=0${constants_1.SOH}269=0${constants_1.SOH}270=100.50${constants_1.SOH}271=1000${constants_1.SOH}10=123${constants_1.SOH}`;
}
async function testBatchInsert() {
    try {
        logger_1.logger.info('[TEST] Starting test batch insert with sample data...');
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
        logger_1.logger.info(`[TEST] Generated ${batch.length} sample messages`);
        // Insert into database
        const result = await FixMessage_1.default.bulkCreate(batch);
        logger_1.logger.info(`[TEST] Successfully saved ${result.length} messages to DB`);
        // Log sample of saved data
        if (result.length > 0) {
            const sample = result[0].toJSON();
            logger_1.logger.info('[TEST] Sample saved message:', {
                id: sample.id,
                symbol: sample.symbol,
                channel_no: sample.channel_no,
                created_at: sample.created_at
            });
        }
        return result.length;
    }
    catch (error) {
        logger_1.logger.error('[TEST] Error in test batch insert:', error);
        throw error;
    }
}
// Only run if this file is executed directly
if (require.main === module) {
    runTest();
}
async function runTest() {
    try {
        logger_1.logger.info('Starting database insertion test...');
        const totalSaved = await testBatchInsert();
        logger_1.logger.info(`Test completed. Total messages saved: ${totalSaved}`);
        process.exit(0);
    }
    catch (error) {
        logger_1.logger.error('Test failed:', error);
        process.exit(1);
    }
}
