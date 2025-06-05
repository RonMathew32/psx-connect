"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentTimestamp = getCurrentTimestamp;
exports.getMessageTypeByChannelNo = getMessageTypeByChannelNo;
exports.getMessageTypeName = getMessageTypeName;
const constants_1 = require("../constants");
/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 *
 * @returns Current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 *
 */
function getCurrentTimestamp() {
    const now = new Date();
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
    const year = now.getUTCFullYear();
    const month = pad(now.getUTCMonth() + 1);
    const day = pad(now.getUTCDate());
    const hours = pad(now.getUTCHours());
    const minutes = pad(now.getUTCMinutes());
    const seconds = pad(now.getUTCSeconds());
    const milliseconds = pad(now.getUTCMilliseconds(), 3);
    return `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
}
/**
* Get message type description based on ChannelNo
* This helps identify the type of message received based on the ChannelNo field
* @param channelNo The channel number from the FIX message
* @returns Description of the message type
*/
function getMessageTypeByChannelNo(channelNo) {
    const channelNoNum = parseInt(channelNo, 10);
    switch (channelNoNum) {
        case 1:
            return 'TradingSessionStatus/SecurityStatus';
        case 2:
            return 'News';
        case 10:
            return 'Index Snapshot';
        case 1011:
            return 'Share Auction Snapshot';
        case 1021:
            return 'Fund Auction Snapshot';
        case 1031:
            return 'Bond Auction Snapshot';
        case 1041:
            return 'Stock Deliverable Future Auction Snapshot';
        case 1051:
            return 'Stock Cash Settled Future Auction Snapshot';
        case 1061:
            return 'Stock Deliverable Option Auction Snapshot';
        case 1071:
            return 'Stock Index Option Auction Snapshot';
        case 1081:
            return 'Stock Index Future Auction Snapshot';
        case 2011:
            return 'Share TickData (tick order message)';
        case 2021:
            return 'Fund TickData (tick execution message)';
        case 2041:
            return 'Stock Deliverable Future TickData';
        case 2051:
            return 'Stock Cash Settled Future TickData';
        case 2061:
            return 'Stock Deliverable Option TickData';
        case 2071:
            return 'Stock Index Option TickData';
        case 2081:
            return 'Stock Index Future TickData';
        case 3011:
            return 'Equities Square Up Snapshot';
        case 3021:
            return 'Odd Lot Snapshot';
        case 3041:
            return 'Futures Square Up Snapshot';
        case 4001:
            return 'Negotiated Deal Market TickData';
        case 4021:
            return 'Odd Lot TickData';
        default:
            return 'Unknown Message Type';
    }
}
function getMessageTypeName(msgType) {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(constants_1.MessageType)) {
        if (value === msgType) {
            return name;
        }
    }
    return 'UNKNOWN';
}
