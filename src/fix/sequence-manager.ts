import logger from '../utils/logger';

/**
 * Manages sequence numbers for FIX protocol communication
 */
export class SequenceManager {
  private msgSeqNum = 1;
  private serverSeqNum = 1;
  private marketDataSeqNum = 1;
  private securityListSeqNum = 2; // Initialize with different number for security list

  /**
   * Reset sequence numbers to a specific value
   * Used when the server expects a specific sequence number
   */
  public forceReset(newSeq: number = 2): void {
    const oldMain = this.msgSeqNum;
    this.msgSeqNum = newSeq;
    this.serverSeqNum = newSeq - 1;
    // Ensure security list always has a different sequence number than market data
    this.securityListSeqNum = newSeq + 1;
    this.marketDataSeqNum = newSeq;
    logger.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldMain} to ${this.msgSeqNum} (server: ${this.serverSeqNum})`);
    logger.info(`[SEQUENCE] Security list sequence set to ${this.securityListSeqNum}, market data sequence set to ${this.marketDataSeqNum}`);
  }

  /**
   * Get the next main sequence number and increment it
   */
  public getNextAndIncrement(): number {
    return this.msgSeqNum++;
  }
  
  /**
   * Get the next market data sequence number and increment it
   */
  public getNextMarketDataAndIncrement(): number {
    return this.marketDataSeqNum++;
  }
  
  /**
   * Get the next security list sequence number and increment it
   */
  public getNextSecurityListAndIncrement(): number {
    return this.securityListSeqNum++;
  }
  
  /**
   * Get the current main sequence number
   */
  public getMainSeqNum(): number {
    return this.msgSeqNum;
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
   * Get the current security list sequence number
   */
  public getSecurityListSeqNum(): number {
    return this.securityListSeqNum;
  }
  
  /**
   * Set the market data sequence number
   */
  public setMarketDataSeqNum(seqNum: number): void {
    const oldSeq = this.marketDataSeqNum;
    this.marketDataSeqNum = seqNum;
    logger.info(`[SEQUENCE] Set market data sequence number: ${oldSeq} -> ${this.marketDataSeqNum}`);
  }

  /**
   * Set the security list sequence number
   */
  public setSecurityListSeqNum(seqNum: number): void {
    const oldSeq = this.securityListSeqNum;
    this.securityListSeqNum = seqNum;
    logger.info(`[SEQUENCE] Set security list sequence number: ${oldSeq} -> ${this.securityListSeqNum}`);
  }

  /**
   * Handle sequence number setup after logon
   */
  public setupAfterLogon(serverSeqNumParam: number, resetFlag: boolean): void {
    this.serverSeqNum = serverSeqNumParam;
    
    // If reset sequence number flag is Y, we should reset our sequence counter to 2
    // (1 for the server's logon acknowledgment, and our next message will be 2)
    if (resetFlag) {
      this.msgSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
      // IMPORTANT: Keep SecurityList and MarketData sequence numbers separate
      this.securityListSeqNum = 3; // SecurityList starts at 3 (different from MarketData)
      this.marketDataSeqNum = 2; // MarketData starts at 2
      logger.info(`[SEQUENCE] Reset sequence flag is Y, setting sequence numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, MarketData=${this.marketDataSeqNum}`);
    } else {
      // Otherwise, set our next sequence to be one more than the server's
      this.msgSeqNum = this.serverSeqNum + 1;
      // Ensure SecurityList and MarketData sequence numbers are distinct
      this.securityListSeqNum = this.msgSeqNum + 1;
      this.marketDataSeqNum = this.msgSeqNum;
      logger.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.msgSeqNum}, SecurityList=${this.securityListSeqNum}, MarketData=${this.marketDataSeqNum}`);
    }
  }

  /**
   * Update server sequence number based on incoming message
   * Returns true if the sequence was updated
   */
  public updateServerSequence(incomingSeqNum: number): boolean {
    // For normal messages, track the server's sequence
    this.serverSeqNum = incomingSeqNum;
    logger.info(`Server sequence number updated to: ${this.serverSeqNum}`);

    // Our next message should be one more than what the server expects
    // The server expects our next message to have a sequence number of serverSeqNum + 1
    if (this.msgSeqNum <= this.serverSeqNum) {
      this.msgSeqNum = this.serverSeqNum + 1;
      logger.info(`Updated our next sequence number to: ${this.msgSeqNum}`);
      return true;
    }
    return false;
  }

  /**
   * Reset all sequence numbers to initial values
   */
  public resetAll(): void {
    this.msgSeqNum = 1;
    this.serverSeqNum = 1;
    this.marketDataSeqNum = 1;
    this.securityListSeqNum = 2; // SecurityList uses a different sequence number
    logger.info('[SEQUENCE] All sequence numbers reset to initial values');
  }

  /**
   * Get all sequence numbers
   */
  public getAll(): { main: number; server: number; marketData: number; securityList: number } {
    return {
      main: this.msgSeqNum,
      server: this.serverSeqNum,
      marketData: this.marketDataSeqNum,
      securityList: this.securityListSeqNum
    };
  }
} 