import logger from '../utils/logger';

/**
 * Manages sequence numbers for FIX protocol communication
 */
export class SequenceManager {
  private mainSeqNum: number = 1;
  private serverSeqNum: number = 1;
  private marketDataSeqNum: number = 1;
  private securityListSeqNum: number = 2;
  private tradingStatusSeqNum: number = 2;

  constructor() {
    logger.info('[SEQUENCE] Initializing sequence manager with:');
    logger.info(`[SEQUENCE] Main seq: ${this.mainSeqNum}, Server seq: ${this.serverSeqNum}`);
    logger.info(`[SEQUENCE] Market data seq: ${this.marketDataSeqNum}, Security list seq: ${this.securityListSeqNum}, Trading status seq: ${this.tradingStatusSeqNum}`);
  }

  /**
   * Reset sequence numbers to a specific value
   * Used when the server expects a specific sequence number
   */
  public forceReset(newSeq: number = 1): void {
    logger.info(`[SEQUENCE] Force resetting all sequence numbers to ${newSeq}`);
    this.mainSeqNum = newSeq;
    this.serverSeqNum = newSeq;
    this.marketDataSeqNum = 1; // Market data always starts at 1
    this.securityListSeqNum = newSeq; // Align security list with main sequence
    this.tradingStatusSeqNum = newSeq; // Align trading status with main sequence
  }

  /**
   * Get the next main sequence number and increment it
   */
  public getNextAndIncrement(): number {
    const current = this.mainSeqNum;
    this.mainSeqNum++;
    logger.debug(`[SEQUENCE] Main sequence incremented to ${this.mainSeqNum}`);
    return current;
  }
  
  /**
   * Get the next market data sequence number and increment it
   */
  public getNextMarketDataAndIncrement(): number {
    const current = this.marketDataSeqNum;
    this.marketDataSeqNum++;
    logger.debug(`[SEQUENCE] Market data sequence incremented to ${this.marketDataSeqNum}`);
    return current;
  }
  
  /**
   * Get the security list sequence number
   * This should be used when sending security list requests
   */
  public getSecurityListSeqNum(): number {
    logger.info(`[SEQUENCE] Getting security list sequence: ${this.securityListSeqNum}`);
    return this.securityListSeqNum;
  }
  
  /**
   * Get trading status sequence number
   * Starts at 3 for PSX, but can be higher if server has rejected previous messages
   */
  public getTradingStatusSeqNum(): number {
    logger.info(`[SEQUENCE] Getting trading status sequence: ${this.tradingStatusSeqNum}`);
    return this.tradingStatusSeqNum;
  }
  
  /**
   * Get security list sequence number for incrementing
   * This should be used when sending security list requests
   */
  public getNextSecurityListAndIncrement(): number {
    const current = this.securityListSeqNum;
    this.securityListSeqNum++;
    // Also update main sequence to maintain alignment
    if (this.securityListSeqNum > this.mainSeqNum) {
      this.mainSeqNum = this.securityListSeqNum;
    }
    logger.debug(`[SEQUENCE] Security list sequence incremented to ${this.securityListSeqNum}`);
    return current;
  }
  
  /**
   * Get trading status sequence number for incrementing
   * This should be used when sending trading status requests
   */
  public getNextTradingStatusAndIncrement(): number {
    const current = this.tradingStatusSeqNum;
    this.tradingStatusSeqNum++;
    // Also update main sequence to maintain alignment
    if (this.tradingStatusSeqNum > this.mainSeqNum) {
      this.mainSeqNum = this.tradingStatusSeqNum;
    }
    logger.debug(`[SEQUENCE] Trading status sequence incremented to ${this.tradingStatusSeqNum}`);
    return current;
  }
  
  /**
   * Get the current main sequence number
   */
  public getMainSeqNum(): number {
    return this.mainSeqNum;
  }
  
  /**
   * Get the current server sequence number
   */
  public getServerSeqNum(): number {
    return this.serverSeqNum;
  }
  
