import net from 'net';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';
import { SequenceManager } from './sequence-manager';

/** 
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions) {
  const emitter = new EventEmitter();
  let socket: net.Socket | null = null;
  let connected = false;
  let loggedIn = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastActivityTime = 0;
  let testRequestCount = 0;
  let msgSeqNum = 1;
  let serverSeqNum = 1; // Add tracking of server sequence number
  let logonTimer: NodeJS.Timeout | null = null;
  let sequenceManager: SequenceManager;
  let marketDataSeqNum = 1; // Separate sequence number for market data

  /**
   * Reset sequence numbers to a specific value
   * Used when the server expects a specific sequence number
   */
  const forceResetSequenceNumber = (newSeq: number = 2): void => {
    const oldSeq = msgSeqNum;
    msgSeqNum = newSeq;
    serverSeqNum = newSeq - 1;
    logger.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldSeq} to ${msgSeqNum} (server: ${serverSeqNum})`);
  };

  /**
   * Start the FIX client and connect to the server
   */
  const start = (): void => {
    connect();
  };

  /**
   * Stop the FIX client and disconnect from the server
   */
  const stop = (): void => {
    sendLogout(); // Ensure this is correctly called
    disconnect();
  };

  /**
   * Connect to the FIX server
   */
  const connect = async (): Promise<void> => {

    if (socket && connected) {
      logger.warn('Already connected');
      return;
    }

    try {
      // Create socket with specific configuration - matching fn-psx
      socket = new Socket();

      // Apply socket settings exactly like fn-psx
      socket.setKeepAlive(true);
      socket.setNoDelay(true);

      // Set connection timeout 
      socket.setTimeout(options.connectTimeoutMs || 30000);

      // Setup event handlers
      socket.on('timeout', () => {
        logger.error('Connection timed out');
        socket?.destroy();
        connected = false;
        emitter.emit('error', new Error('Connection timed out'));
      });

      socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        emitter.emit('error', error);
      });

      socket.on('close', () => {
        logger.info('Socket disconnected');
        connected = false;
        emitter.emit('disconnected');
        scheduleReconnect();
      });

      socket.on('connect', () => {
        logger.info(`Connected to ${options.host}:${options.port}`);
        connected = true;

        // Clear any existing timeout to prevent duplicate logon attempts
        if (logonTimer) {
          clearTimeout(logonTimer);
        }

        // Send logon message after a short delay - exactly like fn-psx
        logonTimer = setTimeout(() => {
          try {
            logger.info('Sending logon message...');
            sendLogon();
          } catch (error) {
            logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
            disconnect();
          }
        }, 500);

        emitter.emit('connected');
      });

      // Handle received data
      socket.on('data', (data) => {
        logger.info("--------------------------------");
        handleData(data);
      });

      // Connect to the server
      logger.info(`Establishing TCP connection to ${options.host}:${options.port}...`);
      socket.connect(options.port, options.host);
    } catch (error) {
      logger.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  /**
   * Disconnect from the FIX server
   */
  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      clearTimers();
      if (connected && loggedIn) {
        sendLogout();
      }
      if (socket) {
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;
      resolve();
    });
  };

  /**
   * Schedule a reconnection attempt
   */
  const scheduleReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    logger.info('Scheduling reconnect in 5 seconds');
    reconnectTimer = setTimeout(() => {
      logger.info('Attempting to reconnect');
      connect();
    }, 5000);
  };

  /**
   * Clear all timers
   */
  const clearTimers = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  /**
   * Handle incoming data from the socket
   */
  const handleData = (data: Buffer): void => {
    try {
      lastActivityTime = Date.now();
      const dataStr = data.toString();

      logger.debug(`Received data: ${dataStr.length} bytes`);
      const messages = dataStr.split(SOH);
      let currentMessage = '';

      for (const segment of messages) {
        if (segment.startsWith('8=FIX')) {
          // If we have a previous message, process it
          if (currentMessage) {
            processMessage(currentMessage);
          }
          // Start a new message
          currentMessage = segment;
        } else if (currentMessage) {
          // Add to current message
          currentMessage += SOH + segment;
        }
      }
      // Process the last message if exists
      if (currentMessage) {
        // logger.info(`Processing message: ${currentMessage}`);
        processMessage(currentMessage);
      }
    } catch (error) {
      logger.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Process a FIX message
   */
  const processMessage = (message: string): void => {
    try {
      const segments = message.split(SOH);

      // FIX message should start with "8=FIX"
      const fixVersion = segments.find(s => s.startsWith('8=FIX'));
      if (!fixVersion) {
        logger.warn('Received non-FIX message');
        return;
      }

      // Log the raw message in FIX format (replacing SOH with pipe for readability)
      logger.info(`Received FIX message: ${message}`);
      logger.info(`------------------------------------------------------------------------------------------------------------`);
      
      // // Parse the raw message
      // const parsedMessage = parseFixMessage(message);

      // if (!parsedMessage) {
      //   logger.warn('Could not parse FIX message');
      //   return;
      // }

      // // Track server's sequence number if available
      // if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
      //   const incomingSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);

      //   // Special handling for logout and reject messages with sequence errors
      //   const msgType = parsedMessage[FieldTag.MSG_TYPE];
      //   const text = parsedMessage[FieldTag.TEXT] || '';

      //   // Check if this is a sequence error message
      //   const isSequenceError = text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence');

      //   if ((msgType === MessageType.LOGOUT || msgType === MessageType.REJECT) && isSequenceError) {
      //     // For sequence errors, don't update our sequence counter
      //     // This will be handled in the handleLogout or handleReject methods
      //     logger.warn(`Received ${msgType} with sequence error: ${text}`);
      //   } else {
      //     // For normal messages, track the server's sequence
      //     serverSeqNum = incomingSeqNum;
      //     logger.info(`Server sequence number updated to: ${serverSeqNum}`);

      //     // Only update our outgoing sequence if this isn't a duplicate message
      //     // or a resend of an old message (possDup flag not set)
      //     if (!parsedMessage[FieldTag.POSS_DUP_FLAG] || parsedMessage[FieldTag.POSS_DUP_FLAG] !== 'Y') {
      //       // Our next message should be one more than what the server expects
      //       // The server expects our next message to have a sequence number of serverSeqNum + 1
      //       if (msgSeqNum <= serverSeqNum) {
      //         msgSeqNum = serverSeqNum + 1;
      //         logger.info(`Updated our next sequence number to: ${msgSeqNum}`);
      //       }
      //     }
      //   }
      // }

      // // Log message type for debugging
      // const messageType = parsedMessage[FieldTag.MSG_TYPE];
      // const messageTypeName = getMessageTypeName(messageType);
      // logger.info(`Message type: ${messageType} (${messageTypeName})`);

      // // Process specific message types
      // switch (messageType) {
      //   case MessageType.LOGON:
      //     logger.info(`[LOGON] Processing logon message from server`);
      //     handleLogon(parsedMessage);
      //     break;
      //   case MessageType.LOGOUT:
      //     logger.info(`[LOGOUT] Handling logout message`);
      //     handleLogout(parsedMessage);
      //     break;
      //   case MessageType.HEARTBEAT:
      //     logger.debug(`[HEARTBEAT] Received heartbeat`);
      //     // Just log and reset the test request counter
      //     testRequestCount = 0;
      //     break;
      //   case MessageType.TEST_REQUEST:
      //     logger.info(`[TEST_REQUEST] Responding to test request`);
      //     // Respond with heartbeat
      //     sendHeartbeat(parsedMessage[FieldTag.TEST_REQ_ID]);
      //     break;
      //   case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
      //     logger.info(`[MARKET_DATA] Handling market data snapshot for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
      //     // Use marketSequenceNumber for market data 
      //     if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
      //       marketDataSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
      //     }
      //     handleMarketDataSnapshot(parsedMessage);
      //     break;
      //   case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
      //     logger.info(`[MARKET_DATA] Handling market data incremental refresh for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
      //     // Use marketSequenceNumber for market data
      //     if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
      //       marketDataSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
      //     }
      //     handleMarketDataIncremental(parsedMessage);
      //     break;
      //   case MessageType.SECURITY_LIST:
      //     logger.info(`[SECURITY_LIST] Handling security list response`);
      //     // Use securityListSequenceNumber for security list
      //     handleSecurityList(parsedMessage);
      //     break;
      //   case MessageType.TRADING_SESSION_STATUS:
      //     logger.info(`[TRADING_STATUS] Handling trading session status update`);
      //     handleTradingSessionStatus(parsedMessage);
      //     break;
      //   case 'f': // Trading Status - specific PSX format
      //     logger.info(`[TRADING_STATUS] Handling trading status for symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
      //     handleTradingStatus(parsedMessage);
      //     break;
      //   case MessageType.REJECT:
      //     logger.error(`[REJECT] Handling reject message`);
      //     handleReject(parsedMessage);
      //     break;
      //   case 'Y': // Market Data Request Reject
      //     logger.error(`[MARKET_DATA_REJECT] Handling market data request reject`);
      //     handleMarketDataRequestReject(parsedMessage);
      //     break;
      //   default:
      //     logger.info(`[UNKNOWN] Received unhandled message type: ${messageType} (${messageTypeName})`);
      //     if (parsedMessage[FieldTag.SYMBOL]) {
      //       logger.info(`[UNKNOWN] Symbol: ${parsedMessage[FieldTag.SYMBOL]}`);
      //     }
      // }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Get human-readable name for a message type
   */
  const getMessageTypeName = (msgType: string): string => {
    // Find the message type name by its value
    for (const [name, value] of Object.entries(MessageType)) {
      if (value === msgType) {
        return name;
      }
    }
    return 'UNKNOWN';
  };

  /**
   * Handle a market data snapshot message
   */
  const handleMarketDataSnapshot = (message: ParsedFixMessage): void => {
    try {
      // Extract the request ID to identify which request this is responding to
      const mdReqId = message[FieldTag.MD_REQ_ID];
      const symbol = message[FieldTag.SYMBOL];

      logger.info(`[MARKET_DATA] Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);

      // Process market data entries
      const marketDataItems: MarketDataItem[] = [];

      // Check if we have entries
      const noEntries = parseInt(message[FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);

      if (noEntries > 0) {
        // Extract entries - in a real implementation, this would be more robust
        // and handle multiple entries properly by parsing groups
        for (let i = 0; i < 100; i++) {  // Safe upper limit
          const entryType = message[`${FieldTag.MD_ENTRY_TYPE}.${i}`] || message[FieldTag.MD_ENTRY_TYPE];
          const price = message[`${FieldTag.MD_ENTRY_PX}.${i}`] || message[FieldTag.MD_ENTRY_PX];
          const size = message[`${FieldTag.MD_ENTRY_SIZE}.${i}`] || message[FieldTag.MD_ENTRY_SIZE];

          if (!entryType) break;  // No more entries

          marketDataItems.push({
            symbol: symbol || '',
            entryType,
            price: price ? parseFloat(price) : undefined,
            size: size ? parseFloat(size) : undefined,
            timestamp: message[FieldTag.SENDING_TIME]
          });
        }
      }
      
      // Once we've properly parsed the data, emit it
      if (marketDataItems.length > 0) {
        logger.info(`[MARKET_DATA] Extracted ${marketDataItems.length} market data items for ${symbol}`);
        // Use marketDataSeqNum for tracking
        logger.info(`[MARKET_DATA] Emitting market data with sequence number: ${marketDataSeqNum}`);
        emitter.emit('marketData', marketDataItems);
        
        // Check if this is KSE data
        const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');

        if (isKseData) {
          logger.info(`[MARKET_DATA] Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
          emitter.emit('kseData', marketDataItems);
        }
      } else {
        // Even if no items were found, emit the raw message for debugging
        logger.info(`[MARKET_DATA] No market data items extracted, emitting raw message`);
        emitter.emit('marketData', message);
      }
    } catch (error) {
      logger.error(`[MARKET_DATA] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a market data incremental refresh message
   */
  const handleMarketDataIncremental = (message: ParsedFixMessage): void => {
    // Similar implementation to handleMarketDataSnapshot, but for incremental updates
    try {
      const mdReqId = message[FieldTag.MD_REQ_ID];
      logger.info(`Received market data incremental refresh for request: ${mdReqId}`);

      // Process incremental updates - simplified version
      const marketDataItems: MarketDataItem[] = [];

      // Parse the incremental updates and emit an event
      // Real implementation would be more robust

      if (marketDataItems.length > 0) {
        emitter.emit('marketData', marketDataItems);
      }
    } catch (error) {
      logger.error(`Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a security list message
   */
  const handleSecurityList = (message: ParsedFixMessage): void => {
    logger.info('[SECURITY_LIST] ===================== SECURITY LIST RESPONSE RECEIVED =====================');
    
    try {
      // Extract key information
      const reqId = message[FieldTag.SECURITY_REQ_ID] || 'unknown';
      const securityReqType = message[FieldTag.SECURITY_LIST_REQUEST_TYPE];
      const securityType = message[FieldTag.SECURITY_TYPE];
      const productType = message['460']; // Product type field
      const securityCount = parseInt(message[FieldTag.NO_RELATED_SYM] || '0', 10);
      const messageSeqNum = message[FieldTag.MSG_SEQ_NUM] || 'unknown';
      
      // Simple logging of raw message for debugging
      if (message.raw) {
        logger.info(`[SECURITY_LIST] RAW MESSAGE: ${message.raw.replace(new RegExp(SOH, 'g'), '|')}`);
      }
      
      // Log basic information
      logger.info(`[SECURITY_LIST] Message Sequence Number: ${messageSeqNum}`);
      logger.info(`[SECURITY_LIST] Request ID: ${reqId}`);
      logger.info(`[SECURITY_LIST] Product Type: ${productType || 'not specified'}`);
      logger.info(`[SECURITY_LIST] Security Type: ${securityType || 'not specified'}`);
      logger.info(`[SECURITY_LIST] Number of Securities: ${securityCount}`);
      
      // Create security list
      const securities: SecurityInfo[] = [];
      
      // Extract securities using simplified approach
      for (let i = 0; i < 1000; i++) {
        const symbolKey = i === 0 ? FieldTag.SYMBOL : `${FieldTag.SYMBOL}.${i}`;
        const symbol = message[symbolKey];
        
        if (!symbol) {
          if (i > 0) break;
          continue;
        }
        
        const secTypeKey = i === 0 ? FieldTag.SECURITY_TYPE : `${FieldTag.SECURITY_TYPE}.${i}`;
        const secDescKey = i === 0 ? FieldTag.SECURITY_DESC : `${FieldTag.SECURITY_DESC}.${i}`;
        const marketIdKey = i === 0 ? FieldTag.MARKET_ID : `${FieldTag.MARKET_ID}.${i}`;
        
        const securityInfo: SecurityInfo = {
          symbol,
          securityType: message[secTypeKey] || '',
          securityDesc: message[secDescKey] || '',
          marketId: message[marketIdKey] || ''
        };
        
        securities.push(securityInfo);
        logger.info(`[SECURITY_LIST] Found security: ${symbol}`);
      }
      
      // Look for fields with numeric suffix
      for (const key in message) {
        if (key.startsWith('55.') || key.startsWith('55_')) {
          const symbol = message[key];
          if (!symbol || typeof symbol !== 'string') continue;
          
          const parts = key.split(/[._]/);
          const index = parts[1];
          
          if (!index) continue;
          
          const secTypeKey = `167.${index}` || `167_${index}`;
          const secDescKey = `107.${index}` || `107_${index}`;
          const marketIdKey = `1301.${index}` || `1301_${index}`;
          
          const securityInfo: SecurityInfo = {
            symbol,
            securityType: message[secTypeKey] || '',
            securityDesc: message[secDescKey] || '',
            marketId: message[marketIdKey] || ''
          };
          
          securities.push(securityInfo);
          logger.info(`[SECURITY_LIST] Found security with index ${index}: ${symbol}`);
        }
      }
      
      // Remove duplicates
      const uniqueSecurities = Array.from(
        new Map(securities.map(s => [s.symbol, s])).values()
      );
      
      logger.info(`[SECURITY_LIST] Total unique securities found: ${uniqueSecurities.length}`);
      
      // Determine list type
      const isEquityList = productType === '4';
      const isIndexList = productType === '5';
      
      if (uniqueSecurities.length > 0) {
        // Log sample data
        logger.info(`[SECURITY_LIST] Sample securities:`);
        const sampleSize = Math.min(3, uniqueSecurities.length);
        for (let i = 0; i < sampleSize; i++) {
          logger.info(`[SECURITY_LIST] ${i+1}. ${JSON.stringify(uniqueSecurities[i])}`);
        }
        
        // Emit appropriate events
        if (isEquityList) {
          logger.info(`[SECURITY_LIST] Emitting EQUITY security list with ${uniqueSecurities.length} items`);
          emitter.emit('equitySecurityList', uniqueSecurities);
        } else if (isIndexList) {
          logger.info(`[SECURITY_LIST] Emitting INDEX security list with ${uniqueSecurities.length} items`);
          emitter.emit('indexSecurityList', uniqueSecurities);
        }
        
        // Always emit generic event
        logger.info(`[SECURITY_LIST] Emitting generic security list event`);
        emitter.emit('securityList', uniqueSecurities);
      } else {
        logger.warn(`[SECURITY_LIST] No securities found in the response`);
        emitter.emit('securityList', []);
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error processing security list: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('securityList', []);
    }
    
    logger.info('[SECURITY_LIST] ===================== END SECURITY LIST RESPONSE =====================');
  };

  /**
   * Handle a trading session status message
   */
  const handleTradingSessionStatus = (message: ParsedFixMessage): void => {
    try {
      // Log the entire message for debugging
      logger.info(`[TRADING_STATUS] Raw message content: ${JSON.stringify(message)}`);

      // Extract standard fields
      const reqId = message[FieldTag.TRAD_SES_REQ_ID];
      const sessionId = message[FieldTag.TRADING_SESSION_ID];
      const status = message[FieldTag.TRAD_SES_STATUS];
      const startTime = message[FieldTag.START_TIME];
      const endTime = message[FieldTag.END_TIME];

      // Detailed logging to troubleshoot missing data
      logger.info(`[TRADING_STATUS] Received trading session status for request: ${reqId || 'unknown'}`);
      logger.info(`[TRADING_STATUS] Session ID (Tag 336): ${sessionId || 'undefined'}`);
      logger.info(`[TRADING_STATUS] Status (Tag 340): ${status || 'undefined'}`);
      logger.info(`[TRADING_STATUS] Start Time (Tag 341): ${startTime || 'undefined'}`);
      logger.info(`[TRADING_STATUS] End Time (Tag 342): ${endTime || 'undefined'}`);

      // Add more comprehensive search for fields in different possible locations

      // Alternative field names for PSX-specific formats
      // Some exchanges use non-standard field tags or field locations
      let resolvedSessionId = sessionId;
      let resolvedStatus = status;
      let resolvedStartTime = startTime;
      let resolvedEndTime = endTime;

      // Check all possible tags that might contain session information
      logger.info(`[TRADING_STATUS] Searching for alternative session status fields...`);

      // Systematically check all fields for relevant information
      for (const [tag, value] of Object.entries(message)) {
        logger.info(`[TRADING_STATUS] Checking tag ${tag}: ${value}`);

        // Look for session ID in alternative tags
        if (!resolvedSessionId &&
          (tag === '1151' || tag === '1300' || tag === '1301' || tag === '625' ||
            tag === '336' || tag === '335' || tag === '207')) {
          logger.info(`[TRADING_STATUS] Found potential session ID in tag ${tag}: ${value}`);
          resolvedSessionId = value;
        }

        // Look for status in alternative tags
        if (!resolvedStatus &&
          (tag === '325' || tag === '326' || tag === '327' || tag === '328' ||
            tag === '329' || tag === '332' || tag === '339' || tag === '340' ||
            tag === '5840' || tag === '5841' || tag === '865' || tag === '102')) {
          logger.info(`[TRADING_STATUS] Found potential status in tag ${tag}: ${value}`);
          resolvedStatus = value;
        }

        // Look for times in alternative tags
        if (!resolvedStartTime &&
          (tag === '341' || tag === '343' || tag === '345' || tag === '345' ||
            tag === '5894' || tag === '5895' || tag === '5898')) {
          logger.info(`[TRADING_STATUS] Found potential start time in tag ${tag}: ${value}`);
          resolvedStartTime = value;
        }

        if (!resolvedEndTime &&
          (tag === '342' || tag === '344' || tag === '346' || tag === '347' ||
            tag === '5899' || tag === '5900' || tag === '5901')) {
          logger.info(`[TRADING_STATUS] Found potential end time in tag ${tag}: ${value}`);
          resolvedEndTime = value;
        }
      }

      // If Session ID is still missing, try more aggressive approaches
      if (!resolvedSessionId) {
        // Check if we have a MarketID field
        const marketId = message[FieldTag.MARKET_ID];
        if (marketId) {
          logger.info(`[TRADING_STATUS] Using market ID as session ID: ${marketId}`);
          resolvedSessionId = marketId;
        } else {
          // Look for any tag with "session" in its name (for debugging)
          const sessionTags = Object.entries(message)
            .filter(([k, v]) => k.toLowerCase().includes('session') || v.toString().toLowerCase().includes('session'));

          if (sessionTags.length > 0) {
            logger.info(`[TRADING_STATUS] Found ${sessionTags.length} tags related to session: ${JSON.stringify(sessionTags)}`);
            // Use the first one as a last resort
            if (!resolvedSessionId && sessionTags[0]) {
              resolvedSessionId = sessionTags[0][1];
              logger.info(`[TRADING_STATUS] Using ${sessionTags[0][0]} as session ID: ${resolvedSessionId}`);
            }
          } else {
            // Last resort - if session ID is '05', we need to extract status properly
            if (sessionId === '05') {
              logger.info(`[TRADING_STATUS] Session ID is '05', which might be a special PSX format`);
              // For PSX, session ID '05' might indicate a specific market state
              resolvedSessionId = 'REG'; // Default to Regular market

              // In this case, the session ID itself might indicate status
              if (!resolvedStatus) {
                // "05" might represent a specific session status code in PSX
                // Map it to a standard FIX session status code
                logger.info(`[TRADING_STATUS] Mapping session ID ${sessionId} to status code`);

                // Use a map to avoid type comparison issues
                const sessionStatusMap: Record<string, string> = {
                  '01': '1', // Halted
                  '02': '2', // Open
                  '03': '3', // Closed
                  '04': '4', // Pre-Open
                  '05': '2'  // Assume '05' means Open
                };

                resolvedStatus = sessionStatusMap[sessionId] || '2'; // Default to Open
                logger.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from session ID: ${sessionId}`);
              }
            } else {
              // If all else fails, default to 'REG'
              logger.warn(`[TRADING_STATUS] No session ID found, defaulting to 'REG'`);
              resolvedSessionId = 'REG';
            }
          }
        }
      }

      // If Status is still missing, try more aggressive approaches
      if (!resolvedStatus) {
        // If TradingSessionSubID exists, try to derive status from it
        const tradingSessionSubID = message['625'];
        if (tradingSessionSubID) {
          if (tradingSessionSubID.includes('OPEN')) resolvedStatus = '2';
          else if (tradingSessionSubID.includes('CLOS')) resolvedStatus = '3';
          else if (tradingSessionSubID.includes('PRE')) resolvedStatus = '4';

          if (resolvedStatus) {
            logger.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from TradingSessionSubID: ${tradingSessionSubID}`);
          }
        }

        // Check if text field might indicate status
        const text = message[FieldTag.TEXT];
        if (text) {
          if (text.includes('OPEN')) resolvedStatus = '2';
          else if (text.includes('CLOSE')) resolvedStatus = '3';
          else if (text.includes('HALT')) resolvedStatus = '1';

          if (resolvedStatus) {
            logger.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from text: ${text}`);
          }
        }

        // Special case for PSX - session ID 05 typically means market is open
        if (sessionId === '05' && !resolvedStatus) {
          logger.info(`[TRADING_STATUS] Session ID is '05', assuming status is 'Open' (2)`);
          resolvedStatus = '2'; // Assume Open
        }

        // If no status found after all attempts, default to Open (2)
        if (!resolvedStatus) {
          logger.warn(`[TRADING_STATUS] No status found after all checks, defaulting to 'Open' (2)`);
          resolvedStatus = '2'; // Default to Open
        }
      }

      // Construct session info with resolved values
      const sessionInfo: TradingSessionInfo = {
        sessionId: resolvedSessionId || sessionId || 'REG',
        status: resolvedStatus || '2', // Default to Open if still undefined
        startTime: resolvedStartTime,
        endTime: resolvedEndTime
      };

      logger.info(`[TRADING_STATUS] Final resolved session info: ${JSON.stringify(sessionInfo)}`);
      emitter.emit('tradingSessionStatus', sessionInfo);

      // Log the complete raw message for debugging
      logger.info(`[TRADING_STATUS] Complete raw message: ${JSON.stringify(message)}`);
    } catch (error) {
      logger.error(`[TRADING_STATUS] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);

      // Even if there's an error, try to emit some data
      try {
        const fallbackSessionInfo: TradingSessionInfo = {
          sessionId: 'REG',
          status: '2', // Default to Open
          startTime: undefined,
          endTime: undefined
        };

        logger.warn(`[TRADING_STATUS] Emitting fallback session info due to error: ${JSON.stringify(fallbackSessionInfo)}`);
        emitter.emit('tradingSessionStatus', fallbackSessionInfo);
      } catch (fallbackError) {
        logger.error(`[TRADING_STATUS] Even fallback emission failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
  };

  /**
   * Send a heartbeat message
   */
  const sendHeartbeat = (testReqId: string): void => {
    if (!connected) return;

    try {
      const builder = createMessageBuilder();

      builder
        .setMsgType(MessageType.HEARTBEAT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++);

      if (testReqId) {
        builder.addField(FieldTag.TEST_REQ_ID, testReqId);
      }
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a FIX message to the server
   */
  const sendMessage = (message: string): void => {
    if (!socket || !connected) {
      logger.warn('Cannot send message, not connected');
      return;
    }

    try {
      // Log the raw message with SOH delimiters replaced with pipes for readability
      logger.debug(`Sending FIX message with sequence number ${msgSeqNum}: ${message}`);
      logger.debug(`Current server sequence: ${serverSeqNum}`);

      // Send the message
      socket.write(message);
    } catch (error) {
      logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
      // On send error, try to reconnect
      socket?.destroy();
      connected = false;
    }
  };

  /**
   * Handle a logon message from the server
   */
  const handleLogon = (message: ParsedFixMessage): void => {
    loggedIn = true;

    // Get server's sequence number
    serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);

    // If reset sequence number flag is Y, we should reset our sequence counter to 2
    // (1 for the server's logon acknowledgment, and our next message will be 2)
    if (message[FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
      msgSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
      marketDataSeqNum = 2; // Reset market data sequence
      logger.info(`Reset sequence flag is Y, setting our sequence numbers to 2`);
    } else {
      // Otherwise, set our next sequence to be one more than the server's
      msgSeqNum = serverSeqNum + 1;
      // Ensure market data sequence number is also aligned
      marketDataSeqNum = msgSeqNum;
      logger.info(`Using server's sequence, setting sequence numbers to: ${msgSeqNum}`);
    }

    logger.info(`Successfully logged in to FIX server. Server sequence: ${serverSeqNum}, Next sequence: ${msgSeqNum}`);

    // Start heartbeat monitoring
    startHeartbeatMonitoring();

    // Emit event so client can handle login success
    emitter.emit('logon', message);

    // Note: We're removing automatic security list requests after login
    // because we need to control sequence numbers manually
    logger.info('[SECURITY_LIST] Login successful. Use explicit security list requests after logon.');

    // Add a timer to schedule security list requests after a short delay
    setTimeout(() => {
      if (connected && loggedIn) {
        logger.info('[SECURITY_LIST] Requesting equity security list after login');
        sendSecurityListRequestForEquity();
        
        // Request index securities after a delay to prevent sequence issues
        setTimeout(() => {
          if (connected && loggedIn) {
            logger.info('[SECURITY_LIST] Requesting index security list after login');
            sendSecurityListRequestForIndex();
          }
        }, 3000);
      }
    }, 2000);
  };

  /**
   * Check server features to understand its capabilities
   */
  const checkServerFeatures = (): void => {
    try {
      if (!socket || !connected) {
        return;
      }

      logger.info('Checking server features and capabilities...');

      // Try to determine what message types and fields are supported

      // 1. First try a simple test request to see if basic message flow works
      const testReqId = `TEST${Date.now()}`;
      const testMessage = createMessageBuilder()
        .setMsgType(MessageType.TEST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.TEST_REQ_ID, testReqId)
        .buildMessage();

      socket.write(testMessage);
      logger.info(`Sent test request with ID: ${testReqId}`);

      // 2. Check if the server supports security status request
      // This can help identify what endpoint types are available
      setTimeout(() => {
        sendSecurityStatusRequest('KSE100');
      }, 2000);

    } catch (error) {
      logger.error('Error checking server features:', error);
    }
  };

  /**
   * Send a security status request to check if a symbol is valid
   */
  const sendSecurityStatusRequest = (symbol: string): string | null => {
    try {
      if (!socket || !connected) {
        return null;
      }

      const requestId = uuidv4();

      // Security status request is type 'e' in FIX 4.4+
      const message = createMessageBuilder()
        .setMsgType('e') // Security Status Request
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.SECURITY_STATUS_REQ_ID, requestId)
        .addField(FieldTag.SYMBOL, symbol)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .buildMessage();

      socket.write(message);
      logger.info(`Sent security status request for: ${symbol}`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending security status request for ${symbol}:`, error);
      return null;
    }
  };

  /**
   * Handle market data request reject
   */
  const handleMarketDataRequestReject = (message: ParsedFixMessage): void => {
    try {
      const mdReqId = message[FieldTag.MD_REQ_ID];
      const rejectReason = message[FieldTag.MD_REJECT_REASON];
      const text = message[FieldTag.TEXT];

      logger.error(`Market data request rejected for ID: ${mdReqId}`);
      logger.error(`Reject reason: ${rejectReason}`);
      if (text) {
        logger.error(`Text: ${text}`);
      }

      // Emit an event so client can handle this
      emitter.emit('marketDataReject', {
        requestId: mdReqId,
        reason: rejectReason,
        text: text
      });
    } catch (error) {
      logger.error(`Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Try alternative approaches to request KSE data
   */
  const tryAlternativeKseRequest = (): void => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send alternative KSE request: not connected');
        return;
      }

      logger.info('Sending alternative KSE data request...');

      // Try with snapshot only instead of snapshot+updates
      const requestId = uuidv4();
      const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];

      // Try different entry types in case index value is not supported
      const entryTypes = ['3', '0', '1']; // Index value, Bid, Offer

      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
        .addField(FieldTag.MARKET_DEPTH, '0'); // 0 = Full Book

      // Skip MD_UPDATE_TYPE to see if that helps

      // Add symbols one by one with separate requests
      message.addField(FieldTag.NO_RELATED_SYM, '1'); // Just one symbol at a time
      message.addField(FieldTag.SYMBOL, 'KSE100'); // Try just KSE100

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
      for (const entryType of entryTypes) {
        message.addField(FieldTag.MD_ENTRY_TYPE, entryType);
      }

      // Try without the raw data fields

      const rawMessage = message.buildMessage();
      logger.info(`Alternative KSE request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      socket.write("8=FIXT.1.19=25435=W49=realtime56=NMDUFISQ000134=5952=20230104-09:40:37.62442=20230104-09:40:37.00010201=30211500=08055=ASCR8538=T1140=2.57008503=0387=0.008504=0.0000268=2269=xe270=4.570000271=0.001023=0346=0269=xf270=0.570000271=0.001023=0346=010=250");

      // Also try individual symbol requests
      setTimeout(() => {
        for (const symbol of kseSymbols) {
          logger.info(`Sending individual request for symbol: ${symbol}`);
          sendIndividualSymbolRequest(symbol);
        }
      }, 2000);

    } catch (error) {
      logger.error('Error sending alternative KSE request:', error);
    }
  };

  /**
   * Send a request for an individual symbol
   */
  const sendIndividualSymbolRequest = (symbol: string): string | null => {
    try {
      if (!socket || !connected) {
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
        .addField(FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
        .addField(FieldTag.NO_RELATED_SYM, '1')
        .addField(FieldTag.SYMBOL, symbol)
        .addField(FieldTag.NO_MD_ENTRY_TYPES, '1')
        .addField(FieldTag.MD_ENTRY_TYPE, '3'); // 3 = Index value

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent individual symbol request for: ${symbol}`);
      return requestId;
    } catch (error) {
      logger.error(`Error sending individual symbol request for ${symbol}:`, error);
      return null;
    }
  };

  /**
   * Handle a logout message from the server
   */
  const handleLogout = (message: ParsedFixMessage): void => {
    loggedIn = false;

    // Get any provided text reason for the logout
    const text = message[FieldTag.TEXT];

    // Check if this is a sequence number related logout
    if (text && (text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'))) {
      logger.warn(`Received logout due to sequence number issue: ${text}`);

      // Try to parse the expected sequence number from the message
      const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
      if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
        const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
        if (!isNaN(expectedSeqNum)) {
          logger.info(`Server expects sequence number: ${expectedSeqNum}`);

          // Perform a full disconnect and reconnect with sequence reset
          if (socket) {
            logger.info('Disconnecting due to sequence number error');
            socket.destroy();
            socket = null;
          }

          // Wait a moment before reconnecting
          setTimeout(() => {
            // Reset sequence numbers to what the server expects
            msgSeqNum = expectedSeqNum;
            serverSeqNum = expectedSeqNum - 1;

            logger.info(`Reconnecting with adjusted sequence numbers: msgSeqNum=${msgSeqNum}, serverSeqNum=${serverSeqNum}`);
            connect();
          }, 2000);
        } else {
          // If we can't parse the expected sequence number, do a full reset
          logger.info('Cannot parse expected sequence number, performing full reset');

          if (socket) {
            socket.destroy();
            socket = null;
          }

          setTimeout(() => {
            // Reset sequence numbers
            msgSeqNum = 1;
            serverSeqNum = 1;

            logger.info('Reconnecting with fully reset sequence numbers');
            connect();
          }, 2000);
        }
      } else {
        // No match found, do a full reset
        logger.info('No expected sequence number found in message, performing full reset');

        if (socket) {
          socket.destroy();
          socket = null;
        }

        setTimeout(() => {
          // Reset sequence numbers
          msgSeqNum = 1;
          serverSeqNum = 1;

          logger.info('Reconnecting with fully reset sequence numbers');
          connect();
        }, 2000);
      }
    } else {
      // Emit logout event for normal logouts
      emitter.emit('logout', message);
    }

    // Clear the heartbeat timer as we're logged out
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    logger.info('Logged out from FIX server');
    logger.info('[SECURITY_LIST] Main sequence number will be reset on reconnection');
  };

  /**
   * Start the heartbeat monitoring process
   */
  const startHeartbeatMonitoring = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    // Send heartbeat every N seconds (from options)
    const heartbeatInterval = options.heartbeatIntervalSecs * 1000;
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityTime;

      // If we haven't received anything for 2x the heartbeat interval,
      // send a test request
      if (timeSinceLastActivity > heartbeatInterval * 2) {
        testRequestCount++;

        // If we've sent 3 test requests with no response, disconnect
        if (testRequestCount > 3) {
          logger.warn('No response to test requests, disconnecting');
          disconnect();
          return;
        }

        // Send test request
        try {
          const builder = createMessageBuilder();
          const testReqId = `TEST${Date.now()}`;

          builder
            .setMsgType(MessageType.TEST_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(msgSeqNum++);

          builder.addField(FieldTag.TEST_REQ_ID, testReqId);

          const message = builder.buildMessage();
          sendMessage(message);
        } catch (error) {
          logger.error(`Error sending test request: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // If we've received activity, just send a regular heartbeat
        sendHeartbeat('');
      }
    }, heartbeatInterval);
  };

  /**
   * Send a market data request
   */
  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType: string = '1'     // Default: 1 = Snapshot + Updates
  ): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID('realtime')
        .setTargetCompID('NMDUFISQ0001')
        .setMsgSeqNum(marketDataSeqNum++) // Use marketDataSeqNum
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add PartyID group (required by PSX)
      message
        .addField('453', '1') // NoPartyIDs = 1
        .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
        .addField('447', 'D') // PartyIDSource = D (custom)
        .addField('452', '3'); // PartyRole = 3 (instead of 2)

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

      const rawMessage = message.buildMessage();
      logger.info(`Sent market data request with ID: ${requestId}`);
      logger.info(`Market data request message: ${rawMessage}`);
      socket.write(rawMessage);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data request:', error);
      return null;
    }
  };

  /**
   * Send a security list request
   */
  const sendSecurityListRequest = (): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send security list request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum) // Use main sequence number instead of dedicated one
        .addField(FieldTag.SECURITY_REQ_ID, requestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent security list request with sequence number: ${msgSeqNum}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending security list request:', error);
      return null;
    }
  };

  /**
   * Send a trading session status request for REG market
   */
  const sendTradingSessionStatusRequest = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('Cannot send trading session status request: not connected or not logged in');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent trading session status request for REG market (seq: ${msgSeqNum - 1})`);
      return requestId;
    } catch (error) {
      logger.error('Error sending trading session status request:', error);
      return null;
    }
  };

  /**
   * Send a security list request for REG and FUT markets (EQUITY)
   */
  const sendSecurityListRequestForEquity = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST] Cannot send equity security list request: not connected or not logged in');
        return null;
      }

      logger.info(`[SECURITY_LIST] Current equity sequence number before request: ${msgSeqNum}`);

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST] Sending EQUITY security list request with ID: ${requestId}`);

      // Create message in the format used by fn-psx project
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum); // Use main sequence number instead of dedicated one

      // Add required fields in same order as fn-psx
      message.addField(FieldTag.SECURITY_REQ_ID, requestId);
      message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
      message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
      message.addField('460', '4'); // Product = EQUITY (4)
      message.addField('336', 'REG'); // TradingSessionID = REG

      const rawMessage = message.buildMessage();
      logger.info(`[SECURITY_LIST] Raw equity security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);

      if (socket) {
        socket.write(rawMessage);
        // Increment main sequence number after sending
        msgSeqNum++;
        logger.info(`[SECURITY_LIST] Equity security list request sent successfully. Next equity sequence: ${msgSeqNum}`);
        logger.info(`[SECURITY_LIST] Main sequence number incremented to ${msgSeqNum} for next message`);
        return requestId;
      } else {
        logger.error(`[SECURITY_LIST] Failed to send equity security list request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * Send a security list request for REG market (INDEX)
   */
  const sendSecurityListRequestForIndex = (): string | null => {
    try {
      if (!socket || !connected || !loggedIn) {
        logger.error('[SECURITY_LIST] Cannot send index security list request: not connected or not logged in');
        return null;
      }

      logger.info(`[SECURITY_LIST] Current main sequence number before request: ${msgSeqNum}`);

      const requestId = uuidv4();
      logger.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);

      // Create message in the format used by fn-psx project
      const message = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum); // Use main sequence number instead of dedicated one

      // Add required fields in same order as fn-psx
      message.addField(FieldTag.SECURITY_REQ_ID, requestId);
      message.addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
      message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
      message.addField('460', '5'); // Product = INDEX (5)
      message.addField('336', 'REG'); // TradingSessionID = REG

      const rawMessage = message.buildMessage();
      logger.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(SOH, 'g'), '|')}`);

      if (socket) {
        socket.write(rawMessage);
        // Increment main sequence number after sending
        msgSeqNum++;
        logger.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${msgSeqNum}`);
        logger.info(`[SECURITY_LIST] Main sequence number incremented to ${msgSeqNum} for next message`);

        // Also start index market data updates
        setTimeout(() => {
          if (loggedIn) {
            startIndexUpdates();
          }
        }, 5000);

        return requestId;
      } else {
        logger.error(`[SECURITY_LIST] Failed to send index security list request - socket not available`);
        return null;
      }
    } catch (error) {
      logger.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * Send a market data request for index values
   */
  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data request: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types (3 = Index Value)
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, '1');
      message.addField(FieldTag.MD_ENTRY_TYPE, '3');

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent market data request for indices: ${symbols.join(', ')}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data request:', error);
      return null;
    }
  };

  /**
   * Send a market data subscription request for symbol data
   */
  const sendSymbolMarketDataSubscription = (symbols: string[]): string | null => {
    try {
      if (!socket || !connected) {
        logger.error('Cannot send market data subscription: not connected');
        return null;
      }

      const requestId = uuidv4();
      const message = createMessageBuilder()
        .setMsgType(MessageType.MARKET_DATA_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++)
        .addField(FieldTag.MD_REQ_ID, requestId)
        .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
        .addField(FieldTag.MARKET_DEPTH, '0')
        .addField(FieldTag.MD_UPDATE_TYPE, '0');

      // Add symbols
      message.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
      for (const symbol of symbols) {
        message.addField(FieldTag.SYMBOL, symbol);
      }

      // Add entry types
      message.addField(FieldTag.NO_MD_ENTRY_TYPES, '3');
      message.addField(FieldTag.MD_ENTRY_TYPE, '0'); // Bid
      message.addField(FieldTag.MD_ENTRY_TYPE, '1'); // Offer
      message.addField(FieldTag.MD_ENTRY_TYPE, '2'); // Trade

      const rawMessage = message.buildMessage();
      socket.write(rawMessage);
      logger.info(`Sent market data subscription for symbols: ${symbols.join(', ')}`);
      return requestId;
    } catch (error) {
      logger.error('Error sending market data subscription:', error);
      return null;
    }
  };

  // Start index data updates every 20 seconds
  const startIndexUpdates = () => {
    const indexSymbols = ['KSE100', 'KMI30'];
    setInterval(() => {
      sendIndexMarketDataRequest(indexSymbols);
    }, 20000);
  };

  /**
   * Send a logon message to the server
   */
  const sendLogon = (): void => {
    logger.info('Sending logon message...');
    if (!connected) {
      logger.warn('Cannot send logon, not connected');
      return;
    }

    try {
      // Always reset sequence number on logon
      msgSeqNum = 1; // Start with 1 for the logon message
      serverSeqNum = 1;
      logger.info('Resetting sequence numbers to 1 for new logon');

      const sendingTime = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
      logger.debug(`Generated SendingTime: ${sendingTime}`);

      // Create logon message following fn-psx format
      // First set header fields
      const builder = createMessageBuilder();
      builder
        .setMsgType(MessageType.LOGON)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum); // Use sequence number 1

      // Then add body fields in the order used by fn-psx
      builder.addField(FieldTag.ENCRYPT_METHOD, '0');
      builder.addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
      builder.addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
      builder.addField(FieldTag.USERNAME, options.username);
      builder.addField(FieldTag.PASSWORD, options.password);
      builder.addField(FieldTag.DEFAULT_APPL_VER_ID, '9');
      builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID

      const message = builder.buildMessage();
      logger.info(`Sending Logon Message with sequence number ${msgSeqNum}: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      sendMessage(message);

      // Now increment sequence number for next message
      msgSeqNum++;
      logger.info(`Incremented sequence number to ${msgSeqNum} for next message after logon`);
    } catch (error) {
      logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Send a logout message to the server
   */
  const sendLogout = (text?: string): void => {
    if (!connected) {
      logger.warn('Cannot send logout, not connected');
      emitter.emit('logout', {
        message: 'Logged out in to FIX server',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const builder = createMessageBuilder();

      builder
        .setMsgType(MessageType.LOGOUT)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum++);

      if (text) {
        builder.addField(FieldTag.TEXT, text);
      }

      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle trading status message - specific format for PSX
   */
  const handleTradingStatus = (message: ParsedFixMessage): void => {
    try {
      const symbol = message[FieldTag.SYMBOL];
      const sendingTime = message[FieldTag.SENDING_TIME];
      const origTime = message['42']; // OrigTime
      const tradingStatus = message['102']; // Trading Status

      logger.info(`Received TRADING STATUS for ${symbol}:`);
      logger.info(`  Status: ${tradingStatus}`);
      logger.info(`  Time: ${sendingTime} (Orig: ${origTime})`);

      // Check if this is KSE data
      const isKseData = symbol && (symbol.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse');

      if (isKseData) {
        // Emit a KSE trading status event
        emitter.emit('kseTradingStatus', {
          symbol,
          status: tradingStatus,
          timestamp: sendingTime,
          origTime
        });

        // Convert to a market data item format for compatibility
        const marketDataItems: MarketDataItem[] = [{
          symbol: symbol || '',
          entryType: 'f', // Trading status as entry type
          price: tradingStatus ? parseFloat(tradingStatus) : undefined,
          timestamp: sendingTime
        }];

        // Also emit as KSE data for backward compatibility
        emitter.emit('kseData', marketDataItems);
      }

    } catch (error) {
      logger.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Handle a reject message from the server
   */
  const handleReject = (message: ParsedFixMessage): void => {
    try {
      const refSeqNum = message[FieldTag.REF_SEQ_NUM];
      const refTagId = message[FieldTag.REF_TAG_ID];
      const text = message[FieldTag.TEXT];
      const msgType = message[FieldTag.MSG_TYPE];

      logger.error(`Received REJECT message for sequence number ${refSeqNum}`);
      logger.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);

      // If it's a sequence number issue, reset the connection
      const isSequenceError = refTagId === '34' ||
        text?.includes('MsgSeqNum') ||
        text?.includes('too large') ||
        text?.includes('sequence');

      if (isSequenceError) {
        logger.info('Sequence number mismatch detected, handling sequence reset...');

        // If text contains specific sequence number information, try to parse it
        const expectedSeqNumMatch = text?.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
          const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
          if (!isNaN(expectedSeqNum)) {
            logger.info(`Server expects sequence number: ${expectedSeqNum}`);

            // If the expected sequence is less than our current, we need to reset
            if (expectedSeqNum < msgSeqNum) {
              logger.info(`Our sequence (${msgSeqNum}) is greater than expected (${expectedSeqNum}), resetting connection`);

              // Perform a full disconnect and reconnect
              if (socket) {
                logger.info('Closing socket and resetting sequence numbers');
                socket.destroy();
                socket = null;
              }

              // Wait a moment before reconnecting
              setTimeout(() => {
                // Reset sequence numbers
                msgSeqNum = expectedSeqNum;
                serverSeqNum = expectedSeqNum - 1;

                logger.info(`Reconnecting with adjusted sequence numbers: msgSeqNum=${msgSeqNum}, serverSeqNum=${serverSeqNum}`);
                connect();
              }, 2000);
            } else {
              // If expected sequence is higher, try to continue with corrected sequence
              logger.info(`Our sequence (${msgSeqNum}) is less than expected (${expectedSeqNum}), adjusting sequence`);
              msgSeqNum = expectedSeqNum;
              logger.info(`Adjusted sequence number to ${msgSeqNum}`);

              // Send a heartbeat with the correct sequence number to sync
              sendHeartbeat('');
            }
          }
        } else {
          // If we can't determine the expected sequence, do a full reset
          logger.info('Cannot determine expected sequence number, performing full reset');

          // Perform a full disconnect and reconnect
          if (socket) {
            logger.info('Closing socket and resetting sequence numbers to 1');
            socket.destroy();
            socket = null;
          }

          // Wait a moment before reconnecting
          setTimeout(() => {
            // Reset sequence numbers
            msgSeqNum = 1;
            serverSeqNum = 1;

            logger.info('Reconnecting with reset sequence numbers = 1');
            connect();
          }, 2000);
        }
      }

      // Emit reject event
      emitter.emit('reject', {
        refSeqNum,
        refTagId,
        text,
        msgType
      });
    } catch (error) {
      logger.error(`Error handling reject message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Return the public API
  const client = {
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return client;
    },
    connect,
    disconnect,
    sendMarketDataRequest,
    sendSecurityListRequest,
    sendTradingSessionStatusRequest,
    sendSecurityListRequestForEquity,
    sendSecurityListRequestForIndex,
    sendIndexMarketDataRequest,
    sendSymbolMarketDataSubscription,
    sendSecurityStatusRequest,
    sendLogon,
    sendLogout,
    start,
    stop,
    setSequenceNumber: (newSeq: number) => {
      forceResetSequenceNumber(newSeq);
      return client;
    },
    reset: () => {
      // Disconnect completely
      logger.info('[RESET] Performing complete reset with disconnection and reconnection');
      if (socket) {
        socket.destroy();
        socket = null;
      }
      connected = false;
      loggedIn = false;

      // Clear any timers
      clearTimers();

      // Reset sequence numbers
      msgSeqNum = 1;
      serverSeqNum = 1;

      logger.info('[RESET] Connection and sequence numbers reset to initial state');

      // Wait a moment and reconnect
      setTimeout(() => {
        logger.info('[RESET] Reconnecting after reset');
        connect();
      }, 3000);

      return client;
    },
    requestSecurityList: () => {
      logger.info('[SECURITY_LIST] Starting comprehensive security list request');

      // Keep track of request IDs for logging
      const equityRequestId = uuidv4();

      // Request equity securities first
      logger.info(`[SECURITY_LIST] Requesting EQUITY securities with request ID: ${equityRequestId}`);
      
      // Create message builder with specific settings for equity request
      const equityMessage = createMessageBuilder()
        .setMsgType(MessageType.SECURITY_LIST_REQUEST)
        .setSenderCompID(options.senderCompId)
        .setTargetCompID(options.targetCompId)
        .setMsgSeqNum(msgSeqNum)
        .addField(FieldTag.SECURITY_REQ_ID, equityRequestId)
        .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
        .addField('55', 'NA') // Symbol = NA as used in fn-psx
        .addField('460', '4') // Product = EQUITY (4)
        .addField('336', 'REG'); // TradingSessionID = REG

      const rawEquityMessage = equityMessage.buildMessage();
      logger.info(`[SECURITY_LIST] Sending equity security list request message: ${rawEquityMessage.replace(new RegExp(SOH, 'g'), '|')}`);
      
      if (socket) {
        socket.write(rawEquityMessage);
        logger.info(`[SECURITY_LIST] Equity security list request sent successfully. Next equity sequence: ${msgSeqNum}`);

        // Wait for response before requesting index securities
        setTimeout(() => {
          if (!socket || !connected) {
            logger.error('[SECURITY_LIST] Cannot send index security list request - not connected');
            return;
          }

          const indexRequestId = uuidv4();
          logger.info(`[SECURITY_LIST] Requesting INDEX securities with request ID: ${indexRequestId}`);
          
          const indexMessage = createMessageBuilder()
            .setMsgType(MessageType.SECURITY_LIST_REQUEST)
            .setSenderCompID(options.senderCompId)
            .setTargetCompID(options.targetCompId)
            .setMsgSeqNum(msgSeqNum)
            .addField(FieldTag.SECURITY_REQ_ID, indexRequestId)
            .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
            .addField('55', 'NA') // Symbol = NA as used in fn-psx
            .addField('460', '5') // Product = INDEX (5)
            .addField('336', 'REG'); // TradingSessionID = REG

          const rawIndexMessage = indexMessage.buildMessage();
          logger.info(`[SECURITY_LIST] Sending index security list request message: ${rawIndexMessage.replace(new RegExp(SOH, 'g'), '|')}`);
          
          socket.write(rawIndexMessage);
          logger.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${msgSeqNum}`);
        }, 5000); // Wait 5 seconds before sending index request
      } else {
        logger.error('[SECURITY_LIST] Failed to send equity security list - socket not available');
      }

      return client;
    }
  };
  return client;
}

// Type definition for the returned FixClient API
export interface FixClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'logon', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'logout', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'marketData', listener: (data: any) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'equitySecurityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'indexSecurityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'kseTradingStatus', listener: (status: { symbol: string; status: string; timestamp: string; origTime?: string }) => void): this;
  on(event: 'marketDataReject', listener: (reject: { requestId: string; reason: string; text: string | undefined }) => void): this;
  on(event: 'reject', listener: (reject: { refSeqNum: string; refTagId: string; text: string | undefined; msgType: string }) => void): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(
    symbols: string[],
    entryTypes?: string[],
    subscriptionType?: string
  ): string | null;
  sendSecurityListRequest(): string | null;
  sendTradingSessionStatusRequest(tradingSessionID?: string): string | null;
  sendSecurityListRequestForEquity(): string | null;
  sendSecurityListRequestForIndex(): string | null;
  sendIndexMarketDataRequest(symbols: string[]): string | null;
  sendSymbolMarketDataSubscription(symbols: string[]): string | null;
  sendSecurityStatusRequest(symbol: string): string | null;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
  setSequenceNumber(newSeq: number): this;
  reset(): this;
  requestSecurityList(): this;
}


