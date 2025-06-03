"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFixMessage = parseFixMessage;
const constants_1 = require("../constants");
/**
 * Parse a FIX message string into a tag-value object
 * @param message The raw FIX message string
 * @returns ParsedFixMessage or null if parsing failed
 */
function parseFixMessage(message) {
    try {
        const result = {};
        // Split on SOH character
        const fields = message.split(constants_1.SOH);
        // Process each field
        for (const field of fields) {
            if (!field)
                continue;
            // Split tag=value
            const separatorIndex = field.indexOf('=');
            if (separatorIndex > 0) {
                const tag = field.substring(0, separatorIndex);
                const value = field.substring(separatorIndex + 1);
                result[tag] = value;
            }
        }
        return result;
    }
    catch (error) {
        console.error('Error parsing FIX message:', error);
        return null;
    }
}
