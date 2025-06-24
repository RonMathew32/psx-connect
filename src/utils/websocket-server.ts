import { WebSocketServer, WebSocket } from 'ws';
import { createFixClient, FixClient } from '../fix';
import { MarketDataItem, TradingSessionInfo, SecurityInfo, WebSocketMessage, FixConfig } from '../types';
import { logger } from './logger';
import { sendTradeMessage } from './grpc-client';
import { MDEntryType, FieldTag } from '../constants';


export function createWebSocketServer(port: number, fixConfig: FixConfig = {
  host: '172.21.101.36',
  port: 8016,
  senderCompId: 'realtime',
  targetCompId: 'NMDUFISQ0001',
  username: 'realtime',
  password: 'NMDUFISQ0001',
  heartbeatIntervalSecs: 30,
  resetOnLogon: true
}) {
  const wss = new WebSocketServer({
    port,
    perMessageDeflate: false,
    clientTracking: true
  });

  const clients = new Set<WebSocket>();
  let fixClient: FixClient | null = null;
  let isFixConnected = false;

  // Simple function to broadcast messages to all connected clients
  const broadcast = (message: WebSocketMessage): void => {
    try {
      const messageStr = JSON.stringify(message);
      logger.debug(`Broadcasting to ${clients.size} clients: ${messageStr}`);

      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else {
          clients.delete(client);
        }
      });
    } catch (error) {
      logger.error(`Broadcast failed: ${error}`);
    }
  };

  // Initialize the FIX client
  const initializeFixClient = (): void => {
    try {
      fixClient = createFixClient(fixConfig);
      setupFixClientListeners();
      fixClient?.start();
      isFixConnected = true;
      // logger.info('FIX client initialized and connected');
      broadcast({ type: 'status', connected: true, timestamp: Date.now() });
    } catch (error) {
      logger.error(`FIX client initialization failed: ${error}`);
      isFixConnected = false;
      broadcast({ type: 'error', message: `FIX client initialization failed: ${error}`, timestamp: Date.now() });
    }
  };

  // Set up event listeners for the FIX client
  const setupFixClientListeners = (): void => {
    if (!fixClient) return;

    fixClient.on('realtime', (data: MarketDataItem[]) => {
      try {
        console.log('[WEBSOCKET] Emitting CHECKING');
        let arr = Array.isArray(data) ? data : [data];
        if (arr.length > 0) {
          logger.info(`[WEBSOCKET] Emitting trade data: ${JSON.stringify(data)}`);
          broadcast({ type: 'realtime', data: arr, timestamp: Date.now() });

          // Send trade data to FIX feed service
          arr.forEach(async (item) => {
            try {
              if (item && item['269']) {
                logger.info(`[WEBSOCKET] Emitting trade data: ${JSON.stringify(item)}`);
              } else {
                logger.info(`[WEBSOCKET] Emitting trade data: ${JSON.stringify(item)}`);
                return;
              }

              // Parse the FIX message fields
              const tradeData = {
                symbol: item['55'] || '',                   // SYMBOL
                price: parseFloat(item['270'] || '0'),     // MD_ENTRY_PX
                quantity: parseFloat(item['387'] || '0'),   // TOTAL_VOLUME_TRADED
                timestamp: item['52'] || new Date().toISOString(), // SENDING_TIME
                entryType: item['269'] || '',              // MD_ENTRY_TYPE
                channelNo: item['1500'] || '',             // Channel number
                channelDescription: item.channelDescription || ''
              };

              logger.info(`[GRPC] Sending trade data for ${tradeData.symbol}: ${JSON.stringify(tradeData)}`);
                await sendTradeMessage(tradeData);
                logger.info(`[GRPC] Trade sent successfully for ${tradeData.symbol}`);

            } catch (error) {
              logger.error(`[GRPC] Failed to send trade: ${error instanceof Error ? error.message : String(error)}`);
            }
          });
        }
      } catch (error) {
        logger.error(`[WEBSOCKET] Error processing market data: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Connection events
    fixClient.on('logon', () => {
      try {
        logger.info(`[WEBSOCKET] Broadcasting logon event`);
        broadcast({ type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() });
      } catch (error) {
        logger.error(`[WEBSOCKET] Error handling logon event: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    fixClient.on('logout', () => {
      broadcast({ type: 'logout', message: 'Logged out from FIX server', timestamp: Date.now() });
    });

    fixClient.on('error', (error: Error) => {
      logger.error(`FIX client error: ${error.message}`);
      isFixConnected = false;
      broadcast({ type: 'error', message: `FIX client error: ${error.message}`, timestamp: Date.now() });
    });

    fixClient.on('disconnected', () => {
      logger.warn('FIX client disconnected');
      isFixConnected = false;
      broadcast({ type: 'status', connected: false, timestamp: Date.now() });
    });
  };

  // Handle WebSocket connections
  wss.on('connection', (ws: WebSocket) => {
    logger.info('New WebSocket client connected');
    clients.add(ws);

    // Send initial connection status
    ws.send(JSON.stringify({
      type: 'status',
      connected: isFixConnected,
      timestamp: Date.now()
    }));

    // Handle client disconnection
    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Start the FIX client
  initializeFixClient();

  logger.info(`WebSocket server started on port ${port}`);

  return {
    close: (): void => {
      clients.forEach((client) => client.close());
      clients.clear();
      wss.close();
      if (fixClient) {
        fixClient.stop();
      }
      logger.info('WebSocket server closed');
    },
    isFixConnected: () => isFixConnected
  };
}

function isTradable(tradeData: any): boolean {
  return (
    tradeData.symbol &&
    typeof tradeData.symbol === 'string' &&
    tradeData.symbol.trim() !== '' &&
    typeof tradeData.price === 'number' &&
    tradeData.price > 0 &&
    typeof tradeData.quantity === 'number' &&
    tradeData.quantity > 0 &&
    // Only allow certain entry types (e.g., '2' for trade, or 'T' for trade)
    (tradeData.entryType === '2' || tradeData.entryType === 'T')
  );
}