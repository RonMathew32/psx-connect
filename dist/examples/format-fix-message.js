"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const message_builder_1 = require("../fix/message-builder");
const message_parser_1 = require("../fix/message-parser");
// Default connection parameters for PSX
const senderCompId = 'realtime';
const targetCompId = 'NMDUFISQ0001';
const username = 'realtime';
const password = 'NMDUFISQ0001';
// Generate logon message
const logonMessage = message_builder_1.FixMessageBuilder.createLogonMessage(senderCompId, targetCompId, username, password, true, // resetSeqNum
30 // heartbeatInterval
);
// Parse the message back to validate it
const parsedMessage = message_parser_1.FixMessageParser.parse(logonMessage);
// Display the message in various formats
console.log('FIX Logon Message (Pipe-Delimited Format):');
console.log(logonMessage.replace(/\x01/g, '|'));
console.log('');
console.log('FIX Logon Message (Hex View):');
const hexView = logonMessage.split('').map(c => {
    const code = c.charCodeAt(0);
    if (code === 1) {
        return '[SOH]'; // Start of Heading (ASCII 1)
    }
    else {
        return c;
    }
}).join('');
console.log(hexView);
console.log('');
console.log('Parsed Message Fields:');
Object.entries(parsedMessage).forEach(([tag, value]) => {
    let fieldName = '';
    // Identify common FIX fields
    switch (tag) {
        case '8':
            fieldName = 'BeginString';
            break;
        case '9':
            fieldName = 'BodyLength';
            break;
        case '35':
            fieldName = 'MsgType';
            break;
        case '49':
            fieldName = 'SenderCompID';
            break;
        case '56':
            fieldName = 'TargetCompID';
            break;
        case '34':
            fieldName = 'MsgSeqNum';
            break;
        case '52':
            fieldName = 'SendingTime';
            break;
        case '98':
            fieldName = 'EncryptMethod';
            break;
        case '108':
            fieldName = 'HeartBtInt';
            break;
        case '141':
            fieldName = 'ResetSeqNumFlag';
            break;
        case '553':
            fieldName = 'Username';
            break;
        case '554':
            fieldName = 'Password';
            break;
        case '1137':
            fieldName = 'DefaultApplVerID';
            break;
        case '1129':
            fieldName = 'DefaultCstmApplVerID';
            break;
        case '115':
            fieldName = 'OnBehalfOfCompID';
            break;
        case '96':
            fieldName = 'RawData';
            break;
        case '95':
            fieldName = 'RawDataLength';
            break;
        case '10':
            fieldName = 'CheckSum';
            break;
        default:
            fieldName = 'Unknown';
            break;
    }
    console.log(`  ${tag} (${fieldName}): ${value}`);
});
// Verify the checksum
const isValid = message_parser_1.FixMessageParser.verifyChecksum(logonMessage);
console.log('');
console.log(`Checksum verification: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
// Display raw message (for direct use)
console.log('');
console.log('Raw message (for direct use with actual SOH characters):');
console.log(logonMessage);
