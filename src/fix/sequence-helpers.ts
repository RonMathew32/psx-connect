import logger from '../utils/logger';

/**
 * Helper functions for FIX sequence number management
 */

let mainSeqNum = 1;
let serverSeqNum = 1;
let marketDataSeqNum = 1;
let securityListSeqNum = 2; // Initialize security list with a different number

/**
 * Reset all sequence numbers to their initial values
 */
export function resetAllSequenceNumbers(): void {
  mainSeqNum = 1;
  serverSeqNum = 1;
  marketDataSeqNum = 1;
  securityListSeqNum = 2;
  logger.info('[SEQUENCE] All sequence numbers reset to initial values');
}

/**
 * Get all current sequence numbers
 */
export function getSequenceNumbers(): { main: number; server: number; marketData: number; securityList: number } {
  return {
    main: mainSeqNum,
    server: serverSeqNum,
    marketData: marketDataSeqNum,
    securityList: securityListSeqNum
  };
}

/**
 * Force reset of sequence numbers to a specific value
 */
export function forceResetSequenceNumbers(newSeq: number = 2): void {
  const oldSeq = mainSeqNum;
  mainSeqNum = newSeq;
  serverSeqNum = newSeq - 1;
  // Ensure security list always has a different sequence number than market data
  securityListSeqNum = newSeq + 1;
  marketDataSeqNum = newSeq;
  logger.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldSeq} to ${mainSeqNum} (server: ${serverSeqNum})`);
  logger.info(`[SEQUENCE] Security list sequence set to ${securityListSeqNum}, market data sequence set to ${marketDataSeqNum}`);
}

/**
 * Set up sequence numbers after logon
 */
export function setupSequenceNumbersAfterLogon(serverMsgSeqNum: number, resetFlag: boolean): void {
  serverSeqNum = serverMsgSeqNum;
  
  // If reset sequence number flag is Y, we should reset our sequence counter to 2
  // (1 for the server's logon acknowledgment, and our next message will be 2)
  if (resetFlag) {
    mainSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
    // IMPORTANT: Keep SecurityList and MarketData sequence numbers separate
    securityListSeqNum = 3; // SecurityList starts at 3 (different from MarketData)
    marketDataSeqNum = 2; // MarketData starts at 2
    logger.info(`[SEQUENCE] Reset flag is Y, setting sequence numbers: Main=${mainSeqNum}, SecurityList=${securityListSeqNum}, MarketData=${marketDataSeqNum}`);
  } else {
    // Otherwise, set our next sequence to be one more than the server's
    mainSeqNum = serverSeqNum + 1;
    // Ensure SecurityList and MarketData sequence numbers are distinct
    securityListSeqNum = mainSeqNum + 1;
    marketDataSeqNum = mainSeqNum;
    logger.info(`[SEQUENCE] Using server's sequence, setting numbers: Main=${mainSeqNum}, SecurityList=${securityListSeqNum}, MarketData=${marketDataSeqNum}`);
  }
}

/**
 * Update sequence numbers based on an incoming message's sequence number
 */
export function updateSequenceNumbersFromServer(incomingSeqNum: number): boolean {
  // For normal messages, track the server's sequence
  serverSeqNum = incomingSeqNum;
  logger.info(`Server sequence number updated to: ${serverSeqNum}`);

  // Our next message should be one more than what the server expects
  // The server expects our next message to have a sequence number of serverSeqNum + 1
  if (mainSeqNum <= serverSeqNum) {
    mainSeqNum = serverSeqNum + 1;
    logger.info(`Updated our next sequence number to: ${mainSeqNum}`);
    return true;
  }
  return false;
}

/**
 * Get main sequence number and increment it
 */
export function getNextMainSeqNum(): number {
  return mainSeqNum++;
}

/**
 * Get market data sequence number and increment it
 */
export function getNextMarketDataSeqNum(): number {
  return marketDataSeqNum++;
}

/**
 * Get security list sequence number and increment it
 */
export function getNextSecurityListSeqNum(): number {
  return securityListSeqNum++;
}

/**
 * Set the market data sequence number
 */
export function setMarketDataSeqNum(seqNum: number): void {
  marketDataSeqNum = seqNum;
  logger.info(`[SEQUENCE] Market data sequence number set to ${marketDataSeqNum}`);
}

/**
 * Set the security list sequence number
 */
export function setSecurityListSeqNum(seqNum: number): void {
  securityListSeqNum = seqNum;
  logger.info(`[SEQUENCE] Security list sequence number set to ${securityListSeqNum}`);
}

/**
 * Get main sequence number without incrementing
 */
export function getMainSeqNum(): number {
  return mainSeqNum;
}

/**
 * Get market data sequence number without incrementing
 */
export function getMarketDataSeqNum(): number {
  return marketDataSeqNum;
}

/**
 * Get security list sequence number without incrementing
 */
export function getSecurityListSeqNum(): number {
  return securityListSeqNum;
}

/**
 * Get server sequence number
 */
export function getServerSeqNum(): number {
  return serverSeqNum;
} 