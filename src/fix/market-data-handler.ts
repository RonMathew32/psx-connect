/**
 * PSX Market Data Request Handler
 * 
 * Specialized handler for PSX market data requests, using a dedicated
 * sequence number stream separate from regular messages and security lists.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { SOH, MessageType, FieldTag } from './constants';
import { createMessageBuilder } from './message-builder';
import SequenceManager, { SequenceStream } from './sequence-manager';
import { MarketDataItem } from '../types';

export interface MarketDataRequestConfig {
  senderCompId: string;
  targetCompId: string;
  onRequestSent?: (requestId: string, symbols: string[]) => void;
  onDataReceived?: (data: MarketDataItem[]) => void;
}

export class MarketDataHandler {
  private config: MarketDataRequestConfig;
  private sequenceManager: SequenceManager;
  private socketWrite: (data: string) => void;
  private requestsInProgress: Map<string, string[]> = new Map(); // requestId -> symbols
  
  constructor(
    config: MarketDataRequestConfig,
    sequenceManager: SequenceManager,
    socketWrite: (data: string) => void
  ) {
    this.config = config;
    this.sequenceManager = sequenceManager;
    this.socketWrite = socketWrite;
    
    // Make sure market data sequence numbers are correctly initialized
    this.sequenceManager.resetMarketDataSequence(1, 0);
  }
  
  /**
   * Send a market data request for the specified symbols
   * 
   * @param symbols List of symbols to request data for
   * @param entryTypes Array of entry types (0=Bid, 1=Offer, 2=Trade, 3=Index Value)
   * @param subscriptionType 0=Snapshot, 1=Updates
   */
  public requestMarketData(
    symbols: string[],
    entryTypes: string[] = ['0', '1'], 
    subscriptionType: string = '1'
  ): string | null {
    if (!symbols || symbols.length === 0) {
      logger.error('[MARKET_DATA] Cannot send market data request: no symbols provided');
      return null;
    }
    
    logger.info(`[MARKET_DATA] Preparing to send market data request for ${symbols.length} symbols`);
    
    // Switch to market data sequence stream
    this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
    
    const requestId = uuidv4();
    logger.info(`[MARKET_DATA] Sending market data request with ID: ${requestId} for symbols: ${symbols.join(', ')}`);
    
    try {
      // Create the market data request message
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(this.config.senderCompId)
        .setTargetCompID(this.config.targetCompId)
        .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum());
      
      // Add required fields
      message.addField(FieldTag.MD_REQ_ID, requestId);
      message.addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType);
      message.addField(FieldTag.MARKET_DEPTH, '0');
      message.addField(FieldTag.MD_UPDATE_TYPE, '0');
      
      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }
      
      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }
      
      // Build and send the message
      const rawMessage = message.buildMessage();
      logger.debug(`[MARKET_DATA] Raw market data request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      
      // Track this request
      this.requestsInProgress.set(requestId, symbols);
      
      // Send the message
      this.socketWrite(rawMessage);
      
      // Increment the market data sequence number
      this.sequenceManager.incrementOutgoingSeqNum();
      
      // Call the callback if provided
      if (this.config.onRequestSent) {
        this.config.onRequestSent(requestId, symbols);
      }
      
      // Switch back to regular stream
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
      
      return requestId;
    } catch (error) {
      logger.error(`[MARKET_DATA] Error sending market data request: ${error instanceof Error ? error.message : String(error)}`);
      // Switch back to regular stream on error
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
      return null;
    }
  }
  
  /**
   * Send an index value request
   * 
   * @param symbols List of index symbols to request data for
   */
  public requestIndexValues(symbols: string[]): string | null {
    if (!symbols || symbols.length === 0) {
      logger.error('[MARKET_DATA] Cannot send index value request: no symbols provided');
      return null;
    }
    
    logger.info(`[MARKET_DATA] Preparing to send index value request for ${symbols.length} indices`);
    
    // Use market data sequence stream
    this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
    
    return this.requestMarketData(symbols, ['3'], '0'); // 3 = Index Value, 0 = Snapshot
  }
  
  /**
   * Handle a market data snapshot message
   */
  public handleMarketDataSnapshot(message: Record<string, string>): void {
    try {
      // Make sure we're in market data stream for processing
      this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
      
      // Extract the request ID and update sequence number
      const requestId = message[FieldTag.MD_REQ_ID];
      const seqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '0', 10);
      
      if (seqNum > 0) {
        this.sequenceManager.updateIncomingSeqNum(seqNum);
        logger.debug(`[MARKET_DATA] Updated market data incoming sequence to ${seqNum}`);
      }
      
      // Parse market data
      const marketData = this.parseMarketData(message);
      
      if (marketData.length > 0) {
        logger.info(`[MARKET_DATA] Received market data snapshot with ${marketData.length} entries for symbol: ${marketData[0].symbol}`);
        
        // Call the callback if provided
        if (this.config.onDataReceived) {
          this.config.onDataReceived(marketData);
        }
      }
      
      // Remove from in-progress if it's a snapshot (not a subscription)
      if (requestId && message[FieldTag.SUBSCRIPTION_REQUEST_TYPE] === '0') {
        this.requestsInProgress.delete(requestId);
        logger.debug(`[MARKET_DATA] Completed snapshot request ${requestId}`);
      }
      
      // Switch back to regular stream
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    } catch (error) {
      logger.error(`[MARKET_DATA] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
      // Switch back to regular stream on error
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    }
  }
  
  /**
   * Handle a market data incremental update message
   */
  public handleMarketDataIncremental(message: Record<string, string>): void {
    try {
      // Switch to market data stream for processing
      this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
      
      // Update sequence number
      const seqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '0', 10);
      if (seqNum > 0) {
        this.sequenceManager.updateIncomingSeqNum(seqNum);
        logger.debug(`[MARKET_DATA] Updated market data incoming sequence to ${seqNum}`);
      }
      
      // Parse market data updates
      const marketData = this.parseMarketData(message);
      
      if (marketData.length > 0) {
        logger.info(`[MARKET_DATA] Received incremental update with ${marketData.length} entries for symbol: ${marketData[0].symbol}`);
        
        // Call the callback if provided
        if (this.config.onDataReceived) {
          this.config.onDataReceived(marketData);
        }
      }
      
      // Switch back to regular stream
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    } catch (error) {
      logger.error(`[MARKET_DATA] Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
      // Switch back to regular stream on error
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    }
  }
  
  /**
   * Handle a market data request reject message
   */
  public handleMarketDataReject(message: Record<string, string>): void {
    try {
      // Switch to market data stream for processing
      this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
      
      const requestId = message[FieldTag.MD_REQ_ID];
      const rejectReason = message[FieldTag.MD_REJECT_REASON];
      const text = message[FieldTag.TEXT];
      
      // Update sequence number
      const seqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '0', 10);
      if (seqNum > 0) {
        this.sequenceManager.updateIncomingSeqNum(seqNum);
        logger.debug(`[MARKET_DATA] Updated market data incoming sequence to ${seqNum}`);
      }
      
      if (requestId) {
        const symbols = this.requestsInProgress.get(requestId) || [];
        logger.error(`[MARKET_DATA] Request rejected for symbols ${symbols.join(', ')}: ${text || 'Unknown error'} (reason code: ${rejectReason || 'unknown'})`);
        
        // Clean up the rejected request
        this.requestsInProgress.delete(requestId);
      } else {
        logger.error(`[MARKET_DATA] Unknown market data request rejected: ${text || 'No reason provided'}`);
      }
      
      // Check for sequence number problems and reset if needed
      if (text && text.includes('MsgSeqNum')) {
        logger.warn(`[MARKET_DATA] Sequence number error detected, resetting market data sequence numbers`);
        this.sequenceManager.resetMarketDataSequence(1, 0);
      }
      
      // Switch back to regular stream
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    } catch (error) {
      logger.error(`[MARKET_DATA] Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
      // Switch back to regular stream on error
      this.sequenceManager.switchToStream(SequenceStream.REGULAR);
    }
  }
  
  /**
   * Parse market data entries from a message
   */
  private parseMarketData(message: Record<string, string>): MarketDataItem[] {
    const items: MarketDataItem[] = [];
    
    try {
      // Check message type
      const msgType = message[FieldTag.MSG_TYPE];
      if (msgType !== MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH && 
          msgType !== MessageType.MARKET_DATA_INCREMENTAL_REFRESH) {
        return items;
      }
      
      // Get the symbol
      const symbol = message[FieldTag.SYMBOL];
      if (!symbol) {
        logger.warn('[MARKET_DATA] Market data message missing symbol');
        return items;
      }
      
      // For snapshots, parse the entries
      const numEntries = parseInt(message[FieldTag.NO_MD_ENTRIES] || '0', 10);
      if (numEntries === 0) {
        logger.warn(`[MARKET_DATA] Market data for ${symbol} contains 0 entries`);
        return items;
      }
      
      // Extract timestamp if available
      const timestamp = message[FieldTag.SENDING_TIME] || new Date().toISOString();
      
      // Parse each entry
      for (let i = 0; i < numEntries; i++) {
        const entryType = message[`${FieldTag.MD_ENTRY_TYPE}.${i}`];
        const price = parseFloat(message[`${FieldTag.MD_ENTRY_PX}.${i}`] || '0');
        const size = parseFloat(message[`${FieldTag.MD_ENTRY_SIZE}.${i}`] || '0');
        
        if (entryType) {
          items.push({
            symbol,
            entryType,
            price: isNaN(price) ? undefined : price,
            size: isNaN(size) ? undefined : size,
            timestamp
          });
        }
      }
    } catch (error) {
      logger.error(`[MARKET_DATA] Error parsing market data: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return items;
  }
  
  /**
   * Cancel all active market data requests
   */
  public cancelAllRequests(): void {
    if (this.requestsInProgress.size === 0) {
      return;
    }
    
    logger.info(`[MARKET_DATA] Cancelling ${this.requestsInProgress.size} active market data requests`);
    
    // Use market data sequence stream for cancellations
    this.sequenceManager.switchToStream(SequenceStream.MARKET_DATA);
    
    for (const [requestId, symbols] of this.requestsInProgress.entries()) {
      try {
        // Create cancellation message
        const message = createMessageBuilder()
          .setMsgType(MessageType.MARKET_DATA_REQUEST)
          .setSenderCompID(this.config.senderCompId)
          .setTargetCompID(this.config.targetCompId)
          .setMsgSeqNum(this.sequenceManager.getNextOutgoingSeqNum())
          .addField(FieldTag.MD_REQ_ID, requestId)
          .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '2'); // 2 = Disable previous subscription
        
        // Send the message
        const rawMessage = message.buildMessage();
        this.socketWrite(rawMessage);
        
        // Increment sequence
        this.sequenceManager.incrementOutgoingSeqNum();
        
        logger.info(`[MARKET_DATA] Cancelled subscription for request ${requestId} (symbols: ${symbols.join(', ')})`);
      } catch (error) {
        logger.error(`[MARKET_DATA] Error cancelling market data request: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Clear all requests
    this.requestsInProgress.clear();
    
    // Switch back to regular stream
    this.sequenceManager.switchToStream(SequenceStream.REGULAR);
  }
  
  /**
   * Reset market data sequence numbers
   */
  public resetSequenceNumbers(): void {
    logger.info('[MARKET_DATA] Resetting market data sequence numbers to 1/0');
    this.sequenceManager.resetMarketDataSequence(1, 0);
  }
  
  /**
   * Check if there are any active market data requests
   */
  public hasActiveRequests(): boolean {
    return this.requestsInProgress.size > 0;
  }
  
  /**
   * Get current active request information
   */
  public getActiveRequests(): Map<string, string[]> {
    return new Map(this.requestsInProgress);
  }
}

export default MarketDataHandler; 