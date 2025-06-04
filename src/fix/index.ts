import net from "net";
import { SequenceManager } from "../utils/sequence-manager";
import { logger } from "../utils/logger";
import { EventEmitter } from "events";
import {
  createHeartbeatMessageBuilder,
  createLogonMessageBuilder,
  createLogoutMessageBuilder,
  getMessageTypeByChannelNo
} from "./message-builder";
import { parseFixMessage, ParsedFixMessage } from "./message-parser";
import { SOH, MessageType, FieldTag, MDStreamIDMeanings, MDEntryTypeMeanings } from "../constants/index";
import { Socket } from "net";
import { FixClientOptions } from "../types";
import {
  handleLogon,
  handleLogout,
  handleMarketDataIncremental,
  handleMarketDataSnapshot,
  handleReject,
  handleMarketDataRequestReject,
  handleSecurityList,
  handleNews,
  handleTradingSessionStatus,
  handleTradingStatus,
} from "./message-handler";
import { ConnectionState } from "../utils/connection-state";

// Build a reverse lookup for tag meanings
const tagMeanings: Record<string, string> = {};
for (const [key, value] of Object.entries(FieldTag)) {
  tagMeanings[value] = key;
}


/**
 * Create a FIX client with the specified options
 */
export function createFixClient(options: FixClientOptions): FixClient {
  const emitter = new EventEmitter();
  let socket: net.Socket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let logonTimer: NodeJS.Timeout | null = null;

  const sequenceManager = new SequenceManager();
  const state = new ConnectionState();

  const start = (): void => {
    connect();
  };

  const stop = (): void => {
    state.setShuttingDown(true);
    sendLogout();
    disconnect();
  };

  const connect = async (): Promise<void> => {
    if (socket && state.isConnected()) {
      logger.warn('Already connected');
      return;
    }

    const fixPort = parseInt(process.env.FIX_PORT || '7001', 10);
    const fixHost = process.env.FIX_HOST || '127.0.0.1';

    if (isNaN(fixPort) || !fixHost) {
      logger.error('Invalid FIX_PORT or FIX_HOST environment variable.');
      emitter.emit('error', new Error('Invalid FIX_PORT or FIX_HOST environment variable.'));
      return;
    }

    try {
      logger.info(`Establishing TCP connection to ${fixHost}:${fixPort}`);
      socket = new Socket();
      socket.setKeepAlive(true, 10000);
      socket.setNoDelay(true);
      socket.setTimeout(options.connectTimeoutMs || 60000);
      socket.connect(fixPort, fixHost);

      socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
      });

      socket.on('timeout', () => {
        logger.error('Connection timed out');
        if (socket) {
          socket.destroy();
          socket = null;
        }
        state.setConnected(false);
      });

      socket.on('close', (hadError) => {
        logger.info(`Socket disconnected${hadError ? ' due to error' : ''}`);
        state.reset();

        if (!state.isShuttingDown()) {
          scheduleReconnect();
        }
      });

      socket.on('connect', () => {
        logger.info(`Connected to ${fixHost}:${fixPort}`);
        state.setConnected(true);

        if (logonTimer) {
          clearTimeout(logonTimer);
        }

        logonTimer = setTimeout(() => {
          try {
            logger.info('Sending logon message...');
            sendLogon();
          } catch (error) {
            logger.error(`Error during logon: ${error instanceof Error ? error.message : String(error)}`);
            disconnect();
          }
        }, 500);
      });

      socket.on('data', (data) => {
        logger.info(`[SESSION:DATA] Received data: ${data}`);
        try {
          // const dataStr = data.toString();

          // if (dataStr.includes('35=1')) { // Test request
          //   const testReqIdMatch = dataStr.match(/112=([^\x01]+)/);
          //   if (testReqIdMatch && testReqIdMatch[1]) {
          //     sendHeartbeat(testReqIdMatch[1]);
          //   }
          // }

          handleData(data);
        } catch (err) {
          logger.error(`Error processing data: ${err}`);
        }
      });

    } catch (error) {
      logger.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
      emitter.emit('error', new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  };

  const disconnect = (): Promise<void> => {
    return new Promise((resolve) => {
      clearTimers();
      if (state.isConnected() && state.isLoggedIn()) {
        logger.info("[SESSION:LOGOUT] Sending logout message");
        sendLogout();

        setTimeout(() => {
          if (socket) {
            socket.destroy();
            socket = null;
          }
          resolve();
        }, 500);
      } else {
        if (socket) {
          socket.destroy();
          socket = null;
        }
        resolve();
      }
    });
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    logger.info('Scheduling reconnect in 5 seconds');

    state.setRequestSent('equitySecurities', false);
    state.setRequestSent('indexSecurities', false);
    state.setRequestSent('futSecurities', false);

    reconnectTimer = setTimeout(() => {
      logger.info('Attempting to reconnect');
      connect();
    }, 5000);
  };

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

  const handleData = (data: Buffer): void => {
    try {
      const dataStr = data.toString();
      const messages = dataStr.split(SOH);
      let currentMessage = '';

      for (const segment of messages) {
        if (segment.startsWith('8=FIX')) {
          if (currentMessage) {
            try {
              processMessage(currentMessage);
            } catch (err: any) {
              logger.error(`Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          currentMessage = segment;
        } else if (currentMessage) {
          currentMessage += SOH + segment;
        }
      }

      if (currentMessage) {
        try {
          processMessage(currentMessage);
        } catch (err: any) {
          logger.error(`Failed to process message: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (error: any) {
      logger.error(`Error handling data: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  const processMessage = (message: string): void => {
    try {
      const segments = message.split(SOH);
      const fixVersion = segments.find((s) => s.startsWith('8=FIX'));
      if (!fixVersion) {
        logger.warn('Received non-FIX message');
        return;
      }

      const msgTypeField = segments.find((s) => s.startsWith('35='));
      const msgType = msgTypeField ? msgTypeField.substring(3) : 'UNKNOWN';
      const msgTypeName = Object.entries(MessageType).find(([k, v]) => v === msgType)?.[0] || 'UNKNOWN';

      const channelNoField = segments.find((s) => s.startsWith('10201='));
      const channelNo = channelNoField ? channelNoField.substring(5) : '';
      const channelDesc = getMessageTypeByChannelNo(channelNo);

      // Normalize the channel description to a safe event name (e.g., remove spaces, lowercase)
      const normalizedChannelDesc = channelDesc.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      logger.info(`[FIX] ChannelNo: ${channelNo} (${channelDesc}), MsgType: ${msgType} (${msgTypeName})`);
      logger.info(`[FIX] Normalized channel description: ${normalizedChannelDesc}`);

      const parsedMessage = parseFixMessage(message);

      if (!parsedMessage) {
        logger.warn('Could not parse FIX message');
        return;
      }
      const channelNoStr = channelNo?.replace('=', '');
      if (channelNo && parsedMessage) {
        parsedMessage['channelDescription'] = getMessageTypeByChannelNo(channelNoStr);
      }

      if (parsedMessage[FieldTag.MSG_SEQ_NUM]) {
        const incomingSeqNum = parseInt(parsedMessage[FieldTag.MSG_SEQ_NUM], 10);
        const msgType = parsedMessage[FieldTag.MSG_TYPE];
        const text = parsedMessage[FieldTag.TEXT] || '';
        const isSequenceError = Boolean(
          text.includes('MsgSeqNum') ||
          text.includes('too large') ||
          text.includes('sequence')
        );

        if (
          (msgType === MessageType.LOGOUT || msgType === MessageType.REJECT) &&
          isSequenceError
        ) {
          logger.warn(`Received ${msgType} with sequence error: ${text}`);
        } else {
          sequenceManager.updateServerSequence(incomingSeqNum);
        }
      }

      if (parsedMessage) {
        logger.info('[FIX] Message fields:');
        for (const [tag, value] of Object.entries(parsedMessage)) {
          const meaning = tagMeanings[tag] || '';
          let extra = '';

          // Show extra meaning for MDStreamID (1500)
          if (tag === "1500") {
            extra = MDStreamIDMeanings[value] ? ` (${MDStreamIDMeanings[value]})` : '';
          }
          // Show extra meaning for MD_ENTRY_TYPE (269)
          if (tag === FieldTag.MD_ENTRY_TYPE || tag === "269") {
            extra = MDEntryTypeMeanings[value] ? ` (${MDEntryTypeMeanings[value]})` : '';
          }

          logger.info(`  ${tag}${meaning ? ` (${meaning})` : ''}: ${value}${extra}`);
        }
      }

      // Emit an event for this channel description
      // emitter.emit(normalizedChannelDesc, parsedMessage);

      // Optionally, log or emit a generic event as well
      // emitter.emit('anyChannel', { channelDesc, data: parsedMessage });

      logger.info(`--------------------------------`)

      switch (msgType) {
        case MessageType.LOGON:
          logger.info(`[SESSION:LOGON] Processing logon message from server`);
          handleLogon(parsedMessage, sequenceManager, emitter, { value: false });
          state.setLoggedIn(true);
          break;
        case MessageType.REJECT:
          const rejectResult = handleReject(parsedMessage);
          if (rejectResult.isSequenceError) {
            handleSequenceError(rejectResult.expectedSeqNum);
          } else {
            emitter.emit('reject', {
              reason: rejectResult.rejectReason || ''
            });
          }
          break;
        case MessageType.LOGOUT:
          const logoutResult = handleLogout(
            parsedMessage,
            emitter,
            sequenceManager,
            { value: false },
            socket,
            connect
          );

          if (logoutResult.isSequenceError) {
            handleSequenceError(logoutResult.expectedSeqNum);
          } else {
            state.setLoggedIn(false);
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
          break;
        case MessageType.MARKET_DATA_REQUEST_REJECT:
          handleMarketDataRequestReject(parsedMessage, emitter);
          break;
        case MessageType.NEWS:
          handleNews(parsedMessage, emitter);
          break;
        case MessageType.SECURITY_LIST:
          const securityCache = { EQUITY: [], INDEX: [] };
          handleSecurityList(parsedMessage, emitter, securityCache);
          break;
        case MessageType.TRADING_SESSION_STATUS:
          handleTradingSessionStatus(parsedMessage, emitter);
          break;
        case MessageType.MARKET_DATA_SNAPSHOT_FULL_REFRESH:
          handleMarketDataSnapshot(parsedMessage, emitter);
          break;
        case MessageType.MARKET_DATA_INCREMENTAL_REFRESH:
          handleMarketDataIncremental(parsedMessage, emitter);
          break;
        default:
          emitter.emit('categorizedData', {
            category: 'UNKNOWN',
            type: msgType,
            symbol: parsedMessage[FieldTag.SYMBOL] || '',
            data: parsedMessage,
            timestamp: new Date().toISOString(),
          });
      }
    } catch (error) {
      logger.error(`Error processing message: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSequenceError = (expectedSeqNum?: number): void => {
    if (expectedSeqNum !== undefined) {
      logger.info(`Server expects sequence number: ${expectedSeqNum}`);
      if (socket) {
        socket.destroy();
        socket = null;
      }

      setTimeout(() => {
        sequenceManager.forceReset(expectedSeqNum);
        connect();
      }, 2000);
    } else {
      logger.info('Cannot determine expected sequence number, performing full reset');
      if (socket) {
        socket.destroy();
        socket = null;
      }

      setTimeout(() => {
        sequenceManager.resetAll();
        connect();
      }, 2000);
    }
  };

  const sendLogon = (): void => {
    if (!state.isConnected()) {
      logger.warn('Cannot send logon: not connected');
      return;
    }

    try {
      const builder = createLogonMessageBuilder(options);
      const message = builder.buildMessage();
      logger.info(`[SESSION:LOGON] Sending logon message: ${message}`);
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending logon: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendLogout = (text?: string): void => {
    if (!state.isConnected()) {
      logger.warn("Cannot send logout, not connected");
      emitter.emit("logout", {
        message: "Logged out from FIX server",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const builder = createLogoutMessageBuilder(options, sequenceManager, text);
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending logout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendHeartbeat = (testReqId?: string): void => {
    if (!state.isConnected()) return;

    try {
      const builder = createHeartbeatMessageBuilder(options, sequenceManager, testReqId);
      const message = builder.buildMessage();
      sendMessage(message);
    } catch (error) {
      logger.error(`Error sending heartbeat: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendMessage = (message: string): void => {
    if (!state.isConnected()) {
      logger.warn("Cannot send message, not connected");
      return;
    }

    try {
      socket?.write(message);
    } catch (error) {
      logger.error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`);
      socket?.destroy();
      state.setConnected(false);
    }
  };

  const client = {
    on: (event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener);
      return client;
    },
    connect,
    disconnect,
    sendLogon,
    sendLogout,
    start,
    stop,
  };

  return client;
}

// Type definition for the returned FixClient API
export interface FixClient {
  on(event: "connected", listener: () => void): this;
  on(event: "disconnected", listener: () => void): this;
  on(event: "logon", listener: (message: ParsedFixMessage) => void): this;
  on(event: "logout", listener: (message: ParsedFixMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "message", listener: (message: ParsedFixMessage) => void): this;
  on(
    event: "reject",
    listener: (reject: {
      refSeqNum: string;
      refTagId: string;
      text: string | undefined;
      msgType: string;
    }) => void
  ): this;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendLogon(): void;
  sendLogout(text?: string): void;
  start(): void;
  stop(): void;
}
