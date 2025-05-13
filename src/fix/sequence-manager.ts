/**
 * Sequence number manager for FIX protocol
 * 
 * This class manages sequence numbers for FIX protocol messages, providing
 * tracking of both outgoing and incoming sequence numbers, with special handling
 * for security list requests that need fixed sequence numbers.
 */

import logger from '../utils/logger';

export interface SequenceManagerOptions {
  // Allow customizing initial sequence numbers
  initialOutgoingSeqNum?: number;
  initialIncomingSeqNum?: number;
  // Special sequence number for security list requests
  securityListSeqNum?: number;
}

export class SequenceManager {
  // Regular sequence counters
  private outgoingSeqNum: number;
  private incomingSeqNum: number;
  
  // Completely separate security list sequence counters
  private securityListOutgoingSeqNum: number;
  private securityListIncomingSeqNum: number;
  
  // Track if we're in a special state
  private inSecurityListMode: boolean = false;
  
  constructor(options?: SequenceManagerOptions) {
    this.outgoingSeqNum = options?.initialOutgoingSeqNum ?? 1;
    this.incomingSeqNum = options?.initialIncomingSeqNum ?? 0;
    
    // Initialize separate security list sequence numbers
    this.securityListOutgoingSeqNum = options?.securityListSeqNum ?? 2;
    this.securityListIncomingSeqNum = 1; // Usually server expects response to sequence 2 to be 2
    
    logger.info(`[SEQUENCE] Initialized with outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum}`);
    logger.info(`[SEQUENCE] Security list sequence numbers initialized to outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
  }
  
  /**
   * Get the next outgoing sequence number based on current mode
   */
  public getNextOutgoingSeqNum(): number {
    if (this.inSecurityListMode) {
      logger.info(`[SEQUENCE] In security list mode, using security list sequence number: ${this.securityListOutgoingSeqNum}`);
      return this.securityListOutgoingSeqNum;
    }
    return this.outgoingSeqNum;
  }
  
  /**
   * Increment the outgoing sequence number and return the new value
   */
  public incrementOutgoingSeqNum(): number {
    if (this.inSecurityListMode) {
      this.securityListOutgoingSeqNum++;
      logger.debug(`[SEQUENCE] Incremented security list outgoing sequence number to: ${this.securityListOutgoingSeqNum}`);
      return this.securityListOutgoingSeqNum;
    }
    
    this.outgoingSeqNum++;
    logger.debug(`[SEQUENCE] Incremented regular outgoing sequence number to: ${this.outgoingSeqNum}`);
    return this.outgoingSeqNum;
  }
  
  /**
   * Update the incoming sequence number based on received message
   */
  public updateIncomingSeqNum(seqNum: number): void {
    if (this.inSecurityListMode) {
      // Update security list incoming sequence
      if (seqNum > this.securityListIncomingSeqNum) {
        const oldSeq = this.securityListIncomingSeqNum;
        this.securityListIncomingSeqNum = seqNum;
        logger.debug(`[SEQUENCE] Updated security list incoming sequence number: ${oldSeq} -> ${this.securityListIncomingSeqNum}`);
      } else if (seqNum < this.securityListIncomingSeqNum) {
        logger.warn(`[SEQUENCE] Received out-of-order security list sequence number: ${seqNum} (current: ${this.securityListIncomingSeqNum})`);
      }
    } else {
      // Update regular incoming sequence
      if (seqNum > this.incomingSeqNum) {
        const oldSeq = this.incomingSeqNum;
        this.incomingSeqNum = seqNum;
        logger.debug(`[SEQUENCE] Updated regular incoming sequence number: ${oldSeq} -> ${this.incomingSeqNum}`);
      } else if (seqNum < this.incomingSeqNum) {
        logger.warn(`[SEQUENCE] Received out-of-order regular sequence number: ${seqNum} (current: ${this.incomingSeqNum})`);
      }
    }
  }
  
  /**
   * Enter security list request mode, which uses separate sequence number tracking
   */
  public enterSecurityListMode(): void {
    logger.info(`[SEQUENCE] Entering security list mode with dedicated sequence numbers: outgoing=${this.securityListOutgoingSeqNum}, incoming=${this.securityListIncomingSeqNum}`);
    this.inSecurityListMode = true;
  }
  
  /**
   * Exit security list request mode, returning to normal sequence numbering
   */
  public exitSecurityListMode(): void {
    logger.info(`[SEQUENCE] Exiting security list mode, returning to regular sequence numbering (outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum})`);
    this.inSecurityListMode = false;
  }
  
  /**
   * Check if a received sequence number matches expectations based on current mode
   */
  public isValidIncomingSeqNum(seqNum: number): boolean {
    if (this.inSecurityListMode) {
      return seqNum >= this.securityListIncomingSeqNum;
    }
    return seqNum >= this.incomingSeqNum;
  }
  
  /**
   * Reset all sequence numbers (both regular and security list)
   */
  public reset(outgoingSeqNum: number = 1, incomingSeqNum: number = 0): void {
    const oldOutgoing = this.outgoingSeqNum;
    const oldIncoming = this.incomingSeqNum;
    const oldSlOutgoing = this.securityListOutgoingSeqNum;
    const oldSlIncoming = this.securityListIncomingSeqNum;
    
    this.outgoingSeqNum = outgoingSeqNum;
    this.incomingSeqNum = incomingSeqNum;
    this.securityListOutgoingSeqNum = 2; // Always reset to 2 for security list
    this.securityListIncomingSeqNum = 1;
    this.inSecurityListMode = false;
    
    logger.info(`[SEQUENCE] Reset regular sequence numbers: outgoing ${oldOutgoing}->${this.outgoingSeqNum}, incoming ${oldIncoming}->${this.incomingSeqNum}`);
    logger.info(`[SEQUENCE] Reset security list sequence numbers: outgoing ${oldSlOutgoing}->${this.securityListOutgoingSeqNum}, incoming ${oldSlIncoming}->${this.securityListIncomingSeqNum}`);
  }
  
  /**
   * Force set a specific outgoing sequence number for current mode
   */
  public setOutgoingSeqNum(seqNum: number): void {
    if (this.inSecurityListMode) {
      const oldSeq = this.securityListOutgoingSeqNum;
      this.securityListOutgoingSeqNum = seqNum;
      logger.info(`[SEQUENCE] Manually set security list outgoing sequence number: ${oldSeq} -> ${this.securityListOutgoingSeqNum}`);
    } else {
      const oldSeq = this.outgoingSeqNum;
      this.outgoingSeqNum = seqNum;
      logger.info(`[SEQUENCE] Manually set regular outgoing sequence number: ${oldSeq} -> ${this.outgoingSeqNum}`);
    }
  }
  
  /**
   * Force set security list sequence numbers specifically
   */
  public setSecurityListSequenceNumbers(outgoingSeqNum: number = 2, incomingSeqNum: number = 1): void {
    const oldOutgoing = this.securityListOutgoingSeqNum;
    const oldIncoming = this.securityListIncomingSeqNum;
    
    this.securityListOutgoingSeqNum = outgoingSeqNum;
    this.securityListIncomingSeqNum = incomingSeqNum;
    
    logger.info(`[SEQUENCE] Explicitly set security list sequence numbers: outgoing ${oldOutgoing}->${this.securityListOutgoingSeqNum}, incoming ${oldIncoming}->${this.securityListIncomingSeqNum}`);
  }
  
  /**
   * Get the current state of sequence numbers
   */
  public getState(): { 
    regular: { outgoing: number; incoming: number; }, 
    securityList: { outgoing: number; incoming: number; },
    inSecurityListMode: boolean 
  } {
    return {
      regular: {
        outgoing: this.outgoingSeqNum,
        incoming: this.incomingSeqNum
      },
      securityList: {
        outgoing: this.securityListOutgoingSeqNum,
        incoming: this.securityListIncomingSeqNum
      },
      inSecurityListMode: this.inSecurityListMode
    };
  }
}

export default SequenceManager; 