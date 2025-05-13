"use strict";
/**
 * FIX Session Manager
 *
 * Handles the state of a FIX protocol session, including connection state,
 * authentication status, reconnection logic, and heartbeat monitoring.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = exports.SessionState = void 0;
const events_1 = require("events");
const logger_1 = __importDefault(require("../utils/logger"));
var SessionState;
(function (SessionState) {
    SessionState["DISCONNECTED"] = "DISCONNECTED";
    SessionState["CONNECTING"] = "CONNECTING";
    SessionState["CONNECTED"] = "CONNECTED";
    SessionState["LOGGED_IN"] = "LOGGED_IN";
    SessionState["LOGGING_OUT"] = "LOGGING_OUT";
    SessionState["SEQUENCE_RESET"] = "SEQUENCE_RESET";
    SessionState["ERROR"] = "ERROR";
})(SessionState || (exports.SessionState = SessionState = {}));
class SessionManager extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.state = SessionState.DISCONNECTED;
        // Timers
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.testRequestTimer = null;
        // Tracking
        this.lastActivityTime = 0;
        this.testRequestCount = 0;
        this.reconnectCount = 0;
        this.sequenceResetInProgress = false;
        this.reconnectDelayMs = options?.reconnectDelayMs ?? 5000;
        this.heartbeatIntervalSecs = options?.heartbeatIntervalSecs ?? 30;
        this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 35000;
        this.maxTestRequestRetries = options?.maxTestRequestRetries ?? 2;
        logger_1.default.info(`[SESSION] Initialized with heartbeat=${this.heartbeatIntervalSecs}s, reconnect=${this.reconnectDelayMs}ms`);
    }
    /**
     * Get the current session state
     */
    getState() {
        return this.state;
    }
    /**
     * Check if the session is in a specific state
     */
    isState(state) {
        return this.state === state;
    }
    /**
     * Check if the session is connected (socket connected, may not be logged in)
     */
    isConnected() {
        return this.state === SessionState.CONNECTED ||
            this.state === SessionState.LOGGED_IN;
    }
    /**
     * Check if the session is logged in to the FIX server
     */
    isLoggedIn() {
        return this.state === SessionState.LOGGED_IN;
    }
    /**
     * Update session state to CONNECTING
     */
    connecting() {
        const oldState = this.state;
        this.state = SessionState.CONNECTING;
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Update session state to CONNECTED
     */
    connected() {
        const oldState = this.state;
        this.state = SessionState.CONNECTED;
        this.reconnectCount = 0;
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Update session state to DISCONNECTED
     */
    disconnected() {
        const oldState = this.state;
        this.state = SessionState.DISCONNECTED;
        this.clearTimers();
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Update session state to LOGGED_IN
     */
    loggedIn() {
        const oldState = this.state;
        this.state = SessionState.LOGGED_IN;
        this.lastActivityTime = Date.now();
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
    }
    /**
     * Update session state to LOGGING_OUT
     */
    loggingOut() {
        const oldState = this.state;
        this.state = SessionState.LOGGING_OUT;
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Update session state to ERROR
     */
    error(errorMessage) {
        const oldState = this.state;
        this.state = SessionState.ERROR;
        this.emit('stateChange', oldState, this.state);
        this.emit('error', new Error(errorMessage));
        logger_1.default.error(`[SESSION] Error: ${errorMessage}`);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Enter sequence reset state
     */
    sequenceReset() {
        const oldState = this.state;
        this.state = SessionState.SEQUENCE_RESET;
        this.sequenceResetInProgress = true;
        this.emit('stateChange', oldState, this.state);
        logger_1.default.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    }
    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectCount++;
        const delay = Math.min(this.reconnectDelayMs * Math.pow(1.5, this.reconnectCount - 1), 30000);
        logger_1.default.info(`[SESSION] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectCount})`);
        this.reconnectTimer = setTimeout(() => {
            this.emit('reconnect');
        }, delay);
    }
    /**
     * Record activity to reset heartbeat timeouts
     */
    recordActivity() {
        this.lastActivityTime = Date.now();
        this.testRequestCount = 0;
        if (this.testRequestTimer) {
            clearTimeout(this.testRequestTimer);
            this.testRequestTimer = null;
        }
    }
    /**
     * Start heartbeat monitoring
     */
    startHeartbeatMonitoring() {
        this.clearTimers();
        logger_1.default.info(`[SESSION] Starting heartbeat monitoring (interval: ${this.heartbeatIntervalSecs}s)`);
        this.lastActivityTime = Date.now();
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            const elapsed = now - this.lastActivityTime;
            // If no activity for longer than heartbeat interval, send a test request
            if (elapsed > this.heartbeatIntervalSecs * 1000) {
                if (this.testRequestCount < this.maxTestRequestRetries) {
                    this.testRequestCount++;
                    logger_1.default.warn(`[SESSION] No activity for ${elapsed}ms, sending test request (${this.testRequestCount}/${this.maxTestRequestRetries})`);
                    this.emit('testRequest');
                    // Set a timeout for the test request response
                    if (this.testRequestTimer) {
                        clearTimeout(this.testRequestTimer);
                    }
                    this.testRequestTimer = setTimeout(() => {
                        logger_1.default.error(`[SESSION] Test request timed out after ${this.heartbeatTimeoutMs}ms`);
                        this.emit('testRequestTimeout');
                    }, this.heartbeatTimeoutMs);
                }
                else {
                    logger_1.default.error(`[SESSION] Max test request retries (${this.maxTestRequestRetries}) exceeded, considering connection lost`);
                    this.emit('connectionLost');
                }
            }
            else if (elapsed > this.heartbeatIntervalSecs * 500) {
                // If we're approaching the heartbeat interval, send a heartbeat
                logger_1.default.debug(`[SESSION] Sending preemptive heartbeat`);
                this.emit('heartbeat');
            }
        }, this.heartbeatIntervalSecs * 500); // Check twice per heartbeat interval
    }
    /**
     * Clear all timers
     */
    clearTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.testRequestTimer) {
            clearTimeout(this.testRequestTimer);
            this.testRequestTimer = null;
        }
    }
    /**
     * Get a description of the current session state
     */
    getSessionInfo() {
        return {
            state: this.state,
            reconnectCount: this.reconnectCount,
            lastActivityTime: this.lastActivityTime,
            testRequestCount: this.testRequestCount,
            heartbeatIntervalSecs: this.heartbeatIntervalSecs,
            sequenceResetInProgress: this.sequenceResetInProgress
        };
    }
}
exports.SessionManager = SessionManager;
exports.default = SessionManager;
