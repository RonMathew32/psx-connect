"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFixClient = createFixClient;
const logger_1 = __importDefault(require("../utils/logger"));
const events_1 = require("events");
const message_builder_1 = require("./message-builder");
const constants_1 = require("./constants");
const net_1 = require("net");
const uuid_1 = require("uuid");
/**
 * Create a FIX client with the specified options
 */
function createFixClient(options) {
    const emitter = new events_1.EventEmitter();
    let socket = null;
    let connected = false;
    let loggedIn = false;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let lastActivityTime = 0;
    let testRequestCount = 0;
    let msgSeqNum = 1;
    let serverSeqNum = 1; // Add tracking of server sequence number
    let logonTimer = null;
    let sequenceManager;
    let marketDataSeqNum = 1; // Separate sequence number for market data
    /**
     * Reset sequence numbers to a specific value
     * Used when the server expects a specific sequence number
     */
    const forceResetSequenceNumber = (newSeq = 2) => {
        const oldSeq = msgSeqNum;
        msgSeqNum = newSeq;
        serverSeqNum = newSeq - 1;
        logger_1.default.info(`[SEQUENCE] Forced reset of sequence numbers from ${oldSeq} to ${msgSeqNum} (server: ${serverSeqNum})`);
    };
    /**
     * Start the FIX client and connect to the server
     */
    const start = () => {
        connect();
    };
    /**
     * Stop the FIX client and disconnect from the server
     */
    const stop = () => {
        sendLogout(); // Ensure this is correctly called
        disconnect();
    };
    /**
     * Connect to the FIX server
     */
    const connect = async () => {
        if (socket && connected) {
            logger_1.default.warn('Already connected');
            return;
        }
        try {
            // Create socket with specific configuration - matching fn-psx
            socket = new net_1.Socket();
            // Apply socket settings exactly like fn-psx
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            // Set connection timeout 
            socket.setTimeout(options.connectTimeoutMs || 30000);
            // Setup event handlers
            socket.on('timeout', () => {
                logger_1.default.error('Connection timed out');
                socket?.destroy();
                connected = false;
                emitter.emit('error', new Error('Connection timed out'));
            });
            socket.on('error', (error) => {
                logger_1.default.error(`Socket error: ${error.message}`);
                emitter.emit('error', error);
            });
            socket.on('close', () => {
                logger_1.default.info('Socket disconnected');
                connected = false;
                emitter.emit('disconnected');
                scheduleReconnect();
            });
            socket.on('connect', () => {
                logger_1.default.info(`Connected to ${options.host}:${options.port}`);
                connected = true;
                // Clear any existing timeout to prevent duplicate logon attempts
                if (logonTimer) {
                    clearTimeout(logonTimer);
                }
                // Send logon message after a short delay - exactly like fn-psx
                logonTimer = setTimeout(() => {
                    try {
                        logger_1.default.info('Sending logon message...');
                        sendLogon();
                    }
                    catch (error) {
                        logger_1.default.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
                        disconnect();
                    }
                }, 500);
                emitter.emit('connected');
            });
            // Handle received data
            socket.on('data', (data) => {
                logger_1.default.info("--------------------------------");
                handleData(data);
            });
            // Connect to the server
            logger_1.default.info(`Establishing TCP connection to ${options.host}:${options.port}...`);
            socket.connect(options.port, options.host);
        }
        catch (error) {
            logger_1.default.error(`Error creating socket or connecting: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    };
    /**
     * Disconnect from the FIX server
     */
    const disconnect = () => {
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
    const scheduleReconnect = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        logger_1.default.info('Scheduling reconnect in 5 seconds');
        reconnectTimer = setTimeout(() => {
            logger_1.default.info('Attempting to reconnect');
            connect();
        }, 5000);
    };
    /**
     * Clear all timers
     */
    const clearTimers = () => {
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
    const handleData = (data) => {
        try {
            lastActivityTime = Date.now();
            const dataStr = data.toString();
            logger_1.default.debug(`Received data: ${dataStr.length} bytes`);
            const messages = dataStr.split(constants_1.SOH);
            let currentMessage = '';
            for (const segment of messages) {
                if (segment.startsWith('8=FIX')) {
                    // If we have a previous message, process it
                    if (currentMessage) {
                        processMessage(currentMessage);
                    }
                    // Start a new message
                    currentMessage = segment;
                }
                else if (currentMessage) {
                    // Add to current message
                    currentMessage += constants_1.SOH + segment;
                }
            }
            // Process the last message if exists
            if (currentMessage) {
                // logger.info(`Processing message: ${currentMessage}`);
                processMessage(currentMessage);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Process a FIX message
     */
    const processMessage = (message) => {
        try {
            const segments = message.split(constants_1.SOH);
            // FIX message should start with "8=FIX"
            const fixVersion = segments.find(s => s.startsWith('8=FIX'));
            if (!fixVersion) {
                logger_1.default.warn('Received non-FIX message');
                return;
            }
            // Log the raw message in FIX format (replacing SOH with pipe for readability)
            logger_1.default.info(`Received FIX message: ${message}`);
            logger_1.default.info(`------------------------------------------------------------------------------------------------------------`);
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
        }
        catch (error) {
            logger_1.default.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Get human-readable name for a message type
     */
    const getMessageTypeName = (msgType) => {
        // Find the message type name by its value
        for (const [name, value] of Object.entries(constants_1.MessageType)) {
            if (value === msgType) {
                return name;
            }
        }
        return 'UNKNOWN';
    };
    /**
     * Handle a market data snapshot message
     */
    const handleMarketDataSnapshot = (message) => {
        try {
            // Extract the request ID to identify which request this is responding to
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            const symbol = message[constants_1.FieldTag.SYMBOL];
            logger_1.default.info(`[MARKET_DATA] Received market data snapshot for request: ${mdReqId}, symbol: ${symbol}`);
            // Process market data entries
            const marketDataItems = [];
            // Check if we have entries
            const noEntries = parseInt(message[constants_1.FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);
            if (noEntries > 0) {
                // Extract entries - in a real implementation, this would be more robust
                // and handle multiple entries properly by parsing groups
                for (let i = 0; i < 100; i++) { // Safe upper limit
                    const entryType = message[`${constants_1.FieldTag.MD_ENTRY_TYPE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_TYPE];
                    const price = message[`${constants_1.FieldTag.MD_ENTRY_PX}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_PX];
                    const size = message[`${constants_1.FieldTag.MD_ENTRY_SIZE}.${i}`] || message[constants_1.FieldTag.MD_ENTRY_SIZE];
                    if (!entryType)
                        break; // No more entries
                    marketDataItems.push({
                        symbol: symbol || '',
                        entryType,
                        price: price ? parseFloat(price) : undefined,
                        size: size ? parseFloat(size) : undefined,
                        timestamp: message[constants_1.FieldTag.SENDING_TIME]
                    });
                }
            }
            // Once we've properly parsed the data, emit it
            if (marketDataItems.length > 0) {
                logger_1.default.info(`[MARKET_DATA] Extracted ${marketDataItems.length} market data items for ${symbol}`);
                // Use marketDataSeqNum for tracking
                logger_1.default.info(`[MARKET_DATA] Emitting market data with sequence number: ${marketDataSeqNum}`);
                emitter.emit('marketData', marketDataItems);
                // Check if this is KSE data
                const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
                if (isKseData) {
                    logger_1.default.info(`[MARKET_DATA] Received KSE data for ${symbol}: ${JSON.stringify(marketDataItems)}`);
                    emitter.emit('kseData', marketDataItems);
                }
            }
            else {
                // Even if no items were found, emit the raw message for debugging
                logger_1.default.info(`[MARKET_DATA] No market data items extracted, emitting raw message`);
                emitter.emit('marketData', message);
            }
        }
        catch (error) {
            logger_1.default.error(`[MARKET_DATA] Error handling market data snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a market data incremental refresh message
     */
    const handleMarketDataIncremental = (message) => {
        // Similar implementation to handleMarketDataSnapshot, but for incremental updates
        try {
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            logger_1.default.info(`Received market data incremental refresh for request: ${mdReqId}`);
            // Process incremental updates - simplified version
            const marketDataItems = [];
            // Parse the incremental updates and emit an event
            // Real implementation would be more robust
            if (marketDataItems.length > 0) {
                emitter.emit('marketData', marketDataItems);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling market data incremental: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a security list message
     */
    const handleSecurityList = (message) => {
        logger_1.default.info('[SECURITY_LIST] ===================== SECURITY LIST RESPONSE RECEIVED =====================');
        try {
            // Extract key information
            const reqId = message[constants_1.FieldTag.SECURITY_REQ_ID] || 'unknown';
            const securityReqType = message[constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE];
            const securityType = message[constants_1.FieldTag.SECURITY_TYPE];
            const productType = message['460']; // Product type field
            const securityCount = parseInt(message[constants_1.FieldTag.NO_RELATED_SYM] || '0', 10);
            const messageSeqNum = message[constants_1.FieldTag.MSG_SEQ_NUM] || 'unknown';
            // Simple logging of raw message for debugging
            if (message.raw) {
                logger_1.default.info(`[SECURITY_LIST] RAW MESSAGE: ${message.raw.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            }
            // Log basic information
            logger_1.default.info(`[SECURITY_LIST] Message Sequence Number: ${messageSeqNum}`);
            logger_1.default.info(`[SECURITY_LIST] Request ID: ${reqId}`);
            logger_1.default.info(`[SECURITY_LIST] Product Type: ${productType || 'not specified'}`);
            logger_1.default.info(`[SECURITY_LIST] Security Type: ${securityType || 'not specified'}`);
            logger_1.default.info(`[SECURITY_LIST] Number of Securities: ${securityCount}`);
            // Create security list
            const securities = [];
            // Extract securities using simplified approach
            for (let i = 0; i < 1000; i++) {
                const symbolKey = i === 0 ? constants_1.FieldTag.SYMBOL : `${constants_1.FieldTag.SYMBOL}.${i}`;
                const symbol = message[symbolKey];
                if (!symbol) {
                    if (i > 0)
                        break;
                    continue;
                }
                const secTypeKey = i === 0 ? constants_1.FieldTag.SECURITY_TYPE : `${constants_1.FieldTag.SECURITY_TYPE}.${i}`;
                const secDescKey = i === 0 ? constants_1.FieldTag.SECURITY_DESC : `${constants_1.FieldTag.SECURITY_DESC}.${i}`;
                const marketIdKey = i === 0 ? constants_1.FieldTag.MARKET_ID : `${constants_1.FieldTag.MARKET_ID}.${i}`;
                const securityInfo = {
                    symbol,
                    securityType: message[secTypeKey] || '',
                    securityDesc: message[secDescKey] || '',
                    marketId: message[marketIdKey] || ''
                };
                securities.push(securityInfo);
                logger_1.default.info(`[SECURITY_LIST] Found security: ${symbol}`);
            }
            // Look for fields with numeric suffix
            for (const key in message) {
                if (key.startsWith('55.') || key.startsWith('55_')) {
                    const symbol = message[key];
                    if (!symbol || typeof symbol !== 'string')
                        continue;
                    const parts = key.split(/[._]/);
                    const index = parts[1];
                    if (!index)
                        continue;
                    const secTypeKey = `167.${index}` || `167_${index}`;
                    const secDescKey = `107.${index}` || `107_${index}`;
                    const marketIdKey = `1301.${index}` || `1301_${index}`;
                    const securityInfo = {
                        symbol,
                        securityType: message[secTypeKey] || '',
                        securityDesc: message[secDescKey] || '',
                        marketId: message[marketIdKey] || ''
                    };
                    securities.push(securityInfo);
                    logger_1.default.info(`[SECURITY_LIST] Found security with index ${index}: ${symbol}`);
                }
            }
            // Remove duplicates
            const uniqueSecurities = Array.from(new Map(securities.map(s => [s.symbol, s])).values());
            logger_1.default.info(`[SECURITY_LIST] Total unique securities found: ${uniqueSecurities.length}`);
            // Determine list type
            const isEquityList = productType === '4';
            const isIndexList = productType === '5';
            if (uniqueSecurities.length > 0) {
                // Log sample data
                logger_1.default.info(`[SECURITY_LIST] Sample securities:`);
                const sampleSize = Math.min(3, uniqueSecurities.length);
                for (let i = 0; i < sampleSize; i++) {
                    logger_1.default.info(`[SECURITY_LIST] ${i + 1}. ${JSON.stringify(uniqueSecurities[i])}`);
                }
                // Emit appropriate events
                if (isEquityList) {
                    logger_1.default.info(`[SECURITY_LIST] Emitting EQUITY security list with ${uniqueSecurities.length} items`);
                    emitter.emit('equitySecurityList', uniqueSecurities);
                }
                else if (isIndexList) {
                    logger_1.default.info(`[SECURITY_LIST] Emitting INDEX security list with ${uniqueSecurities.length} items`);
                    emitter.emit('indexSecurityList', uniqueSecurities);
                }
                // Always emit generic event
                logger_1.default.info(`[SECURITY_LIST] Emitting generic security list event`);
                emitter.emit('securityList', uniqueSecurities);
            }
            else {
                logger_1.default.warn(`[SECURITY_LIST] No securities found in the response`);
                emitter.emit('securityList', []);
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error processing security list: ${error instanceof Error ? error.message : String(error)}`);
            emitter.emit('securityList', []);
        }
        logger_1.default.info('[SECURITY_LIST] ===================== END SECURITY LIST RESPONSE =====================');
    };
    /**
     * Handle a trading session status message
     */
    const handleTradingSessionStatus = (message) => {
        try {
            // Log the entire message for debugging
            logger_1.default.info(`[TRADING_STATUS] Raw message content: ${JSON.stringify(message)}`);
            // Extract standard fields
            const reqId = message[constants_1.FieldTag.TRAD_SES_REQ_ID];
            const sessionId = message[constants_1.FieldTag.TRADING_SESSION_ID];
            const status = message[constants_1.FieldTag.TRAD_SES_STATUS];
            const startTime = message[constants_1.FieldTag.START_TIME];
            const endTime = message[constants_1.FieldTag.END_TIME];
            // Detailed logging to troubleshoot missing data
            logger_1.default.info(`[TRADING_STATUS] Received trading session status for request: ${reqId || 'unknown'}`);
            logger_1.default.info(`[TRADING_STATUS] Session ID (Tag 336): ${sessionId || 'undefined'}`);
            logger_1.default.info(`[TRADING_STATUS] Status (Tag 340): ${status || 'undefined'}`);
            logger_1.default.info(`[TRADING_STATUS] Start Time (Tag 341): ${startTime || 'undefined'}`);
            logger_1.default.info(`[TRADING_STATUS] End Time (Tag 342): ${endTime || 'undefined'}`);
            // Add more comprehensive search for fields in different possible locations
            // Alternative field names for PSX-specific formats
            // Some exchanges use non-standard field tags or field locations
            let resolvedSessionId = sessionId;
            let resolvedStatus = status;
            let resolvedStartTime = startTime;
            let resolvedEndTime = endTime;
            // Check all possible tags that might contain session information
            logger_1.default.info(`[TRADING_STATUS] Searching for alternative session status fields...`);
            // Systematically check all fields for relevant information
            for (const [tag, value] of Object.entries(message)) {
                logger_1.default.info(`[TRADING_STATUS] Checking tag ${tag}: ${value}`);
                // Look for session ID in alternative tags
                if (!resolvedSessionId &&
                    (tag === '1151' || tag === '1300' || tag === '1301' || tag === '625' ||
                        tag === '336' || tag === '335' || tag === '207')) {
                    logger_1.default.info(`[TRADING_STATUS] Found potential session ID in tag ${tag}: ${value}`);
                    resolvedSessionId = value;
                }
                // Look for status in alternative tags
                if (!resolvedStatus &&
                    (tag === '325' || tag === '326' || tag === '327' || tag === '328' ||
                        tag === '329' || tag === '332' || tag === '339' || tag === '340' ||
                        tag === '5840' || tag === '5841' || tag === '865' || tag === '102')) {
                    logger_1.default.info(`[TRADING_STATUS] Found potential status in tag ${tag}: ${value}`);
                    resolvedStatus = value;
                }
                // Look for times in alternative tags
                if (!resolvedStartTime &&
                    (tag === '341' || tag === '343' || tag === '345' || tag === '345' ||
                        tag === '5894' || tag === '5895' || tag === '5898')) {
                    logger_1.default.info(`[TRADING_STATUS] Found potential start time in tag ${tag}: ${value}`);
                    resolvedStartTime = value;
                }
                if (!resolvedEndTime &&
                    (tag === '342' || tag === '344' || tag === '346' || tag === '347' ||
                        tag === '5899' || tag === '5900' || tag === '5901')) {
                    logger_1.default.info(`[TRADING_STATUS] Found potential end time in tag ${tag}: ${value}`);
                    resolvedEndTime = value;
                }
            }
            // If Session ID is still missing, try more aggressive approaches
            if (!resolvedSessionId) {
                // Check if we have a MarketID field
                const marketId = message[constants_1.FieldTag.MARKET_ID];
                if (marketId) {
                    logger_1.default.info(`[TRADING_STATUS] Using market ID as session ID: ${marketId}`);
                    resolvedSessionId = marketId;
                }
                else {
                    // Look for any tag with "session" in its name (for debugging)
                    const sessionTags = Object.entries(message)
                        .filter(([k, v]) => k.toLowerCase().includes('session') || v.toString().toLowerCase().includes('session'));
                    if (sessionTags.length > 0) {
                        logger_1.default.info(`[TRADING_STATUS] Found ${sessionTags.length} tags related to session: ${JSON.stringify(sessionTags)}`);
                        // Use the first one as a last resort
                        if (!resolvedSessionId && sessionTags[0]) {
                            resolvedSessionId = sessionTags[0][1];
                            logger_1.default.info(`[TRADING_STATUS] Using ${sessionTags[0][0]} as session ID: ${resolvedSessionId}`);
                        }
                    }
                    else {
                        // Last resort - if session ID is '05', we need to extract status properly
                        if (sessionId === '05') {
                            logger_1.default.info(`[TRADING_STATUS] Session ID is '05', which might be a special PSX format`);
                            // For PSX, session ID '05' might indicate a specific market state
                            resolvedSessionId = 'REG'; // Default to Regular market
                            // In this case, the session ID itself might indicate status
                            if (!resolvedStatus) {
                                // "05" might represent a specific session status code in PSX
                                // Map it to a standard FIX session status code
                                logger_1.default.info(`[TRADING_STATUS] Mapping session ID ${sessionId} to status code`);
                                // Use a map to avoid type comparison issues
                                const sessionStatusMap = {
                                    '01': '1', // Halted
                                    '02': '2', // Open
                                    '03': '3', // Closed
                                    '04': '4', // Pre-Open
                                    '05': '2' // Assume '05' means Open
                                };
                                resolvedStatus = sessionStatusMap[sessionId] || '2'; // Default to Open
                                logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from session ID: ${sessionId}`);
                            }
                        }
                        else {
                            // If all else fails, default to 'REG'
                            logger_1.default.warn(`[TRADING_STATUS] No session ID found, defaulting to 'REG'`);
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
                    if (tradingSessionSubID.includes('OPEN'))
                        resolvedStatus = '2';
                    else if (tradingSessionSubID.includes('CLOS'))
                        resolvedStatus = '3';
                    else if (tradingSessionSubID.includes('PRE'))
                        resolvedStatus = '4';
                    if (resolvedStatus) {
                        logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from TradingSessionSubID: ${tradingSessionSubID}`);
                    }
                }
                // Check if text field might indicate status
                const text = message[constants_1.FieldTag.TEXT];
                if (text) {
                    if (text.includes('OPEN'))
                        resolvedStatus = '2';
                    else if (text.includes('CLOSE'))
                        resolvedStatus = '3';
                    else if (text.includes('HALT'))
                        resolvedStatus = '1';
                    if (resolvedStatus) {
                        logger_1.default.info(`[TRADING_STATUS] Derived status ${resolvedStatus} from text: ${text}`);
                    }
                }
                // Special case for PSX - session ID 05 typically means market is open
                if (sessionId === '05' && !resolvedStatus) {
                    logger_1.default.info(`[TRADING_STATUS] Session ID is '05', assuming status is 'Open' (2)`);
                    resolvedStatus = '2'; // Assume Open
                }
                // If no status found after all attempts, default to Open (2)
                if (!resolvedStatus) {
                    logger_1.default.warn(`[TRADING_STATUS] No status found after all checks, defaulting to 'Open' (2)`);
                    resolvedStatus = '2'; // Default to Open
                }
            }
            // Construct session info with resolved values
            const sessionInfo = {
                sessionId: resolvedSessionId || sessionId || 'REG',
                status: resolvedStatus || '2', // Default to Open if still undefined
                startTime: resolvedStartTime,
                endTime: resolvedEndTime
            };
            logger_1.default.info(`[TRADING_STATUS] Final resolved session info: ${JSON.stringify(sessionInfo)}`);
            emitter.emit('tradingSessionStatus', sessionInfo);
            // Log the complete raw message for debugging
            logger_1.default.info(`[TRADING_STATUS] Complete raw message: ${JSON.stringify(message)}`);
        }
        catch (error) {
            logger_1.default.error(`[TRADING_STATUS] Error handling trading session status: ${error instanceof Error ? error.message : String(error)}`);
            // Even if there's an error, try to emit some data
            try {
                const fallbackSessionInfo = {
                    sessionId: 'REG',
                    status: '2', // Default to Open
                    startTime: undefined,
                    endTime: undefined
                };
                logger_1.default.warn(`[TRADING_STATUS] Emitting fallback session info due to error: ${JSON.stringify(fallbackSessionInfo)}`);
                emitter.emit('tradingSessionStatus', fallbackSessionInfo);
            }
            catch (fallbackError) {
                logger_1.default.error(`[TRADING_STATUS] Even fallback emission failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
            }
        }
    };
    /**
     * Send a heartbeat message
     */
    const sendHeartbeat = (testReqId) => {
        if (!connected)
            return;
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.HEARTBEAT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++);
            if (testReqId) {
                builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
            }
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a FIX message to the server
     */
    const sendMessage = (message) => {
        if (!socket || !connected) {
            logger_1.default.warn('Cannot send message, not connected');
            return;
        }
        try {
            // Log the raw message with SOH delimiters replaced with pipes for readability
            logger_1.default.debug(`Sending FIX message with sequence number ${msgSeqNum}: ${message}`);
            logger_1.default.debug(`Current server sequence: ${serverSeqNum}`);
            // Send the message
            socket.write(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
            // On send error, try to reconnect
            socket?.destroy();
            connected = false;
        }
    };
    /**
     * Handle a logon message from the server
     */
    const handleLogon = (message) => {
        loggedIn = true;
        // Get server's sequence number
        serverSeqNum = parseInt(message[constants_1.FieldTag.MSG_SEQ_NUM] || '1', 10);
        // If reset sequence number flag is Y, we should reset our sequence counter to 2
        // (1 for the server's logon acknowledgment, and our next message will be 2)
        if (message[constants_1.FieldTag.RESET_SEQ_NUM_FLAG] === 'Y') {
            msgSeqNum = 2; // Start with 2 after logon acknowledgment with reset flag
            marketDataSeqNum = 2; // Reset market data sequence
            logger_1.default.info(`Reset sequence flag is Y, setting our sequence numbers to 2`);
        }
        else {
            // Otherwise, set our next sequence to be one more than the server's
            msgSeqNum = serverSeqNum + 1;
            // Ensure market data sequence number is also aligned
            marketDataSeqNum = msgSeqNum;
            logger_1.default.info(`Using server's sequence, setting sequence numbers to: ${msgSeqNum}`);
        }
        logger_1.default.info(`Successfully logged in to FIX server. Server sequence: ${serverSeqNum}, Next sequence: ${msgSeqNum}`);
        // Start heartbeat monitoring
        startHeartbeatMonitoring();
        // Emit event so client can handle login success
        emitter.emit('logon', message);
        // Note: We're removing automatic security list requests after login
        // because we need to control sequence numbers manually
        logger_1.default.info('[SECURITY_LIST] Login successful. Use explicit security list requests after logon.');
        // Add a timer to schedule security list requests after a short delay
        setTimeout(() => {
            if (connected && loggedIn) {
                logger_1.default.info('[SECURITY_LIST] Requesting equity security list after login');
                sendSecurityListRequestForEquity();
                // Request index securities after a delay to prevent sequence issues
                setTimeout(() => {
                    if (connected && loggedIn) {
                        logger_1.default.info('[SECURITY_LIST] Requesting index security list after login');
                        sendSecurityListRequestForIndex();
                    }
                }, 3000);
            }
        }, 2000);
    };
    /**
     * Check server features to understand its capabilities
     */
    const checkServerFeatures = () => {
        try {
            if (!socket || !connected) {
                return;
            }
            logger_1.default.info('Checking server features and capabilities...');
            // Try to determine what message types and fields are supported
            // 1. First try a simple test request to see if basic message flow works
            const testReqId = `TEST${Date.now()}`;
            const testMessage = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TEST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.TEST_REQ_ID, testReqId)
                .buildMessage();
            socket.write(testMessage);
            logger_1.default.info(`Sent test request with ID: ${testReqId}`);
            // 2. Check if the server supports security status request
            // This can help identify what endpoint types are available
            setTimeout(() => {
                sendSecurityStatusRequest('KSE100');
            }, 2000);
        }
        catch (error) {
            logger_1.default.error('Error checking server features:', error);
        }
    };
    /**
     * Send a security status request to check if a symbol is valid
     */
    const sendSecurityStatusRequest = (symbol) => {
        try {
            if (!socket || !connected) {
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            // Security status request is type 'e' in FIX 4.4+
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType('e') // Security Status Request
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.SECURITY_STATUS_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SYMBOL, symbol)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .buildMessage();
            socket.write(message);
            logger_1.default.info(`Sent security status request for: ${symbol}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending security status request for ${symbol}:`, error);
            return null;
        }
    };
    /**
     * Handle market data request reject
     */
    const handleMarketDataRequestReject = (message) => {
        try {
            const mdReqId = message[constants_1.FieldTag.MD_REQ_ID];
            const rejectReason = message[constants_1.FieldTag.MD_REJECT_REASON];
            const text = message[constants_1.FieldTag.TEXT];
            logger_1.default.error(`Market data request rejected for ID: ${mdReqId}`);
            logger_1.default.error(`Reject reason: ${rejectReason}`);
            if (text) {
                logger_1.default.error(`Text: ${text}`);
            }
            // Emit an event so client can handle this
            emitter.emit('marketDataReject', {
                requestId: mdReqId,
                reason: rejectReason,
                text: text
            });
        }
        catch (error) {
            logger_1.default.error(`Error handling market data reject: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Try alternative approaches to request KSE data
     */
    const tryAlternativeKseRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send alternative KSE request: not connected');
                return;
            }
            logger_1.default.info('Sending alternative KSE data request...');
            // Try with snapshot only instead of snapshot+updates
            const requestId = (0, uuid_1.v4)();
            const kseSymbols = ['KSE100', 'KSE30', 'KMI30'];
            // Try different entry types in case index value is not supported
            const entryTypes = ['3', '0', '1']; // Index value, Bid, Offer
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0'); // 0 = Full Book
            // Skip MD_UPDATE_TYPE to see if that helps
            // Add symbols one by one with separate requests
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, '1'); // Just one symbol at a time
            message.addField(constants_1.FieldTag.SYMBOL, 'KSE100'); // Try just KSE100
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            // Try without the raw data fields
            const rawMessage = message.buildMessage();
            logger_1.default.info(`Alternative KSE request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            socket.write("8=FIXT.1.19=25435=W49=realtime56=NMDUFISQ000134=5952=20230104-09:40:37.62442=20230104-09:40:37.00010201=30211500=08055=ASCR8538=T1140=2.57008503=0387=0.008504=0.0000268=2269=xe270=4.570000271=0.001023=0346=0269=xf270=0.570000271=0.001023=0346=010=250");
            // Also try individual symbol requests
            setTimeout(() => {
                for (const symbol of kseSymbols) {
                    logger_1.default.info(`Sending individual request for symbol: ${symbol}`);
                    sendIndividualSymbolRequest(symbol);
                }
            }, 2000);
        }
        catch (error) {
            logger_1.default.error('Error sending alternative KSE request:', error);
        }
    };
    /**
     * Send a request for an individual symbol
     */
    const sendIndividualSymbolRequest = (symbol) => {
        try {
            if (!socket || !connected) {
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot only
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0') // 0 = Full Book
                .addField(constants_1.FieldTag.NO_RELATED_SYM, '1')
                .addField(constants_1.FieldTag.SYMBOL, symbol)
                .addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1')
                .addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3'); // 3 = Index value
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent individual symbol request for: ${symbol}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error(`Error sending individual symbol request for ${symbol}:`, error);
            return null;
        }
    };
    /**
     * Handle a logout message from the server
     */
    const handleLogout = (message) => {
        loggedIn = false;
        // Get any provided text reason for the logout
        const text = message[constants_1.FieldTag.TEXT];
        // Check if this is a sequence number related logout
        if (text && (text.includes('MsgSeqNum') || text.includes('too large') || text.includes('sequence'))) {
            logger_1.default.warn(`Received logout due to sequence number issue: ${text}`);
            // Try to parse the expected sequence number from the message
            const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
            if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
                const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
                if (!isNaN(expectedSeqNum)) {
                    logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
                    // Perform a full disconnect and reconnect with sequence reset
                    if (socket) {
                        logger_1.default.info('Disconnecting due to sequence number error');
                        socket.destroy();
                        socket = null;
                    }
                    // Wait a moment before reconnecting
                    setTimeout(() => {
                        // Reset sequence numbers to what the server expects
                        msgSeqNum = expectedSeqNum;
                        serverSeqNum = expectedSeqNum - 1;
                        logger_1.default.info(`Reconnecting with adjusted sequence numbers: msgSeqNum=${msgSeqNum}, serverSeqNum=${serverSeqNum}`);
                        connect();
                    }, 2000);
                }
                else {
                    // If we can't parse the expected sequence number, do a full reset
                    logger_1.default.info('Cannot parse expected sequence number, performing full reset');
                    if (socket) {
                        socket.destroy();
                        socket = null;
                    }
                    setTimeout(() => {
                        // Reset sequence numbers
                        msgSeqNum = 1;
                        serverSeqNum = 1;
                        logger_1.default.info('Reconnecting with fully reset sequence numbers');
                        connect();
                    }, 2000);
                }
            }
            else {
                // No match found, do a full reset
                logger_1.default.info('No expected sequence number found in message, performing full reset');
                if (socket) {
                    socket.destroy();
                    socket = null;
                }
                setTimeout(() => {
                    // Reset sequence numbers
                    msgSeqNum = 1;
                    serverSeqNum = 1;
                    logger_1.default.info('Reconnecting with fully reset sequence numbers');
                    connect();
                }, 2000);
            }
        }
        else {
            // Emit logout event for normal logouts
            emitter.emit('logout', message);
        }
        // Clear the heartbeat timer as we're logged out
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        logger_1.default.info('Logged out from FIX server');
        logger_1.default.info('[SECURITY_LIST] Main sequence number will be reset on reconnection');
    };
    /**
     * Start the heartbeat monitoring process
     */
    const startHeartbeatMonitoring = () => {
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
                    logger_1.default.warn('No response to test requests, disconnecting');
                    disconnect();
                    return;
                }
                // Send test request
                try {
                    const builder = (0, message_builder_1.createMessageBuilder)();
                    const testReqId = `TEST${Date.now()}`;
                    builder
                        .setMsgType(constants_1.MessageType.TEST_REQUEST)
                        .setSenderCompID(options.senderCompId)
                        .setTargetCompID(options.targetCompId)
                        .setMsgSeqNum(msgSeqNum++);
                    builder.addField(constants_1.FieldTag.TEST_REQ_ID, testReqId);
                    const message = builder.buildMessage();
                    sendMessage(message);
                }
                catch (error) {
                    logger_1.default.error(`Error sending test request: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            else {
                // If we've received activity, just send a regular heartbeat
                sendHeartbeat('');
            }
        }, heartbeatInterval);
    };
    /**
     * Send a market data request
     */
    const sendMarketDataRequest = (symbols, entryTypes = ['0', '1'], // Default: 0 = Bid, 1 = Offer
    subscriptionType = '1' // Default: 1 = Snapshot + Updates
    ) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID('realtime')
                .setTargetCompID('NMDUFISQ0001')
                .setMsgSeqNum(marketDataSeqNum++) // Use marketDataSeqNum
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add PartyID group (required by PSX)
            message
                .addField('453', '1') // NoPartyIDs = 1
                .addField('448', options.partyId || options.senderCompId) // PartyID (use partyId or senderCompId)
                .addField('447', 'D') // PartyIDSource = D (custom)
                .addField('452', '3'); // PartyRole = 3 (instead of 2)
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
            for (const entryType of entryTypes) {
                message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, entryType);
            }
            const rawMessage = message.buildMessage();
            logger_1.default.info(`Sent market data request with ID: ${requestId}`);
            logger_1.default.info(`Market data request message: ${rawMessage}`);
            socket.write(rawMessage);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    /**
     * Send a security list request
     */
    const sendSecurityListRequest = () => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send security list request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum) // Use main sequence number instead of dedicated one
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent security list request with sequence number: ${msgSeqNum}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending security list request:', error);
            return null;
        }
    };
    /**
     * Send a trading session status request for REG market
     */
    const sendTradingSessionStatusRequest = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('Cannot send trading session status request: not connected or not logged in');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.TRADING_SESSION_STATUS_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.TRAD_SES_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.TRADING_SESSION_ID, 'REG'); // Regular trading session
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent trading session status request for REG market (seq: ${msgSeqNum - 1})`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending trading session status request:', error);
            return null;
        }
    };
    /**
     * Send a security list request for REG and FUT markets (EQUITY)
     */
    const sendSecurityListRequestForEquity = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('[SECURITY_LIST] Cannot send equity security list request: not connected or not logged in');
                return null;
            }
            logger_1.default.info(`[SECURITY_LIST] Current equity sequence number before request: ${msgSeqNum}`);
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[SECURITY_LIST] Sending EQUITY security list request with ID: ${requestId}`);
            // Create message in the format used by fn-psx project
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum); // Use main sequence number instead of dedicated one
            // Add required fields in same order as fn-psx
            message.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
            message.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
            message.addField('460', '4'); // Product = EQUITY (4)
            message.addField('336', 'REG'); // TradingSessionID = REG
            const rawMessage = message.buildMessage();
            logger_1.default.info(`[SECURITY_LIST] Raw equity security list request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            if (socket) {
                socket.write(rawMessage);
                // Increment main sequence number after sending
                msgSeqNum++;
                logger_1.default.info(`[SECURITY_LIST] Equity security list request sent successfully. Next equity sequence: ${msgSeqNum}`);
                logger_1.default.info(`[SECURITY_LIST] Main sequence number incremented to ${msgSeqNum} for next message`);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST] Failed to send equity security list request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending equity security list request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    /**
     * Send a security list request for REG market (INDEX)
     */
    const sendSecurityListRequestForIndex = () => {
        try {
            if (!socket || !connected || !loggedIn) {
                logger_1.default.error('[SECURITY_LIST] Cannot send index security list request: not connected or not logged in');
                return null;
            }
            logger_1.default.info(`[SECURITY_LIST] Current main sequence number before request: ${msgSeqNum}`);
            const requestId = (0, uuid_1.v4)();
            logger_1.default.info(`[SECURITY_LIST] Sending INDEX security list request with ID: ${requestId}`);
            // Create message in the format used by fn-psx project
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum); // Use main sequence number instead of dedicated one
            // Add required fields in same order as fn-psx
            message.addField(constants_1.FieldTag.SECURITY_REQ_ID, requestId);
            message.addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0'); // 0 = Symbol
            message.addField('55', 'NA'); // Symbol = NA as used in fn-psx
            message.addField('460', '5'); // Product = INDEX (5)
            message.addField('336', 'REG'); // TradingSessionID = REG
            const rawMessage = message.buildMessage();
            logger_1.default.info(`[SECURITY_LIST] Raw index security list request message: ${rawMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            if (socket) {
                socket.write(rawMessage);
                // Increment main sequence number after sending
                msgSeqNum++;
                logger_1.default.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${msgSeqNum}`);
                logger_1.default.info(`[SECURITY_LIST] Main sequence number incremented to ${msgSeqNum} for next message`);
                // Also start index market data updates
                setTimeout(() => {
                    if (loggedIn) {
                        startIndexUpdates();
                    }
                }, 5000);
                return requestId;
            }
            else {
                logger_1.default.error(`[SECURITY_LIST] Failed to send index security list request - socket not available`);
                return null;
            }
        }
        catch (error) {
            logger_1.default.error(`[SECURITY_LIST] Error sending index security list request: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    /**
     * Send a market data request for index values
     */
    const sendIndexMarketDataRequest = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data request: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0') // 0 = Snapshot
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types (3 = Index Value)
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '1');
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '3');
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent market data request for indices: ${symbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data request:', error);
            return null;
        }
    };
    /**
     * Send a market data subscription request for symbol data
     */
    const sendSymbolMarketDataSubscription = (symbols) => {
        try {
            if (!socket || !connected) {
                logger_1.default.error('Cannot send market data subscription: not connected');
                return null;
            }
            const requestId = (0, uuid_1.v4)();
            const message = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.MARKET_DATA_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++)
                .addField(constants_1.FieldTag.MD_REQ_ID, requestId)
                .addField(constants_1.FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1') // 1 = Snapshot + Updates
                .addField(constants_1.FieldTag.MARKET_DEPTH, '0')
                .addField(constants_1.FieldTag.MD_UPDATE_TYPE, '0');
            // Add symbols
            message.addField(constants_1.FieldTag.NO_RELATED_SYM, symbols.length.toString());
            for (const symbol of symbols) {
                message.addField(constants_1.FieldTag.SYMBOL, symbol);
            }
            // Add entry types
            message.addField(constants_1.FieldTag.NO_MD_ENTRY_TYPES, '3');
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '0'); // Bid
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '1'); // Offer
            message.addField(constants_1.FieldTag.MD_ENTRY_TYPE, '2'); // Trade
            const rawMessage = message.buildMessage();
            socket.write(rawMessage);
            logger_1.default.info(`Sent market data subscription for symbols: ${symbols.join(', ')}`);
            return requestId;
        }
        catch (error) {
            logger_1.default.error('Error sending market data subscription:', error);
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
    const sendLogon = () => {
        logger_1.default.info('Sending logon message...');
        if (!connected) {
            logger_1.default.warn('Cannot send logon, not connected');
            return;
        }
        try {
            // Always reset sequence number on logon
            msgSeqNum = 1; // Start with 1 for the logon message
            serverSeqNum = 1;
            logger_1.default.info('Resetting sequence numbers to 1 for new logon');
            const sendingTime = new Date().toISOString().replace('T', '-').replace('Z', '').substring(0, 23);
            logger_1.default.debug(`Generated SendingTime: ${sendingTime}`);
            // Create logon message following fn-psx format
            // First set header fields
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGON)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum); // Use sequence number 1
            // Then add body fields in the order used by fn-psx
            builder.addField(constants_1.FieldTag.ENCRYPT_METHOD, '0');
            builder.addField(constants_1.FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString());
            builder.addField(constants_1.FieldTag.RESET_SEQ_NUM_FLAG, 'Y'); // Always use Y to reset sequence numbers
            builder.addField(constants_1.FieldTag.USERNAME, options.username);
            builder.addField(constants_1.FieldTag.PASSWORD, options.password);
            builder.addField(constants_1.FieldTag.DEFAULT_APPL_VER_ID, '9');
            builder.addField('1408', 'FIX5.00_PSX_1.00'); // DefaultCstmApplVerID
            const message = builder.buildMessage();
            logger_1.default.info(`Sending Logon Message with sequence number ${msgSeqNum}: ${message.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            sendMessage(message);
            // Now increment sequence number for next message
            msgSeqNum++;
            logger_1.default.info(`Incremented sequence number to ${msgSeqNum} for next message after logon`);
        }
        catch (error) {
            logger_1.default.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Send a logout message to the server
     */
    const sendLogout = (text) => {
        if (!connected) {
            logger_1.default.warn('Cannot send logout, not connected');
            emitter.emit('logout', {
                message: 'Logged out in to FIX server',
                timestamp: new Date().toISOString(),
            });
            return;
        }
        try {
            const builder = (0, message_builder_1.createMessageBuilder)();
            builder
                .setMsgType(constants_1.MessageType.LOGOUT)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum++);
            if (text) {
                builder.addField(constants_1.FieldTag.TEXT, text);
            }
            const message = builder.buildMessage();
            sendMessage(message);
        }
        catch (error) {
            logger_1.default.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle trading status message - specific format for PSX
     */
    const handleTradingStatus = (message) => {
        try {
            const symbol = message[constants_1.FieldTag.SYMBOL];
            const sendingTime = message[constants_1.FieldTag.SENDING_TIME];
            const origTime = message['42']; // OrigTime
            const tradingStatus = message['102']; // Trading Status
            logger_1.default.info(`Received TRADING STATUS for ${symbol}:`);
            logger_1.default.info(`  Status: ${tradingStatus}`);
            logger_1.default.info(`  Time: ${sendingTime} (Orig: ${origTime})`);
            // Check if this is KSE data
            const isKseData = symbol && (symbol.includes('KSE') || message[constants_1.FieldTag.RAW_DATA] === 'kse');
            if (isKseData) {
                // Emit a KSE trading status event
                emitter.emit('kseTradingStatus', {
                    symbol,
                    status: tradingStatus,
                    timestamp: sendingTime,
                    origTime
                });
                // Convert to a market data item format for compatibility
                const marketDataItems = [{
                        symbol: symbol || '',
                        entryType: 'f', // Trading status as entry type
                        price: tradingStatus ? parseFloat(tradingStatus) : undefined,
                        timestamp: sendingTime
                    }];
                // Also emit as KSE data for backward compatibility
                emitter.emit('kseData', marketDataItems);
            }
        }
        catch (error) {
            logger_1.default.error(`Error handling trading status: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /**
     * Handle a reject message from the server
     */
    const handleReject = (message) => {
        try {
            const refSeqNum = message[constants_1.FieldTag.REF_SEQ_NUM];
            const refTagId = message[constants_1.FieldTag.REF_TAG_ID];
            const text = message[constants_1.FieldTag.TEXT];
            const msgType = message[constants_1.FieldTag.MSG_TYPE];
            logger_1.default.error(`Received REJECT message for sequence number ${refSeqNum}`);
            logger_1.default.error(`Reject reason (Tag ${refTagId}): ${text || 'No reason provided'}`);
            // If it's a sequence number issue, reset the connection
            const isSequenceError = refTagId === '34' ||
                text?.includes('MsgSeqNum') ||
                text?.includes('too large') ||
                text?.includes('sequence');
            if (isSequenceError) {
                logger_1.default.info('Sequence number mismatch detected, handling sequence reset...');
                // If text contains specific sequence number information, try to parse it
                const expectedSeqNumMatch = text?.match(/expected ['"]?(\d+)['"]?/);
                if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
                    const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
                    if (!isNaN(expectedSeqNum)) {
                        logger_1.default.info(`Server expects sequence number: ${expectedSeqNum}`);
                        // If the expected sequence is less than our current, we need to reset
                        if (expectedSeqNum < msgSeqNum) {
                            logger_1.default.info(`Our sequence (${msgSeqNum}) is greater than expected (${expectedSeqNum}), resetting connection`);
                            // Perform a full disconnect and reconnect
                            if (socket) {
                                logger_1.default.info('Closing socket and resetting sequence numbers');
                                socket.destroy();
                                socket = null;
                            }
                            // Wait a moment before reconnecting
                            setTimeout(() => {
                                // Reset sequence numbers
                                msgSeqNum = expectedSeqNum;
                                serverSeqNum = expectedSeqNum - 1;
                                logger_1.default.info(`Reconnecting with adjusted sequence numbers: msgSeqNum=${msgSeqNum}, serverSeqNum=${serverSeqNum}`);
                                connect();
                            }, 2000);
                        }
                        else {
                            // If expected sequence is higher, try to continue with corrected sequence
                            logger_1.default.info(`Our sequence (${msgSeqNum}) is less than expected (${expectedSeqNum}), adjusting sequence`);
                            msgSeqNum = expectedSeqNum;
                            logger_1.default.info(`Adjusted sequence number to ${msgSeqNum}`);
                            // Send a heartbeat with the correct sequence number to sync
                            sendHeartbeat('');
                        }
                    }
                }
                else {
                    // If we can't determine the expected sequence, do a full reset
                    logger_1.default.info('Cannot determine expected sequence number, performing full reset');
                    // Perform a full disconnect and reconnect
                    if (socket) {
                        logger_1.default.info('Closing socket and resetting sequence numbers to 1');
                        socket.destroy();
                        socket = null;
                    }
                    // Wait a moment before reconnecting
                    setTimeout(() => {
                        // Reset sequence numbers
                        msgSeqNum = 1;
                        serverSeqNum = 1;
                        logger_1.default.info('Reconnecting with reset sequence numbers = 1');
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
        }
        catch (error) {
            logger_1.default.error(`Error handling reject message: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    // Return the public API
    const client = {
        on: (event, listener) => {
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
        setSequenceNumber: (newSeq) => {
            forceResetSequenceNumber(newSeq);
            return client;
        },
        reset: () => {
            // Disconnect completely
            logger_1.default.info('[RESET] Performing complete reset with disconnection and reconnection');
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
            logger_1.default.info('[RESET] Connection and sequence numbers reset to initial state');
            // Wait a moment and reconnect
            setTimeout(() => {
                logger_1.default.info('[RESET] Reconnecting after reset');
                connect();
            }, 3000);
            return client;
        },
        requestSecurityList: () => {
            logger_1.default.info('[SECURITY_LIST] Starting comprehensive security list request');
            // Keep track of request IDs for logging
            const equityRequestId = (0, uuid_1.v4)();
            // Request equity securities first
            logger_1.default.info(`[SECURITY_LIST] Requesting EQUITY securities with request ID: ${equityRequestId}`);
            // Create message builder with specific settings for equity request
            const equityMessage = (0, message_builder_1.createMessageBuilder)()
                .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                .setSenderCompID(options.senderCompId)
                .setTargetCompID(options.targetCompId)
                .setMsgSeqNum(msgSeqNum)
                .addField(constants_1.FieldTag.SECURITY_REQ_ID, equityRequestId)
                .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
                .addField('55', 'NA') // Symbol = NA as used in fn-psx
                .addField('460', '4') // Product = EQUITY (4)
                .addField('336', 'REG'); // TradingSessionID = REG
            const rawEquityMessage = equityMessage.buildMessage();
            logger_1.default.info(`[SECURITY_LIST] Sending equity security list request message: ${rawEquityMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
            if (socket) {
                socket.write(rawEquityMessage);
                logger_1.default.info(`[SECURITY_LIST] Equity security list request sent successfully. Next equity sequence: ${msgSeqNum}`);
                // Wait for response before requesting index securities
                setTimeout(() => {
                    if (!socket || !connected) {
                        logger_1.default.error('[SECURITY_LIST] Cannot send index security list request - not connected');
                        return;
                    }
                    const indexRequestId = (0, uuid_1.v4)();
                    logger_1.default.info(`[SECURITY_LIST] Requesting INDEX securities with request ID: ${indexRequestId}`);
                    const indexMessage = (0, message_builder_1.createMessageBuilder)()
                        .setMsgType(constants_1.MessageType.SECURITY_LIST_REQUEST)
                        .setSenderCompID(options.senderCompId)
                        .setTargetCompID(options.targetCompId)
                        .setMsgSeqNum(msgSeqNum)
                        .addField(constants_1.FieldTag.SECURITY_REQ_ID, indexRequestId)
                        .addField(constants_1.FieldTag.SECURITY_LIST_REQUEST_TYPE, '0') // 0 = Symbol
                        .addField('55', 'NA') // Symbol = NA as used in fn-psx
                        .addField('460', '5') // Product = INDEX (5)
                        .addField('336', 'REG'); // TradingSessionID = REG
                    const rawIndexMessage = indexMessage.buildMessage();
                    logger_1.default.info(`[SECURITY_LIST] Sending index security list request message: ${rawIndexMessage.replace(new RegExp(constants_1.SOH, 'g'), '|')}`);
                    socket.write(rawIndexMessage);
                    logger_1.default.info(`[SECURITY_LIST] Index security list request sent successfully. Next index sequence: ${msgSeqNum}`);
                }, 5000); // Wait 5 seconds before sending index request
            }
            else {
                logger_1.default.error('[SECURITY_LIST] Failed to send equity security list - socket not available');
            }
            return client;
        }
    };
    return client;
}
