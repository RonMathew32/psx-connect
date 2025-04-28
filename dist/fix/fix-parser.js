"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMarketDataSnapshotToJson = exports.parseFixMessage = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const constants_1 = require("./constants");
/**
 * Parse a FIX message string into a key-value object
 * @param fixMessage The raw FIX message string
 * @returns Object with tag-value pairs, or null if invalid
 */
const parseFixMessage = (fixMessage) => {
    try {
        const result = {};
        const fields = fixMessage.split("\x01");
        for (const field of fields) {
            const [tag, value] = field.split("=");
            if (tag && value) {
                result[tag] = value;
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }
    catch (error) {
        logger_1.default.error(`Error parsing FIX message: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
};
exports.parseFixMessage = parseFixMessage;
/**
 * Parse a Market Data Snapshot/Full Refresh FIX message into JSON format
 * @param fixMessage The raw FIX message string
 * @returns JSON object containing parsed data, or null if parsing fails
 */
const parseMarketDataSnapshotToJson = (fixMessage) => {
    try {
        const parsedMessage = (0, exports.parseFixMessage)(fixMessage);
        if (!parsedMessage) {
            logger_1.default.error("Failed to parse FIX message");
            return null;
        }
        if (parsedMessage[constants_1.FieldTag.MSG_TYPE] !==
            constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH) {
            logger_1.default.error(`Invalid message type: ${parsedMessage[constants_1.FieldTag.MSG_TYPE]}, expected ${constants_1.MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH}`);
            return null;
        }
        const jsonOutput = {
            symbol: parsedMessage[constants_1.FieldTag.SYMBOL] || "",
            previous_close_price: parseFloat(parsedMessage[constants_1.FieldTag.PREV_CLOSE_PX] || "0"),
            total_volume_traded: parseFloat(parsedMessage[constants_1.FieldTag.TOTAL_VOLUME_TRADED] || "0"),
            sending_time: parsedMessage[constants_1.FieldTag.SENDING_TIME] || "",
            original_time: parsedMessage[constants_1.FieldTag.ORIG_TIME] || "",
            sequence_number: parseInt(parsedMessage[constants_1.FieldTag.MSG_SEQ_NUM] || "0", 10),
            sender_comp_id: parsedMessage[constants_1.FieldTag.SENDER_COMP_ID] || "",
            target_comp_id: parsedMessage[constants_1.FieldTag.TARGET_COMP_ID] || "",
            market_data_entries: [],
            custom_fields: {},
        };
        const customFieldTags = ["10201", "11500", "8538", "8503", "8504"];
        customFieldTags.forEach((tag) => {
            if (parsedMessage[tag]) {
                jsonOutput.custom_fields[tag] = parsedMessage[tag];
            }
        });
        const noMDEntries = parseInt(parsedMessage[constants_1.FieldTag.NO_MD_ENTRIES] || "0", 10);
        const entries = [];
        let currentEntry = null;
        let currentOrders = [];
        let noOrders = 0;
        const fieldOrder = fixMessage.split("\x01");
        for (const field of fieldOrder) {
            const [tag, value] = field.split("=");
            if (!tag || !value)
                continue;
            if (tag === constants_1.FieldTag.MD_ENTRY_TYPE) {
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
            }
            else if (currentEntry) {
                if (tag === constants_1.FieldTag.MD_ENTRY_PX) {
                    currentEntry.price = parseFloat(value);
                }
                else if (tag === constants_1.FieldTag.MD_ENTRY_SIZE) {
                    currentEntry.quantity = parseFloat(value);
                }
                else if (tag === constants_1.FieldTag.MD_ENTRY_PX) {
                    currentEntry.price_level = parseInt(value, 10);
                }
                else if (tag === constants_1.FieldTag.MD_ENTRY_TYPE) {
                    currentEntry.number_of_orders = parseInt(value, 10);
                }
                else if (tag === constants_1.FieldTag.NO_ORDERS) {
                    noOrders = parseInt(value, 10);
                }
                else if (tag === constants_1.FieldTag.ORDER_QTY && noOrders > 0) {
                    currentOrders.push({
                        order_id: "",
                        order_quantity: parseFloat(value),
                    });
                }
                else if (tag === constants_1.FieldTag.ORDER_ID && currentOrders.length > 0) {
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
        logger_1.default.info(`Parsed market data snapshot: ${JSON.stringify(jsonOutput, null, 2)}`);
        return jsonOutput;
    }
    catch (error) {
        logger_1.default.error(`Error parsing FIX message: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
};
exports.parseMarketDataSnapshotToJson = parseMarketDataSnapshotToJson;
