import logger from "../utils/logger";
import { FieldTag, MessageType } from "./constants";

/**
 * Parse a FIX message string into a key-value object
 * @param fixMessage The raw FIX message string
 * @returns Object with tag-value pairs, or null if invalid
 */
export const parseFixMessage = (
  fixMessage: string
): { [key: string]: string } | null => {
  try {
    const result: { [key: string]: string } = {};
    const fields = fixMessage.split("\x01");
    const fieldCount = fields.length;
    
    // Optimized loop with caching length
    for (let i = 0; i < fieldCount; i++) {
      const field = fields[i];
      if (!field) continue;
      
      // Use indexOf instead of split for better performance
      const separatorIndex = field.indexOf("=");
      if (separatorIndex > 0) {
        const tag = field.substring(0, separatorIndex);
        const value = field.substring(separatorIndex + 1);
        result[tag] = value;
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    logger.error(
      `Error parsing FIX message: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
};

/**
 * Parse a Market Data Snapshot/Full Refresh FIX message into JSON format
 * @param fixMessage The raw FIX message string
 * @returns JSON object containing parsed data, or null if parsing fails
 */
export const parseMarketDataSnapshotToJson = (fixMessage: string): any | null => {
  try {
    const parsedMessage = parseFixMessage(fixMessage);
    if (!parsedMessage) {
      logger.error("Failed to parse FIX message");
      return null;
    }

    if (
      parsedMessage[FieldTag.MSG_TYPE] !==
      MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH
    ) {
      logger.error(
        `Invalid message type: ${parsedMessage[FieldTag.MSG_TYPE]}, expected ${
          MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH
        }`
      );
      return null;
    }

    const jsonOutput: any = {
      symbol: parsedMessage[FieldTag.SYMBOL] || "",
      previous_close_price: parseFloat(
        parsedMessage[FieldTag.PREV_CLOSE_PX] || "0"
      ),
      total_volume_traded: parseFloat(
        parsedMessage[FieldTag.TOTAL_VOLUME_TRADED] || "0"
      ),
      sending_time: parsedMessage[FieldTag.SENDING_TIME] || "",
      original_time: parsedMessage[FieldTag.ORIG_TIME] || "",
      sequence_number: parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM] || "0", 10),
      sender_comp_id: parsedMessage[FieldTag.SENDER_COMP_ID] || "",
      target_comp_id: parsedMessage[FieldTag.TARGET_COMP_ID] || "",
      market_data_entries: [],
      custom_fields: {},
    };

    // Extract custom fields - using a set for O(1) lookups
    const customFieldTags = new Set(["10201", "11500", "8538", "8503", "8504"]);
    
    for (const tag of customFieldTags) {
      if (parsedMessage[tag]) {
        jsonOutput.custom_fields[tag] = parsedMessage[tag];
      }
    }

    // Extract market data entries
    const noMDEntries = parseInt(
      parsedMessage[FieldTag.NO_MD_ENTRIES] || "0",
      10
    );
    
    logger.debug(`Number of market data entries: ${noMDEntries}`);
    
    // Optimize handling of market data entries
    if (noMDEntries > 0) {
      const entries: any[] = [];
      const entryTags = new Set([
        FieldTag.MD_ENTRY_TYPE,
        FieldTag.MD_ENTRY_PX,
        FieldTag.MD_ENTRY_SIZE,
        FieldTag.NO_ORDERS,
        FieldTag.ORDER_QTY,
        FieldTag.ORDER_ID
      ]);
      
      // Use an optimized approach to extract entries
      // First build a map of field indices for repeating groups
      const fieldMap: Map<string, string[]> = new Map();
      
      // Pre-process fields to group them by base tag
      for (const [key, value] of Object.entries(parsedMessage)) {
        if (key.includes('.')) {
          const [baseTag, index] = key.split('.');
          if (!fieldMap.has(baseTag)) {
            fieldMap.set(baseTag, []);
          }
          fieldMap.get(baseTag)![parseInt(index, 10)] = value;
        }
      }
      
      // Now construct entries
      for (let i = 0; i < noMDEntries; i++) {
        const entry: any = {
          entry_type: fieldMap.get(FieldTag.MD_ENTRY_TYPE)?.[i] || parsedMessage[FieldTag.MD_ENTRY_TYPE],
          price: parseFloat(fieldMap.get(FieldTag.MD_ENTRY_PX)?.[i] || parsedMessage[FieldTag.MD_ENTRY_PX] || "0"),
          quantity: parseFloat(fieldMap.get(FieldTag.MD_ENTRY_SIZE)?.[i] || parsedMessage[FieldTag.MD_ENTRY_SIZE] || "0"),
        };
        
        logger.debug(`Processing entry ${i}: ${JSON.stringify(entry)}`);
        
        // Handle orders if present
        const noOrders = parseInt(fieldMap.get(FieldTag.NO_ORDERS)?.[i] || "0", 10);
        if (noOrders > 0) {
          const orders = [];
          for (let j = 0; j < noOrders; j++) {
            // Find order quantity and ID
            const orderQtyKey = `${FieldTag.ORDER_QTY}.${i}.${j}`;
            const orderIdKey = `${FieldTag.ORDER_ID}.${i}.${j}`;
            
            orders.push({
              order_id: parsedMessage[orderIdKey] || "",
              order_quantity: parseFloat(parsedMessage[orderQtyKey] || "0"),
            });
          }
          entry.orders = orders;
        }
        
        entries.push(entry);
      }
      
      jsonOutput.market_data_entries = entries;
    }

    return jsonOutput;
  } catch (error) {
    logger.error(
      `Error parsing market data snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
};

/**
 * Extract and parse market data items from a FIX message
 * @param message Parsed FIX message
 * @returns Array of market data items
 */
export const extractMarketDataItems = (message: { [key: string]: string }): any[] => {
  try {
    const items = [];
    const symbol = message[FieldTag.SYMBOL] || '';
    const timestamp = message[FieldTag.SENDING_TIME] || new Date().toISOString();
    
    // Get number of entries
    const numEntries = parseInt(message[FieldTag.NO_MD_ENTRIES] || '0', 10);
    
    if (numEntries === 0) {
      return [];
    }
    
    // Handle standard format (entry types in group)
    for (let i = 0; i < numEntries; i++) {
      const entryType = message[`${FieldTag.MD_ENTRY_TYPE}.${i}`] || message[FieldTag.MD_ENTRY_TYPE];
      if (!entryType) continue;
      
      const price = parseFloat(message[`${FieldTag.MD_ENTRY_PX}.${i}`] || message[FieldTag.MD_ENTRY_PX] || '0');
      const size = parseFloat(message[`${FieldTag.MD_ENTRY_SIZE}.${i}`] || message[FieldTag.MD_ENTRY_SIZE] || '0');
      
      items.push({
        symbol,
        entryType,
        price: isNaN(price) ? undefined : price,
        size: isNaN(size) ? undefined : size,
        timestamp
      });
    }
    
    return items;
  } catch (error) {
    logger.error(`Error extracting market data items: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}; 