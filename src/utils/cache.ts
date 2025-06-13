import { logger } from './logger';
import Redis from 'ioredis';

export const redisClient = new Redis(); // configure as needed

/**
 * Sets a value in Redis cache.
 * @param key - Cache key
 * @param data - Data to store (string or stringified JSON)
 * @param expiryTime - Expiry time in seconds (0 for no expiry)
 * @returns Promise resolving to 'OK' if successful, null otherwise
 */
export const setCache = async (key: string, data: string | object, expiryTime: number = 0) =>
{
  try
  {
    const cacheData = typeof data === 'string' ? data : JSON.stringify(data);

    return expiryTime
      ? await redisClient.setex(key, expiryTime, cacheData)
      : await redisClient.set(key, cacheData);
  }
  catch (error)
  {
    logger.error('Error setting cache:', error);

    return null;
  }
};

/**
 * Retrieves a value from Redis cache.
 * @param key - Cache key
 * @returns Promise resolving to parsed JSON data or empty string if not found
 */
export const getCache = async (key: string) =>
{
  try
  {
    const result = await redisClient.get(key);

    return result ? JSON.parse(result) : [];
  }
  catch (error)
  {
    logger.error('Error getting cache:', error);

    return [];
  }
};

/**
 * Deletes a key-value pair from Redis cache.
 * @param key - Cache key to delete
 * @returns Promise resolving to true if key was deleted, false otherwise
 */
export const deleteCache = async (key: string) =>
{
  try
  {
    const result = await redisClient.del(key);

    return result === 1;
  }
  catch (error)
  {
    logger.error('Error deleting cache:', error);

    return false;
  }
};

/**
 * Fetches all keys and their corresponding values from the Redis cache.
 * Uses SCAN to iterate over keys and MGET to fetch values.
 *
 * @returns Promise resolving to Array of key-value pairs or an empty array if no keys are found.
 */
export const getAllCache = async () =>
{
  let cursor = '0';
  let allKeys: string[] = [];

  try
  {
    do
    {
      // Use SCAN to fetch keys in batches
      const [nextCursor, keys] = await redisClient.scan(cursor);

      cursor = nextCursor;
      allKeys = allKeys.concat(keys);
    } while (cursor !== '0');

    if (allKeys.length === 0)
    {
      return [];
    }

    // Fetch all values using MGET
    const values = await redisClient.mget(allKeys);

    // Return keys and corresponding values as an array of objects
    return allKeys.map((key, index) => ({
      key,
      value: values[index],
    }));
  }
  catch (error)
  {
    logger.error('Error fetching all cache:', error);

    return null;
  }
};

/**
 * Deletes all keys in the current Redis database.
 *
 * @returns {Promise<string | null>} Result of the flush operation, or null if an error occurs.
 */
export const deleteAllCache = async () =>
{
  try
  {
    return await redisClient.flushdb(); // Deletes all keys in the current database
    // return await redisClient.flushall(); // Deletes all keys in all databases
  }
  catch (error)
  {
    logger.error('Error deleting all cache:', error);

    return null;
  }
};
