"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveBatchFixMessages = saveBatchFixMessages;
exports.getBatchFixMessages = getBatchFixMessages;
const FixMessage_1 = __importDefault(require("../models/FixMessage"));
const logger_1 = require("../utils/logger");
async function saveBatchFixMessages(batch) {
    try {
        const result = await FixMessage_1.default.bulkCreate(batch);
        logger_1.logger.info(`Successfully saved ${result.length} messages to database`);
        return result;
    }
    catch (error) {
        logger_1.logger.error('Error saving batch messages to database:', error);
        throw error;
    }
}
async function getBatchFixMessages(options) {
    try {
        const { channelNo, symbol, limit = 500, offset = 0, startDate, endDate } = options;
        const where = {};
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
        const messages = await FixMessage_1.default.findAndCountAll({
            where,
            limit,
            offset,
            order: [['created_at', 'DESC']],
            paranoid: true // This ensures we don't get soft-deleted records
        });
        logger_1.logger.info(`Retrieved ${messages.rows.length} messages from database`);
        return {
            total: messages.count,
            messages: messages.rows
        };
    }
    catch (error) {
        logger_1.logger.error('Error retrieving batch messages from database:', error);
        throw error;
    }
}
