"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFixOptions = validateFixOptions;
function validateFixOptions(options) {
    const requiredFields = [
        'host',
        'port',
        'senderCompId',
        'targetCompId',
        'username',
        'password',
        'heartbeatIntervalSecs',
    ];
    for (const field of requiredFields) {
        if (!options[field] || (typeof options[field] === 'string' && options[field].trim() === '')) {
            throw new Error(`Missing or invalid configuration: ${field}`);
        }
    }
    if (isNaN(options.port) || options.port <= 0) {
        throw new Error('Invalid port number');
    }
    if (isNaN(options.heartbeatIntervalSecs) || options.heartbeatIntervalSecs <= 0) {
        throw new Error('Invalid heartbeat interval');
    }
}
