"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionState = void 0;
const logger_1 = require("./logger");
class ConnectionState {
    constructor() {
        this.connected = false;
        this.loggedIn = false;
        this.requests = new Map([
            ['equitySecurities', false],
            ['indexSecurities', false],
        ]);
    }
    setConnected(value) {
        this.connected = value;
        logger_1.logger.info(`[STATE] Connection state updated: connected=${value}`);
    }
    isConnected() {
        return this.connected;
    }
    setLoggedIn(value) {
        this.loggedIn = value;
        logger_1.logger.info(`[STATE] Login state updated: loggedIn=${value}`);
    }
    isLoggedIn() {
        return this.loggedIn;
    }
    setRequestSent(requestType, value) {
        this.requests.set(requestType, value);
        logger_1.logger.info(`[STATE] Request state updated: ${requestType}=${value}`);
    }
    hasRequestBeenSent(requestType) {
        return this.requests.get(requestType) || false;
    }
    reset() {
        this.connected = false;
        this.loggedIn = false;
        this.requests.forEach((_, key) => this.requests.set(key, false));
        logger_1.logger.info('[STATE] Connection state reset');
    }
}
exports.ConnectionState = ConnectionState;
