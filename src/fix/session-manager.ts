/**
 * FIX Session Manager
 * 
 * Handles the state of a FIX protocol session, including connection state,
 * authentication status, reconnection logic, and heartbeat monitoring.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';

export enum SessionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  LOGGED_IN = 'LOGGED_IN',
  LOGGING_OUT = 'LOGGING_OUT',
  SEQUENCE_RESET = 'SEQUENCE_RESET',
  ERROR = 'ERROR'
}

export interface SessionOptions {
  reconnectDelayMs?: number;
  heartbeatIntervalSecs?: number;
  heartbeatTimeoutMs?: number;
  maxTestRequestRetries?: number;
}

export class SessionManager extends EventEmitter {
  private state: SessionState = SessionState.DISCONNECTED;
  private reconnectDelayMs: number;
  private heartbeatIntervalSecs: number;
  private heartbeatTimeoutMs: number;
  private maxTestRequestRetries: number;
  
  // Timers
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private testRequestTimer: NodeJS.Timeout | null = null;
  
  // Tracking
  private lastActivityTime: number = 0;
  private testRequestCount: number = 0;
  private reconnectCount: number = 0;
  private sequenceResetInProgress: boolean = false;
  
  constructor(options?: SessionOptions) {
    super();
    this.reconnectDelayMs = options?.reconnectDelayMs ?? 5000;
    this.heartbeatIntervalSecs = options?.heartbeatIntervalSecs ?? 30;
    this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 35000;
    this.maxTestRequestRetries = options?.maxTestRequestRetries ?? 2;
    
    logger.info(`[SESSION] Initialized with heartbeat=${this.heartbeatIntervalSecs}s, reconnect=${this.reconnectDelayMs}ms`);
  }
  
  /**
   * Get the current session state
   */
  public getState(): SessionState {
    return this.state;
  }
  
  /**
   * Check if the session is in a specific state
   */
  public isState(state: SessionState): boolean {
    return this.state === state;
  }
  
  /**
   * Check if the session is connected (socket connected, may not be logged in)
   */
  public isConnected(): boolean {
    return this.state === SessionState.CONNECTED || 
           this.state === SessionState.LOGGED_IN;
  }
  
  /**
   * Check if the session is logged in to the FIX server
   */
  public isLoggedIn(): boolean {
    return this.state === SessionState.LOGGED_IN;
  }
  
  /**
   * Update session state to CONNECTING
   */
  public connecting(): void {
    const oldState = this.state;
    this.state = SessionState.CONNECTING;
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Update session state to CONNECTED
   */
  public connected(): void {
    const oldState = this.state;
    this.state = SessionState.CONNECTED;
    this.reconnectCount = 0;
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Update session state to DISCONNECTED
   */
  public disconnected(): void {
    const oldState = this.state;
    this.state = SessionState.DISCONNECTED;
    this.clearTimers();
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Update session state to LOGGED_IN
   */
  public loggedIn(): void {
    const oldState = this.state;
    this.state = SessionState.LOGGED_IN;
    this.lastActivityTime = Date.now();
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
    
    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
  }
  
  /**
   * Update session state to LOGGING_OUT
   */
  public loggingOut(): void {
    const oldState = this.state;
    this.state = SessionState.LOGGING_OUT;
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Update session state to ERROR
   */
  public error(errorMessage: string): void {
    const oldState = this.state;
    this.state = SessionState.ERROR;
    this.emit('stateChange', oldState, this.state);
    this.emit('error', new Error(errorMessage));
    logger.error(`[SESSION] Error: ${errorMessage}`);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Enter sequence reset state
   */
  public sequenceReset(): void {
    const oldState = this.state;
    this.state = SessionState.SEQUENCE_RESET;
    this.sequenceResetInProgress = true;
    this.emit('stateChange', oldState, this.state);
    logger.info(`[SESSION] State changed: ${oldState} -> ${this.state}`);
  }
  
  /**
   * Schedule a reconnection attempt
   */
  public scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectCount++;
    const delay = Math.min(this.reconnectDelayMs * Math.pow(1.5, this.reconnectCount - 1), 30000);
    
    logger.info(`[SESSION] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectCount})`);
    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnect');
    }, delay);
  }
  
  /**
   * Record activity to reset heartbeat timeouts
   */
  public recordActivity(): void {
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
  private startHeartbeatMonitoring(): void {
    this.clearTimers();
    
    logger.info(`[SESSION] Starting heartbeat monitoring (interval: ${this.heartbeatIntervalSecs}s)`);
    this.lastActivityTime = Date.now();
    
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastActivityTime;
      
      // If no activity for longer than heartbeat interval, send a test request
      if (elapsed > this.heartbeatIntervalSecs * 1000) {
        if (this.testRequestCount < this.maxTestRequestRetries) {
          this.testRequestCount++;
          logger.warn(`[SESSION] No activity for ${elapsed}ms, sending test request (${this.testRequestCount}/${this.maxTestRequestRetries})`);
          
          this.emit('testRequest');
          
          // Set a timeout for the test request response
          if (this.testRequestTimer) {
            clearTimeout(this.testRequestTimer);
          }
          
          this.testRequestTimer = setTimeout(() => {
            logger.error(`[SESSION] Test request timed out after ${this.heartbeatTimeoutMs}ms`);
            this.emit('testRequestTimeout');
          }, this.heartbeatTimeoutMs);
        } else {
          logger.error(`[SESSION] Max test request retries (${this.maxTestRequestRetries}) exceeded, considering connection lost`);
          this.emit('connectionLost');
        }
      } else if (elapsed > this.heartbeatIntervalSecs * 500) {
        // If we're approaching the heartbeat interval, send a heartbeat
        logger.debug(`[SESSION] Sending preemptive heartbeat`);
        this.emit('heartbeat');
      }
    }, this.heartbeatIntervalSecs * 500); // Check twice per heartbeat interval
  }
  
  /**
   * Clear all timers
   */
  public clearTimers(): void {
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
  public getSessionInfo(): object {
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

export default SessionManager; 