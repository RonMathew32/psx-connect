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
  // Sequence counters
  private outgoingSeqNum: number;
  private incomingSeqNum: number;
  private securityListSeqNum: number;
  
  // Track if we're in a special state
  private inSecurityListMode: boolean = false;
  
  constructor(options?: SequenceManagerOptions) {
    this.outgoingSeqNum = options?.initialOutgoingSeqNum ?? 1;
    this.incomingSeqNum = options?.initialIncomingSeqNum ?? 0;
    this.securityListSeqNum = options?.securityListSeqNum ?? 2;
    
    logger.info(`[SEQUENCE] Initialized with outgoing=${this.outgoingSeqNum}, incoming=${this.incomingSeqNum}, securityList=${this.securityListSeqNum}`);
  }
  
  /**
   * Get the next outgoing sequence number
   */
  public getNextOutgoingSeqNum(): number {
    if (this.inSecurityListMode) {
      logger.info(`[SEQUENCE] In security list mode, using fixed sequence number: ${this.securityListSeqNum}`);
      return this.securityListSeqNum;
    }
    return this.outgoingSeqNum;
  }
  
  /**
   * Increment the outgoing sequence number and return the new value
   */
  public incrementOutgoingSeqNum(): number {
    if (this.inSecurityListMode) {
      logger.info(`[SEQUENCE] In security list mode, not incrementing sequence number`);
      return this.securityListSeqNum;
    }
    
    this.outgoingSeqNum++;
    logger.debug(`[SEQUENCE] Incremented outgoing sequence number to: ${this.outgoingSeqNum}`);
    return this.outgoingSeqNum;
  }
  
  /**
   * Update the incoming sequence number based on received message
   */
  public updateIncomingSeqNum(seqNum: number): void {
    // Only update if the new sequence number is higher
    if (seqNum > this.incomingSeqNum) {
      const oldSeq = this.incomingSeqNum;
      this.incomingSeqNum = seqNum;
      logger.debug(`[SEQUENCE] Updated incoming sequence number: ${oldSeq} -> ${this.incomingSeqNum}`);
    } else if (seqNum < this.incomingSeqNum) {
      // Lower sequence number could indicate a sequence reset or duplicate
      logger.warn(`[SEQUENCE] Received out-of-order sequence number: ${seqNum} (current: ${this.incomingSeqNum})`);
    }
  }
  
  /**
   * Enter security list request mode, which uses a fixed sequence number
   */
  public enterSecurityListMode(): void {
    // Remember current sequence number for later restoration
    logger.info(`[SEQUENCE] Entering security list mode, using fixed sequence ${this.securityListSeqNum}`);
    this.inSecurityListMode = true;
  }
  
  /**
   * Exit security list request mode, returning to normal sequence numbering
   */
  public exitSecurityListMode(): void {
    logger.info(`[SEQUENCE] Exiting security list mode, returning to normal sequence numbering (${this.outgoingSeqNum})`);
    this.inSecurityListMode = false;
  }
  
  /**
   * Check if a received sequence number matches expectations
   */
  public isValidIncomingSeqNum(seqNum: number): boolean {
    // For most general cases, we expect the next sequence number or higher
    return seqNum >= this.incomingSeqNum;
  }
  
  /**
   * Force reset both incoming and outgoing sequence numbers
   */
  public reset(outgoingSeqNum: number = 1, incomingSeqNum: number = 0): void {
    const oldOutgoing = this.outgoingSeqNum;
    const oldIncoming = this.incomingSeqNum;
    
    this.outgoingSeqNum = outgoingSeqNum;
    this.incomingSeqNum = incomingSeqNum;
    this.inSecurityListMode = false;
    
    logger.info(`[SEQUENCE] Reset sequence numbers: outgoing ${oldOutgoing}->${this.outgoingSeqNum}, incoming ${oldIncoming}->${this.incomingSeqNum}`);
  }
  
  /**
   * Force set a specific outgoing sequence number
   */
  public setOutgoingSeqNum(seqNum: number): void {
    const oldSeq = this.outgoingSeqNum;
    this.outgoingSeqNum = seqNum;
    logger.info(`[SEQUENCE] Manually set outgoing sequence number: ${oldSeq} -> ${this.outgoingSeqNum}`);
  }
  
  /**
   * Get the current state of sequence numbers
   */
  public getState(): { outgoing: number; incoming: number; inSecurityListMode: boolean } {
    return {
      outgoing: this.outgoingSeqNum,
      incoming: this.incomingSeqNum,
      inSecurityListMode: this.inSecurityListMode
    };
  }
}

export default SequenceManager; 