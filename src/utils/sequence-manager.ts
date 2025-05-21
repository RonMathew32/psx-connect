import { logger } from '../utils/logger';
import { SequenceStore } from './sequence-store';

/**
 * Manages sequence numbers for FIX protocol communication
 */
export class SequenceManager {
  private mainSeqNum: number;
  private serverSeqNum: number = 1;
  private marketDataSeqNum: number;
  private securityListSeqNum: number;
  private tradingStatusSeqNum: number;
  private sequenceStore: SequenceStore;

  constructor(initialSeq?: { main?: number; marketData?: number; securityList?: number; tradingStatus?: number }) {
    this.sequenceStore = new SequenceStore();
    
    // Try to load sequence numbers from stored file if it exists
    const storedSequences = this.sequenceStore.loadSequences();
    
    if (storedSequences) {
      logger.info('[SEQUENCE] Loaded sequence numbers from store for current day');
      this.mainSeqNum = storedSequences.main;
      this.serverSeqNum = storedSequences.server;
      this.marketDataSeqNum = storedSequences.marketData;
      this.securityListSeqNum = storedSequences.securityList;
      this.tradingStatusSeqNum = storedSequences.tradingStatus;
    } else {
      // If no stored sequences or explicitly provided, use defaults or provided values
      this.mainSeqNum = initialSeq?.main ?? 1;
      this.marketDataSeqNum = initialSeq?.marketData ?? 1;
      this.securityListSeqNum = initialSeq?.securityList ?? 1; // Changed from 2 to 1
      this.tradingStatusSeqNum = initialSeq?.tradingStatus ?? 1; // Changed from 2 to 1
    }
    
    logger.info('[SEQUENCE] Initializing sequence manager with:', this.getAll());
  }
  
  /**
   * Reset sequence numbers to a specific value
   * Used when the server expects a specific sequence number
   */
  public forceReset(newSeq: number = 1): void {
    logger.info(`[SEQUENCE] Force resetting all sequence numbers to ${newSeq}`);
    this.mainSeqNum = newSeq;
    this.serverSeqNum = newSeq;
    this.marketDataSeqNum = newSeq; // Changed from 1 to newSeq
    this.securityListSeqNum = newSeq; // Align security list with main sequence
    this.tradingStatusSeqNum = newSeq; // Align trading status with main sequence
    
    // Store the updated sequence numbers
    this.saveToStore();
  }

  /**
   * Get the next main sequence number and increment it
   */
  public getNextAndIncrement(): number {
    const current = this.mainSeqNum;
    this.mainSeqNum++;
    logger.debug(`[SEQUENCE] Main sequence incremented to ${this.mainSeqNum}`);
    
    // Store updated sequence numbers after increment
    this.saveToStore();
    
    return current;
  }

  /**
   * Get the next market data sequence number and increment it
   */
  public getNextMarketDataAndIncrement(): number {
    const current = this.marketDataSeqNum;
    this.marketDataSeqNum++;
    logger.debug(`[SEQUENCE] Market data sequence incremented to ${this.marketDataSeqNum}`);
    
    // Store updated sequence numbers after increment
    this.saveToStore();
    
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
    
    // Store updated sequence numbers after increment
    this.saveToStore();
    
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
    
    // Store updated sequence numbers after increment
    this.saveToStore();
    
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
    
    // Store updated sequence numbers
    this.saveToStore();
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
    
    // Store updated sequence numbers
    this.saveToStore();
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
    
    // Store updated sequence numbers
    this.saveToStore();
  }

  /**
   * Handle sequence number setup after logon
   */
  public processLogon(serverSeqNum: number, resetFlag: boolean): void {
    this.serverSeqNum = serverSeqNum;

    if (resetFlag) {
      // If reset flag is Y, set our next sequence number to 1
      this.mainSeqNum = 1;
      this.securityListSeqNum = 1;
      this.tradingStatusSeqNum = 1;
      this.marketDataSeqNum = 1;
      logger.info(`[SEQUENCE] Reset sequence flag is Y, setting all sequence numbers to 1`);
    } else {
      // If no reset flag, align with server's sequence
      this.mainSeqNum = serverSeqNum + 1;
      this.securityListSeqNum = this.mainSeqNum;
      this.tradingStatusSeqNum = this.mainSeqNum;
      this.marketDataSeqNum = 1; // Always start marketData at 1 after logon
      logger.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${this.mainSeqNum}, SecurityList=${this.securityListSeqNum}, TradingStatus=${this.tradingStatusSeqNum}, MarketData=${this.marketDataSeqNum}`);
    }
    
    // Store updated sequence numbers after logon
    this.saveToStore();
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
      
      // Store updated sequence numbers
      this.saveToStore();
    }
  }

  /**
   * Reset all sequence numbers to initial values (1)
   */
  public resetAll(): void {
    logger.info('[SEQUENCE] Resetting all sequence numbers to 1');
    this.mainSeqNum = 1;
    this.serverSeqNum = 1;
    this.marketDataSeqNum = 1;
    this.securityListSeqNum = 1; // Changed from 2 to 1
    this.tradingStatusSeqNum = 1; // Changed from 2 to 1
    
    // Store reset sequence numbers
    this.saveToStore();
  }

  /**
   * Reset regular sequence without affecting other streams
   */
  public resetRegularSequence(mainSeq: number = 1, serverSeq: number = 1): void {
    logger.info(`[SEQUENCE] Resetting regular sequence: main=${mainSeq}, server=${serverSeq}`);
    this.mainSeqNum = mainSeq;
    this.serverSeqNum = serverSeq;
    this.saveToStore();
  }

  /**
   * Reset market data sequence without affecting other streams
   */
  public resetMarketDataSequence(seqNum: number = 1, serverSeq: number = 1): void {
    logger.info(`[SEQUENCE] Resetting market data sequence to ${seqNum}`);
    this.marketDataSeqNum = seqNum;
    this.saveToStore();
  }

  /**
   * Reset security list sequence without affecting other streams
   */
  public resetSecurityListSequence(seqNum: number = 1, serverSeq: number = 1): void {
    logger.info(`[SEQUENCE] Resetting security list sequence to ${seqNum}`);
    this.securityListSeqNum = seqNum;
    
    // Also update main sequence if needed
    if (seqNum > this.mainSeqNum) {
      logger.info(`[SEQUENCE] Also updating main sequence to ${seqNum} to maintain alignment`);
      this.mainSeqNum = seqNum;
    }
    
    this.saveToStore();
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
  
  /**
   * Save current sequence numbers to persistent store
   */
  private saveToStore(): void {
    this.sequenceStore.saveSequences(this.getAll());
  }
} 