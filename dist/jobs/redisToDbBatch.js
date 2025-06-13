"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const FixMessage_1 = __importDefault(require("../models/FixMessage"));
const cache_1 = require("../utils/cache");
const logger_1 = require("../utils/logger");
// Helper to get all messages for all channels (or a specific channel)
async function getBatchFromRedis(channelNo, batchSize) {
    try {
        logger_1.logger.info(`[REDIS_BATCH] Fetching up to ${batchSize} messages for channel ${channelNo}`);
        const data = await cache_1.redisClient.hgetall(`fix-latest:${channelNo}`);
        logger_1.logger.info(`[REDIS_BATCH] Found ${Object.keys(data).length} messages for channel ${channelNo}`);
        const batch = Object.entries(data)
            .slice(0, batchSize)
            .map(([symbol, message]) => ({
            symbol,
            channel_no: channelNo,
            message,
            created_at: new Date(),
            updated_at: new Date(),
            last_seen_at: new Date(),
            deleted_at: null,
        }));
        return batch;
    }
    catch (error) {
        logger_1.logger.error(`[REDIS_BATCH] Error getting batch from Redis for channel ${channelNo}:`, error);
        return [];
    }
}
// The scheduled job
const job = node_cron_1.default.schedule('*/10 * * * *', async () => {
    const startTime = new Date();
    logger_1.logger.info(`[REDIS_BATCH] Starting Redis to DB batch processing job at ${startTime.toISOString()}`);
    try {
        const channelNos = [
            '1', '2', '10',
            '1011', '1021', '1031', '1041', '1051', '1061', '1071', '1081',
            '2011', '2021', '2041', '2051', '2061', '2071', '2081',
            '3011', '3021', '3041',
            '4001', '4021'
        ];
        let totalSaved = 0;
        for (const channelNo of channelNos) {
            try {
                const batch = await getBatchFromRedis(channelNo, 500);
                if (batch.length > 0) {
                    await FixMessage_1.default.bulkCreate(batch);
                    totalSaved += batch.length;
                    logger_1.logger.info(`[REDIS_BATCH] Saved ${batch.length} messages from channel ${channelNo} to DB`);
                    // Log a sample message for debugging
                    if (batch.length > 0) {
                        logger_1.logger.info(`[REDIS_BATCH] Sample message for channel ${channelNo}:`, {
                            symbol: batch[0].symbol,
                            message: batch[0].message
                        });
                    }
                }
                else {
                    logger_1.logger.info(`[REDIS_BATCH] No new messages found for channel ${channelNo}`);
                }
            }
            catch (channelError) {
                logger_1.logger.error(`[REDIS_BATCH] Error processing channel ${channelNo}:`, channelError);
                continue;
            }
        }
        const endTime = new Date();
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;
        logger_1.logger.info(`[REDIS_BATCH] Batch processing completed at ${endTime.toISOString()}`);
        logger_1.logger.info(`[REDIS_BATCH] Total messages saved: ${totalSaved}`);
        logger_1.logger.info(`[REDIS_BATCH] Processing duration: ${duration} seconds`);
    }
    catch (err) {
        logger_1.logger.error('[REDIS_BATCH] Batch update error:', err);
    }
});
// Ensure the job is running
logger_1.logger.info('[REDIS_BATCH] Batch processing job scheduled to run every 10 minutes');
// Export the job so we can control it if needed
exports.default = job;
