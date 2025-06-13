import FixMessage from "../models/FixMessage";
import { logger } from "../utils/logger";

export async function saveBatchFixMessages(batch: Array<{ 
  symbol: string, 
  channel_no: string, 
  message: string, 
  created_at: Date,
  updated_at: Date,
  last_seen_at: Date,
  deleted_at: Date | null
}>) {
  try {
    const result = await FixMessage.bulkCreate(batch);
    logger.info(`Successfully saved ${result.length} messages to database`);
    return result;
  } catch (error) {
    logger.error('Error saving batch messages to database:', error);
    throw error;
  }
}

export async function getBatchFixMessages(options: {
  channelNo?: string;
  symbol?: string;
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  try {
    const {
      channelNo,
      symbol,
      limit = 500,
      offset = 0,
      startDate,
      endDate
    } = options;

    const where: any = {};
    
    if (channelNo) {
      where.channel_no = channelNo;
    }
    
    if (symbol) {
      where.symbol = symbol;
    }
    
    if (startDate || endDate) {
      where.created_at = {};
      if (startDate) {
        where.created_at.$gte = startDate;
      }
      if (endDate) {
        where.created_at.$lte = endDate;
      }
    }

    const messages = await FixMessage.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
      paranoid: true // This ensures we don't get soft-deleted records
    });

    logger.info(`Retrieved ${messages.rows.length} messages from database`);
    return {
      total: messages.count,
      messages: messages.rows
    };
  } catch (error) {
    logger.error('Error retrieving batch messages from database:', error);
    throw error;
  }
} 