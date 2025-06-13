"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAllCache = exports.getAllCache = exports.deleteCache = exports.getCache = exports.setCache = exports.redisClient = void 0;
const logger_1 = require("./logger");
const ioredis_1 = __importDefault(require("ioredis"));
exports.redisClient = new ioredis_1.default(); // configure as needed
/**
 * Sets a value in Redis cache.
 * @param key - Cache key
 * @param data - Data to store (string or stringified JSON)
 * @param expiryTime - Expiry time in seconds (0 for no expiry)
 * @returns Promise resolving to 'OK' if successful, null otherwise
 */
const setCache = async (key, data, expiryTime = 0) => {
    try {
        const cacheData = typeof data === 'string' ? data : JSON.stringify(data);
        return expiryTime
            ? await exports.redisClient.setex(key, expiryTime, cacheData)
            : await exports.redisClient.set(key, cacheData);
    }
    catch (error) {
        logger_1.logger.error('Error setting cache:', error);
        return null;
    }
};
exports.setCache = setCache;
/**
 * Retrieves a value from Redis cache.
 * @param key - Cache key
 * @returns Promise resolving to parsed JSON data or empty string if not found
 */
const getCache = async (key) => {
    try {
        const result = await exports.redisClient.get(key);
        return result ? JSON.parse(result) : [];
    }
    catch (error) {
        logger_1.logger.error('Error getting cache:', error);
        return [];
    }
};
exports.getCache = getCache;
/**
 * Deletes a key-value pair from Redis cache.
 * @param key - Cache key to delete
 * @returns Promise resolving to true if key was deleted, false otherwise
 */
const deleteCache = async (key) => {
    try {
        const result = await exports.redisClient.del(key);
        return result === 1;
    }
    catch (error) {
        logger_1.logger.error('Error deleting cache:', error);
        return false;
    }
};
exports.deleteCache = deleteCache;
/**
 * Fetches all keys and their corresponding values from the Redis cache.
 * Uses SCAN to iterate over keys and MGET to fetch values.
 *
 * @returns Promise resolving to Array of key-value pairs or an empty array if no keys are found.
 */
const getAllCache = async () => {
    let cursor = '0';
    let allKeys = [];
    try {
        do {
            // Use SCAN to fetch keys in batches
            const [nextCursor, keys] = await exports.redisClient.scan(cursor);
            cursor = nextCursor;
            allKeys = allKeys.concat(keys);
        } while (cursor !== '0');
        if (allKeys.length === 0) {
            return [];
        }
        // Fetch all values using MGET
        const values = await exports.redisClient.mget(allKeys);
        // Return keys and corresponding values as an array of objects
        return allKeys.map((key, index) => ({
            key,
            value: values[index],
        }));
    }
    catch (error) {
        logger_1.logger.error('Error fetching all cache:', error);
        return null;
    }
};
exports.getAllCache = getAllCache;
/**
 * Deletes all keys in the current Redis database.
 *
 * @returns {Promise<string | null>} Result of the flush operation, or null if an error occurs.
 */
const deleteAllCache = async () => {
    try {
        return await exports.redisClient.flushdb(); // Deletes all keys in the current database
        // return await redisClient.flushall(); // Deletes all keys in all databases
    }
    catch (error) {
        logger_1.logger.error('Error deleting all cache:', error);
        return null;
    }
};
exports.deleteAllCache = deleteAllCache;
