"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const message_builder_1 = require("../fix/message-builder");
// Default connection parameters
const senderCompId = 'realtime';
const targetCompId = 'NMDUFISQ0001';
const username = 'realtime';
const password = 'NMDUFISQ0001';
// Generate logon message
const logonMessage = message_builder_1.FixMessageBuilder.createLogonMessage(senderCompId, targetCompId, username, password, true, // resetSeqNum
30 // heartbeatInterval
);
// Display the message in a human-readable format
console.log('FIX Logon Message:');
console.log(logonMessage.replace(/\x01/g, '|'));
// Display just the raw message for direct use
console.log('\nRaw message (for direct use):');
console.log(logonMessage);
