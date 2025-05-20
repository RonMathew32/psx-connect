"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHeartbeatMessage = createHeartbeatMessage;
exports.getMessageTypeName = getMessageTypeName;
const constants_1 = require("./constants");
const message_builder_1 = require("./message-builder");
/**
 * Create a heartbeat message
 */
function createHeartbeatMessage(options, seqManager, testReqId) {
    const builder = (0, message_builder_1.createMessageBuilder)();
    builder
        .setMsgType(constants_1.MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(seqManager.getNextAndIncrement());
    if (testReqId) {
        builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
    }
    return builder.buildMessage();
}
/**
 * Get human-readable name for a message type
 */
function getMessageTypeName(msgType) {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(constants_1.MessageType)) {
        if (value === msgType) {
            return name;
        }
    }
    return 'UNKNOWN';
}
