import net from 'net';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import { createMessageBuilder } from './message-builder';
import { parseFixMessage, ParsedFixMessage } from './message-parser';
import { SOH, MessageType, FieldTag } from './constants';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { FixClientOptions, MarketDataItem, SecurityInfo, TradingSessionInfo } from '../types';

// Interface for client state
interface ClientState {
  socket: Socket | null;
  connected: boolean;
  loggedIn: boolean;
  msgSeqNum: number;
  serverSeqNum: number;
  lastActivityTime: number;
  testRequestCount: number;
  receivedData: string;
  heartbeatTimer: NodeJS.Timeout | null;
  reconnectTimer: NodeJS.Timeout | null;
  logonTimer: NodeJS.Timeout | null;
}

/** 
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions): FixClient {
  const emitter = new EventEmitter();
  const messageBuilder = createMessageBuilder();
  
  // Centralized state management
  const state: ClientState = {
    socket: null,
    connected: false,
    loggedIn: false,
    msgSeqNum: 1,
    serverSeqNum: 1,
    lastActivityTime: 0,
    testRequestCount: 0,
    receivedData: '',
    heartbeatTimer: null,
    reconnectTimer: null,
    logonTimer: null,
  };

  /**
   * Reset sequence numbers
   */
  const resetSequenceNumber = (newSeq: number = 2): void => {
    const oldSeq = state.msgSeqNum;
    state.msgSeqNum = newSeq;
    state.serverSeqNum = newSeq - 1;
    logger.info(`[SEQUENCE] Reset from ${oldSeq} to ${state.msgSeqNum} (server: ${state.serverSeqNum})`);
  };

  /**
   * Clear all timers
   */
  const clearTimers = (): void => {
    [state.heartbeatTimer, state.reconnectTimer, state.logonTimer].forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    state.heartbeatTimer = state.reconnectTimer = state.logonTimer = null;
  };

  /**
   * Send a FIX message
   */
  const sendMessage = (message: string): void => {
    if (!state.socket || !state.connected) {
      logger.warn('Cannot send message: not connected');
      return;
    }
    try {
      logger.debug(`Sending FIX message (seq: ${state.msgSeqNum}): ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      state.socket.write(message);
      state.lastActivityTime = Date.now();
    } catch (error) {
      logger.error(`Send error: ${error}`);
      disconnect();
    }
  };

  /**
   * Connect to the FIX server
   */
  const connect = async (): Promise<void> => {
    if (state.connected && state.socket) {
      logger.warn('Already connected');
      return;
    }

    try {
      state.socket = new Socket()
        .setKeepAlive(true)
        .setNoDelay(true)
        .setTimeout(options.connectTimeoutMs || 30000);

      state.socket.on('connect', () => {
        state.connected = true;
        logger.info(`Connected to ${options.host}:${options.port}`);
        clearTimers();
        state.logonTimer = setTimeout(() => sendLogon(), 500);
        emitter.emit('connected');
      });

      state.socket.on('data', (data) => handleData(data.toString()));
      state.socket.on('timeout', () => {
        logger.error('Connection timed out');
        disconnect();
        emitter.emit('error', new Error('Connection timed out'));
      });
      state.socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
        emitter.emit('error', error);
      });
      state.socket.on('close', () => {
        logger.info('Socket disconnected');
        state.connected = false;
        emitter.emit('disconnected');
        scheduleReconnect();
      });

      logger.info(`Connecting to ${options.host}:${options.port}...`);
      state.socket.connect(options.port, options.host);
    } catch (error) {
      logger.error(`Connection error: ${error}`);
      emitter.emit('error', new Error(`Connection failed: ${error}`));
    }
  };

  /**
   * Disconnect from the server
   */
  const disconnect = async (): Promise<void> => {
    clearTimers();
    if (state.connected && state.loggedIn) sendLogout();
    if (state.socket) {
      state.socket.destroy();
      state.socket = null;
    }
    state.connected = false;
    state.loggedIn = false;
  };

  /**
   * Schedule reconnection
   */
  const scheduleReconnect = (): void => {
    clearTimers();
    state.reconnectTimer = setTimeout(() => {
      logger.info('Reconnecting...');
      connect();
    }, 5000);
  };

  /**
   * Handle incoming data
   */
  const handleData = (data: string): void => {
    try {
      state.lastActivityTime = Date.now();
      state.receivedData += data;
      
      const messages = state.receivedData.split(SOH).reduce((acc: string[], segment) => {
        if (segment.startsWith('8=FIX')) acc.push(segment);
        else if (acc.length) acc[acc.length - 1] += SOH + segment;
        return acc;
      }, []);

      state.receivedData = messages.pop() || '';
      messages.forEach(processMessage);
    } catch (error) {
      logger.error(`Data handling error: ${error}`);
    }
  };

  /**
   * Dispatch incoming FIX messages to the appropriate handler
   */
  const dispatchMessage = (parsed: ParsedFixMessage): void => {
    const msgType = parsed[FieldTag.MSG_TYPE];
    switch (msgType) {
      case MessageType.LOGON:
        handleLogon(parsed);
        break;
      case MessageType.LOGOUT:
        handleLogout(parsed);
        break;
      case MessageType.HEARTBEAT:
        state.testRequestCount = 0;
        break;
      case MessageType.TEST_REQUEST:
        sendHeartbeat(parsed[FieldTag.TEST_REQ_ID]);
        break;
      case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
        handleMarketDataSnapshot(parsed);
        break;
      case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
        handleMarketDataIncremental(parsed);
        break;
      case MessageType.SECURITY_LIST:
        handleSecurityList(parsed);
        break;
      case MessageType.TRADING_SESSION_STATUS:
        handleTradingSessionStatus(parsed);
        break;
      case 'f':
        handleTradingStatus(parsed);
        break;
      case MessageType.REJECT:
        handleReject(parsed);
        break;
      case 'Y':
        handleMarketDataRequestReject(parsed);
        break;
      default:
        logger.info(`Unhandled message type: ${msgType}`);
    }
  };

  /**
   * Process a FIX message
   */
  const processMessage = (message: string): void => {
    try {
      if (!message.startsWith('8=FIX')) {
        logger.warn('Non-FIX message received');
        return;
      }

      logger.info(`Received: ${message.replace(new RegExp(SOH, 'g'), '|')}`);
      const parsed = parseFixMessage(message);
      if (!parsed) {
        logger.warn('Failed to parse FIX message');
        return;
      }

      // Update sequence numbers
      if (parsed[FieldTag.MSG_SEQ_NUM]) {
        const seqNum = parseInt(parsed[FieldTag.MSG_SEQ_NUM], 10);
        if (!parsed[FieldTag.POSS_DUP_FLAG] || parsed[FieldTag.POSS_DUP_FLAG] !== 'Y') {
          state.serverSeqNum = seqNum;
          state.msgSeqNum = Math.max(state.msgSeqNum, seqNum + 1);
        }
      }

      // Dispatch the message to the appropriate handler
      dispatchMessage(parsed);
    } catch (error) {
      logger.error(`Message processing error: ${error}`);
    }
  };

  /**
   * Handle logon response
   */
  const handleLogon = (message: ParsedFixMessage): void => {
    state.loggedIn = true;
    state.serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || '1', 10);
    state.msgSeqNum = message[FieldTag.RESET_SEQ_NUM_FLAG] === 'Y' ? 2 : state.serverSeqNum + 1;

    logger.info(`Logged in. Server seq: ${state.serverSeqNum}, Next seq: ${state.msgSeqNum}`);
    startHeartbeatMonitoring();
    emitter.emit('logon', message);
  };

  /**
   * Handle logout
   */
  const handleLogout = (message: ParsedFixMessage): void => {
    const text = message[FieldTag.TEXT];
    state.loggedIn = false;
    clearTimers();

    if (text?.match(/MsgSeqNum|too large|sequence/)) {
      const seqMatch = text.match(/expected ['"]?(\d+)['"]?/);
      const newSeq = seqMatch && !isNaN(parseInt(seqMatch[1], 10)) ? parseInt(seqMatch[1], 10) : 1;
      
      disconnect().then(() => {
        setTimeout(() => {
          resetSequenceNumber(newSeq);
          connect();
        }, 2000);
      });
    } else {
      emitter.emit('logout', message);
    }
    logger.info('Logged out');
  };

  /**
   * Handle market data snapshot
   */
  const handleMarketDataSnapshot = (message: ParsedFixMessage): void => {
    const mdReqId = message[FieldTag.MD_REQ_ID];
    const symbol = message[FieldTag.SYMBOL];
    const items: MarketDataItem[] = [];

    const noEntries = parseInt(message[FieldTag.NO_MD_ENTRY_TYPES] || '0', 10);
    for (let i = 0; i < noEntries; i++) {
      const entryType = message[`${FieldTag.MD_ENTRY_TYPE}.${i}`] || message[FieldTag.MD_ENTRY_TYPE];
      if (!entryType) break;
      
      items.push({
        symbol: symbol || '',
        entryType,
        price: parseFloat(message[`${FieldTag.MD_ENTRY_PX}.${i}`] || message[FieldTag.MD_ENTRY_PX] || '0'),
        size: parseFloat(message[`${FieldTag.MD_ENTRY_SIZE}.${i}`] || message[FieldTag.MD_ENTRY_SIZE] || '0'),
        timestamp: message[FieldTag.SENDING_TIME],
      });
    }

    logger.info(`Market data snapshot for ${symbol}: ${items.length} items`);
    emitter.emit('marketData', message);
    
    if (items.length && (symbol?.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse')) {
      logger.info(`KSE data for ${symbol}`);
      emitter.emit('kseData', items);
    }
  };

  /**
   * Handle market data incremental refresh
   */
  const handleMarketDataIncremental = (message: ParsedFixMessage): void => {
    const mdReqId = message[FieldTag.MD_REQ_ID];
    logger.info(`Incremental refresh for ${mdReqId}`);
    emitter.emit('marketData', message);
  };

  /**
   * Handle security list
   */
  const handleSecurityList = (message: ParsedFixMessage): void => {
    const securities: SecurityInfo[] = [];
    const noSecurities = parseInt(message[FieldTag.NO_RELATED_SYM] || '0', 10);

    // Standard format parsing
    for (let i = 0; i < Math.max(noSecurities, 100); i++) {
      const symbol = message[`${FieldTag.SYMBOL}.${i}`] || (i === 0 ? message[FieldTag.SYMBOL] : null);
      if (!symbol) break;

      securities.push({
        symbol,
        securityType: message[`${FieldTag.SECURITY_TYPE}.${i}`] || message[FieldTag.SECURITY_TYPE] || '',
        securityDesc: message[`${FieldTag.SECURITY_DESC}.${i}`] || message[FieldTag.SECURITY_DESC] || '',
        marketId: message[`${FieldTag.MARKET_ID}.${i}`] || message[FieldTag.MARKET_ID] || '',
      });
    }

    // Alternative parsing if standard fails
    if (!securities.length) {
      Object.entries(message).forEach(([key, value]) => {
        if (key.match(/55\.?|symbol/i) && typeof value === 'string') {
          securities.push({
            symbol: value,
            securityType: message[key.replace('55', '167')] || '',
            securityDesc: message[key.replace('55', '107')] || '',
            marketId: message[key.replace('55', '1301')] || '',
          });
        }
      });
    }

    const uniqueSecurities = [...new Map(securities.map(s => [s.symbol, s])).values()];
    logger.info(`Extracted ${uniqueSecurities.length} securities`);
    emitter.emit('securityList', uniqueSecurities);

    if (!uniqueSecurities.length && message['893'] !== 'N') {
      setTimeout(() => state.loggedIn && sendSecurityListRequest(), 5000);
    }
  };

  /**
   * Handle trading session status
   */
  const handleTradingSessionStatus = (message: ParsedFixMessage): void => {
    let sessionId = message[FieldTag.TRADING_SESSION_ID] || message['1151'] || message['1300'] || 'REG';
    let status = message[FieldTag.TRAD_SES_STATUS] || message['325'] || '2';

    if (sessionId === '05') {
      status = message['102'] || '2'; // PSX-specific mapping
      sessionId = 'REG';
    }

    const sessionInfo: TradingSessionInfo = {
      sessionId,
      status,
      startTime: message[FieldTag.START_TIME] || message['341'],
      endTime: message[FieldTag.END_TIME] || message['342'],
    };

    logger.info(`Trading session status: ${JSON.stringify(sessionInfo)}`);
    emitter.emit('tradingSessionStatus', sessionInfo);
  };

  /**
   * Handle trading status (PSX-specific)
   */
  const handleTradingStatus = (message: ParsedFixMessage): void => {
    const symbol = message[FieldTag.SYMBOL];
    const status = message['102'];
    const items: MarketDataItem[] = [{
      symbol: symbol || '',
      entryType: 'f',
      price: status ? parseFloat(status) : undefined,
      timestamp: message[FieldTag.SENDING_TIME],
    }];

    emitter.emit('kseTradingStatus', {
      symbol,
      status,
      timestamp: message[FieldTag.SENDING_TIME],
      origTime: message['42'],
    });

    if (symbol?.includes('KSE') || message[FieldTag.RAW_DATA] === 'kse') {
      emitter.emit('kseData', items);
    }
  };

  /**
   * Handle reject message
   */
  const handleReject = (message: ParsedFixMessage): void => {
    const text = message[FieldTag.TEXT];
    if (text?.match(/MsgSeqNum|too large|sequence/)) {
      const seqMatch = text.match(/expected ['"]?(\d+)['"]?/);
      const newSeq = seqMatch && !isNaN(parseInt(seqMatch[1], 10)) ? parseInt(seqMatch[1], 10) : 1;

      disconnect().then(() => {
        setTimeout(() => {
          resetSequenceNumber(newSeq);
          connect();
        }, 2000);
      });
    }
    emitter.emit('reject', {
      refSeqNum: message[FieldTag.REF_SEQ_NUM],
      refTagId: message[FieldTag.REF_TAG_ID],
      text,
      msgType: message[FieldTag.MSG_TYPE],
    });
  };

  /**
   * Handle market data request reject
   */
  const handleMarketDataRequestReject = (message: ParsedFixMessage): void => {
    emitter.emit('marketDataReject', {
      requestId: message[FieldTag.MD_REQ_ID],
      reason: message[FieldTag.MD_REJECT_REASON],
      text: message[FieldTag.TEXT],
    });
  };

  /**
   * Send heartbeat
   */
  const sendHeartbeat = (testReqId?: string): void => {
    if (!state.connected) return;
    
    const builder = messageBuilder
      .setMsgType(MessageType.HEARTBEAT)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++);
    
    if (testReqId) builder.addField(FieldTag.TEST_REQ_ID, testReqId);
    
    sendMessage(builder.buildMessage());
  };

  /**
   * Start heartbeat monitoring
   */
  const startHeartbeatMonitoring = (): void => {
    clearTimers();
    const interval = options.heartbeatIntervalSecs * 1000;
    state.heartbeatTimer = setInterval(() => {
      if (Date.now() - state.lastActivityTime > interval * 2) {
        if (state.testRequestCount++ > 3) {
          logger.warn('No test request response, disconnecting');
          disconnect();
          return;
        }
        const builder = messageBuilder
          .setMsgType(MessageType.TEST_REQUEST)
          .setSenderCompID(options.senderCompId)
          .setTargetCompID(options.targetCompId)
          .setMsgSeqNum(state.msgSeqNum++)
          .addField(FieldTag.TEST_REQ_ID, `TEST${Date.now()}`);
        sendMessage(builder.buildMessage());
      } else {
        sendHeartbeat();
      }
    }, interval);
  };

  /**
   * Send logon
   */
  const sendLogon = (): void => {
    if (!state.connected) return;
    
    resetSequenceNumber(1);
    const builder = messageBuilder
      .setMsgType(MessageType.LOGON)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++)
      .addField(FieldTag.ENCRYPT_METHOD, '0')
      .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
      .addField(FieldTag.RESET_SEQ_NUM_FLAG, 'Y')
      .addField(FieldTag.USERNAME, options.username)
      .addField(FieldTag.PASSWORD, options.password)
      .addField(FieldTag.DEFAULT_APPL_VER_ID, '9')
      .addField('1408', 'FIX5.00_PSX_1.00');

    sendMessage(builder.buildMessage());
  };

  /**
   * Send logout
   */
  const sendLogout = (text?: string): void => {
    if (!state.connected) {
      emitter.emit('logout', { message: 'Logged out', timestamp: new Date().toISOString() });
      return;
    }
    
    const builder = messageBuilder
      .setMsgType(MessageType.LOGOUT)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++);
    
    if (text) builder.addField(FieldTag.TEXT, text);
    
    sendMessage(builder.buildMessage());
  };

  /**
   * Send market data request
   */
  const sendMarketDataRequest = (
    symbols: string[],
    entryTypes: string[] = ['0', '1'],
    subscriptionType: string = '1'
  ): string | null => {
    if (!state.connected) return null;
    
    const requestId = uuidv4();
    const builder = messageBuilder
      .setMsgType(MessageType.MARKET_DATA_REQUEST)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++)
      .addField(FieldTag.MD_REQ_ID, requestId)
      .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
      .addField(FieldTag.MARKET_DEPTH, '0')
      .addField(FieldTag.MD_UPDATE_TYPE, '0')
      .addField('453', '1')
      .addField('448', options.partyId || options.senderCompId)
      .addField('447', 'D')
      .addField('452', '3')
      .addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());

    symbols.forEach(symbol => builder.addField(FieldTag.SYMBOL, symbol));
    builder.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
    entryTypes.forEach(type => builder.addField(FieldTag.MD_ENTRY_TYPE, type));

    sendMessage(builder.buildMessage());
    return requestId;
  };

  /**
   * Send security list request
   */
  const sendSecurityListRequest = (product?: string, sessionId: string = 'REG'): string | null => {
    if (!state.connected || !state.loggedIn) return null;
    
    resetSequenceNumber(2);
    const requestId = uuidv4();
    const builder = messageBuilder
      .setMsgType(MessageType.SECURITY_LIST_REQUEST)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++)
      .addField(FieldTag.SECURITY_REQ_ID, requestId)
      .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '0')
      .addField('55', 'NA')
      .addField('336', sessionId);

    if (product) builder.addField('460', product);

    sendMessage(builder.buildMessage());
    return requestId;
  };

  /**
   * Send trading session status request
   */
  const sendTradingSessionStatusRequest = (): string | null => {
    if (!state.connected || !state.loggedIn) return null;
    
    const requestId = uuidv4();
    const builder = messageBuilder
      .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++)
      .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
      .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0')
      .addField(FieldTag.TRADING_SESSION_ID, 'REG');

    sendMessage(builder.buildMessage());
    return requestId;
  };

  /**
   * Send security status request
   */
  const sendSecurityStatusRequest = (symbol: string): string | null => {
    if (!state.connected) return null;
    
    const requestId = uuidv4();
    const builder = messageBuilder
      .setMsgType('e')
      .setSenderCompID(options.senderCompId)
      .setTargetCompID(options.targetCompId)
      .setMsgSeqNum(state.msgSeqNum++)
      .addField(FieldTag.SECURITY_STATUS_REQ_ID, requestId)
      .addField(FieldTag.SYMBOL, symbol)
      .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0');

    sendMessage(builder.buildMessage());
    return requestId;
  };

  /**
   * Send index market data request
   */
  const sendIndexMarketDataRequest = (symbols: string[]): string | null => {
    return sendMarketDataRequest(symbols, ['3'], '0');
  };

  /**
   * Send symbol market data subscription
   */
  const sendSymbolMarketDataSubscription = (symbols: string[]): string | null => {
    return sendMarketDataRequest(symbols, ['0', '1', '2'], '1');
  };

  /**
   * Client API
   */
  const client: FixClient = {
    on: (event, listener) => { emitter.on(event, listener); return client; },
    connect,
    disconnect,
    sendMarketDataRequest,
    sendSecurityListRequest: () => sendSecurityListRequest(),
    sendTradingSessionStatusRequest,
    sendSecurityListRequestForEquity: () => sendSecurityListRequest('4'),
    sendSecurityListRequestForIndex: () => {
      const id = sendSecurityListRequest('5');
      if (id) setTimeout(() => state.loggedIn && sendIndexMarketDataRequest(['KSE100', 'KMI30']), 5000);
      return id;
    },
    sendIndexMarketDataRequest,
    sendSymbolMarketDataSubscription,
    sendSecurityStatusRequest,
    sendLogon,
    sendLogout,
    start: connect,
    stop: disconnect,
    setSequenceNumber: (seq) => { resetSequenceNumber(seq); return client; },
    reset: () => {
      disconnect().then(() => {
        resetSequenceNumber(1);
        setTimeout(connect, 3000);
      });
      return client;
    },
    requestSecurityList: () => {
      resetSequenceNumber(2);
      const equityId = sendSecurityListRequest('4');
      if (equityId) {
        setTimeout(() => {
          resetSequenceNumber(2);
          sendSecurityListRequest('5');
          setTimeout(() => {
            state.loggedIn && (sendSecurityListRequest('4') || sendSecurityListRequest('5'));
          }, 10000);
        }, 5000);
      }
      return client;
    },
  };

  return client;
}

// Type definition for the FixClient
export interface FixClient {
  on(event: 'connected' | 'disconnected' | 'error', listener: (error: Error) => void): this;
  on(event: 'logon' | 'logout' | 'message', listener: (message: ParsedFixMessage) => void): this;
  on(event: 'marketData', listener: (data: any) => void): this;
  on(event: 'securityList', listener: (securities: SecurityInfo[]) => void): this;
  on(event: 'tradingSessionStatus', listener: (sessionInfo: TradingSessionInfo) => void): this;
  on(event: 'kseData', listener: (data: MarketDataItem[]) => void): this;
  on(event: 'kseTradingStatus', listener: (status: { symbol: string; status: string; timestamp: string; origTime?: string }) => void): this;
  on(event: 'marketDataReject', listener: (reject: { requestId: string; reason: string; text?: string }) => void): this;
  on(event: 'reject', listener: (reject: { refSeqNum: string; refTagId: string; text: string; msgType: string }) => void): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMarketDataRequest(symbols: string[], entryTypes?: string[], subscriptionType?: string): string | null;
  sendSecurityListRequest(): string | null;
  sendTradingSessionStatusRequest(): string | null;
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