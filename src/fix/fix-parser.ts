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
    for (const field of fields) {
      const [tag, value] = field.split("=");
      if (tag && value) {
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

    const customFieldTags = ["10201", "11500", "8538", "8503", "8504"];
    customFieldTags.forEach((tag) => {
      if (parsedMessage[tag]) {
        jsonOutput.custom_fields[tag] = parsedMessage[tag];
      }
    });

    const noMDEntries = parseInt(
      parsedMessage[FieldTag.NO_MD_ENTRIES] || "0",
      10
    );
    const entries: any[] = [];
    let currentEntry: any | null = null;
    let currentOrders: Array<{ order_id: string; order_quantity: number }> = [];
    let noOrders: number = 0;

    const fieldOrder = fixMessage.split("\x01");
    for (const field of fieldOrder) {
      const [tag, value] = field.split("=");
      if (!tag || !value) continue;

      if (tag === FieldTag.MD_ENTRY_TYPE) {
        if (currentEntry) {
          if (currentOrders.length > 0) {
            currentEntry.orders = currentOrders;
          }
          entries.push(currentEntry);
        }
        currentEntry = {
          entry_type: value,
          price: 0,
          quantity: 0,
          price_level: 0,
          number_of_orders: 0,
        };
        currentOrders = [];
        noOrders = 0;
      } else if (currentEntry) {
        if (tag === FieldTag.MD_ENTRY_PX) {
          currentEntry.price = parseFloat(value);
        } else if (tag === FieldTag.MD_ENTRY_SIZE) {
          currentEntry.quantity = parseFloat(value);
        } else if (tag === FieldTag.MD_ENTRY_PX) {
          currentEntry.price_level = parseInt(value, 10);
        } else if (tag === FieldTag.MD_ENTRY_TYPE) {
          currentEntry.number_of_orders = parseInt(value, 10);
        } else if (tag === FieldTag.NO_ORDERS) {
          noOrders = parseInt(value, 10);
        } else if (tag === FieldTag.ORDER_QTY && noOrders > 0) {
          currentOrders.push({
            order_id: "",
            order_quantity: parseFloat(value),
          });
        } else if (tag === FieldTag.ORDER_ID && currentOrders.length > 0) {
          currentOrders[currentOrders.length - 1].order_id = value;
        }
      }
    }

    if (currentEntry) {
      if (currentOrders.length > 0) {
        currentEntry.orders = currentOrders;
      }
      entries.push(currentEntry);
    }

    jsonOutput.market_data_entries = entries;

    logger.info(
      `Parsed market data snapshot: ${JSON.stringify(jsonOutput, null, 2)}`
    );

    return jsonOutput;
  } catch (error) {
    logger.error(
      `Error parsing FIX message: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
};
