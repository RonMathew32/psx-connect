import { logger } from "./logger";

export class ConnectionState {
    private connected: boolean = false;
    private loggedIn: boolean = false;
    private requests: Map<string, boolean> = new Map([
      ['equitySecurities', false],
      ['indexSecurities', false],
    ]);
  
    setConnected(value: boolean): void {
      this.connected = value;
      logger.info(`[STATE] Connection state updated: connected=${value}`);
    }
  
    isConnected(): boolean {
      return this.connected;
    }
  
    setLoggedIn(value: boolean): void {
      this.loggedIn = value;
      logger.info(`[STATE] Login state updated: loggedIn=${value}`);
    }
  
    isLoggedIn(): boolean {
      return this.loggedIn;
    }
  
    setRequestSent(requestType: string, value: boolean): void {
      this.requests.set(requestType, value);
      logger.info(`[STATE] Request state updated: ${requestType}=${value}`);
    }
  
    hasRequestBeenSent(requestType: string): boolean {
      return this.requests.get(requestType) || false;
    }
  
    reset(): void {
      this.connected = false;
      this.loggedIn = false;
      this.requests.forEach((_, key) => this.requests.set(key, false));
      logger.info('[STATE] Connection state reset');
    }
  }