  /**
   * Get the current market data sequence number
   */
  public getMarketDataSeqNum(): number {
    return this.marketDataSeqNum;
  }
  
  /**
   * Set the market data sequence number
   */
  public setMarketDataSeqNum(value: number): void {
    const oldSeq = this.marketDataSeqNum;
    this.marketDataSeqNum = value;
    logger.debug(`[SEQUENCE] Set market data sequence number to ${value}`);
  }

  /**
   * Set the security list sequence number
   */
  public setSecurityListSeqNum(value: number): void {
    const oldSeq = this.securityListSeqNum;
    this.securityListSeqNum = value;
    logger.debug(`[SEQUENCE] Set security list sequence number to ${value}`);
    
    // Also update the main sequence if needed
    if (value > this.mainSeqNum) {
      logger.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
      this.mainSeqNum = value;
    }
  }

  /**
   * Set the trading status sequence number
   */
  public setTradingStatusSeqNum(value: number): void {
    const oldSeq = this.tradingStatusSeqNum;
    this.tradingStatusSeqNum = value;
    logger.debug(`[SEQUENCE] Set trading status sequence number to ${value}`);
    
    // Also update the main sequence if needed
    if (value > this.mainSeqNum) {
      logger.info(`[SEQUENCE] Also updating main sequence to ${value} to maintain alignment`);
      this.mainSeqNum = value;
    }
  }

  /**
   * Handle sequence number setup after logon
   */
  public processLogon(serverSeqNum: number, resetFlag: boolean): void {
    this.serverSeqNum = serverSeqNum;
    
    // If reset flag is Y, set our next sequence number to 2
    // (1 for the server's logon acknowledgment, and our next message will be 2)
    if (resetFlag) {
      this.mainSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
      // Align all sequences with main sequence
      this.securityListSeqNum = this.mainSeqNum;
      this.tradingStatusSeqNum = this.mainSeqNum;
      this.marketDataSeqNum = 1; // MarketData starts at 1
      logger.info(`[SEQUENCE] Reset sequence flag is Y, setting sequence numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
    } else {
      // Otherwise, set our next sequence to be one more than the server's
      this.mainSeqNum = this.serverSeqNum + 1;
      // Align all sequences with main sequence
      this.securityListSeqNum = this.mainSeqNum;
      this.tradingStatusSeqNum = this.mainSeqNum;
      this.marketDataSeqNum = 1; // Always start marketData at 1 after logon
      logger.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
    }
  }

  /**
   * Update server sequence number based on incoming message
   * Returns true if the sequence was updated
   */
  public updateServerSequence(newValue: number): void {
    if (newValue > this.serverSeqNum) {
      logger.debug(`[SEQUENCE] Updating server sequence from ${this.serverSeqNum} to ${newValue}`);
      this.serverSeqNum = newValue;
      
      // If server sequence is higher than our sequences, update them
      if (newValue >= this.mainSeqNum) {
        this.mainSeqNum = newValue + 1;
        this.securityListSeqNum = this.mainSeqNum;
        this.tradingStatusSeqNum = this.mainSeqNum;
        logger.info(`[SEQUENCE] Aligning sequences with server: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}`);
      }
    }
  }

  /**
   * Reset all sequence numbers to initial values
   */
  public resetAll(): void {
    logger.info('[SEQUENCE] Resetting all sequence numbers to initial values');
    this.mainSeqNum = 1;
    this.serverSeqNum = 1;
    this.marketDataSeqNum = 1;
    this.securityListSeqNum = 2;
    this.tradingStatusSeqNum = 2;
  }

  /**
   * Get all sequence numbers
   */
  public getAll(): { main: number; server: number; marketData: number; securityList: number; tradingStatus: number } {
    return {
      main: this.mainSeqNum,
      server: this.serverSeqNum,
      marketData: this.marketDataSeqNum,
      securityList: this.securityListSeqNum,
      tradingStatus: this.tradingStatusSeqNum
    };
  }
} 