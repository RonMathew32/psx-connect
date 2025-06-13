"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const cache_1 = require("../utils/cache");
const logger_1 = require("../utils/logger");
const fixMessageController_1 = require("../controllers/fixMessageController");
// Helper to get all messages for all channels (or a specific channel)
async function getBatchFromRedis(channelNo, batchSize) {
    try {
        const data = await cache_1.redisClient.hgetall(`fix-latest:${channelNo}`);
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
        logger_1.logger.error(`Error getting batch from Redis for channel ${channelNo}:`, error);
        return [];
    }
}
// The scheduled job
node_cron_1.default.schedule('*/10 * * * *', async () => {
    logger_1.logger.info('Starting Redis to DB batch processing job');
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
                    await (0, fixMessageController_1.saveBatchFixMessages)(batch);
                    totalSaved += batch.length;
                    logger_1.logger.info(`Saved ${batch.length} messages from channel ${channelNo} to DB`);
                    // Optionally, remove these entries from Redis after saving to DB
                    // for (const entry of batch) {
                    //   await redisClient.hdel(`fix-latest:${channelNo}`, entry.symbol);
                    // }
                }
            }
            catch (channelError) {
                logger_1.logger.error(`Error processing channel ${channelNo}:`, channelError);
                // Continue with next channel even if one fails
                continue;
            }
        }
        logger_1.logger.info(`Batch processing completed. Total messages saved: ${totalSaved}`);
    }
    catch (err) {
        logger_1.logger.error('Batch update error:', err);
    }
});
