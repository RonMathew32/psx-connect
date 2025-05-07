import { WebSocketServer, WebSocket } from 'ws';
import { createFixClient, FixClient } from './fix/fix-client';
import logger from './utils/logger';
import { MarketDataItem } from './types';

interface WebSocketMessage {
  type: 'rawMessage' | 'marketData' | 'logon' | 'logout' | 'kseData' | 'error' | 'status';
  data?: MarketDataItem[] | string;
  message?: string;
  timestamp?: number;
  connected?: boolean;
}

interface FixConfig {
  host: string;
  port: number;
  senderCompId: string;
  targetCompId: string;
  username: string;
  password: string;
  heartbeatIntervalSecs: number;
  resetOnLogon: boolean;
}

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
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectInterval = 5000;

  const broadcast = (message: WebSocketMessage): void => {
    try {
      if (!message.type) {
        logger.warn('Skipping broadcast: Message missing type');
        return;
      }
      const messageStr = JSON.stringify(message);
      logger.debug(`Broadcasting to ${clients.size} clients: ${messageStr}`);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        } else {
          logger.debug('Removing closed client');
          clients.delete(client);
        }
      });
    } catch (error) {
      logger.error(`Broadcast failed: ${error}`);
      broadcastError(`Broadcast failed: ${error}`);
    }
  };

  const broadcastError = (errorMessage: string): void => {
    broadcast({ type: 'error', message: errorMessage, timestamp: Date.now() });
  };

  const initializeFixClient = (): void => {
    try {
      fixClient = createFixClient(fixConfig);
      setupFixClientListeners();
      fixClient.start();
      isFixConnected = true;
      reconnectAttempts = 0;
      logger.info('FIX client initialized and connected successfully');
      broadcast({ type: 'status', connected: true, timestamp: Date.now() });
    } catch (error) {
      logger.error(`FIX client initialization failed: ${error}`);
      isFixConnected = false;
      broadcastError(`FIX client initialization failed: ${error}`);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = (): void => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached for FIX client');
      broadcastError('Max reconnect attempts reached for FIX client');
      return;
    }

    reconnectAttempts++;
    logger.info(`Scheduling FIX client reconnect attempt ${reconnectAttempts} in ${reconnectInterval}ms`);
    setTimeout(() => {
      if (fixClient) {
        fixClient.stop();
      }
      initializeFixClient();
    }, reconnectInterval);
  };

  const setupFixClientListeners = (): void => {
    if (!fixClient) return;

    const events: Record<string, (data: any) => WebSocketMessage> = {
      rawMessage: (data: string) => {
        return { type: 'rawMessage', data, timestamp: Date.now() };
      },
      marketData: (data: MarketDataItem[]) => {
        return { type: 'marketData', data, timestamp: Date.now() };
      },
      kseData: (data: MarketDataItem[]) => {
        return { type: 'kseData', data, timestamp: Date.now() };
      },
      logon: (data: { message: string; timestamp: number }) => {
        logger.debug(`Transforming logon: ${JSON.stringify(data)}`);
        return { type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() };
      },
      logout: (data: { message: string; timestamp: number }) => {
        logger.debug(`Transforming logout: ${JSON.stringify(data)}`);
        return { type: 'logout', message: 'Logged out from FIX server', timestamp: Date.now() };
      }
    };

    Object.entries(events).forEach(([event, transformer]: any) => {
      fixClient!.on(event, (data: any) => {
        try {
          const message = transformer(data);
          // logger.info(`Broadcasting ${event} event: ${JSON.stringify(message)}`);
          broadcast(message);
        } catch (error) {
          logger.error(`Error processing ${event}: ${error}`);
          broadcastError(`Error processing ${event}: ${error}`);
        }
      });
    });

    fixClient.on('error', (error: Error) => {
      logger.error(`FIX client error: ${error.message}`);
      isFixConnected = false;
      broadcastError(`FIX client error: ${error.message}`);
      scheduleReconnect();
    });

    fixClient.on('disconnected', () => {
      logger.warn('FIX client disconnected');
      isFixConnected = false;
      broadcast({ type: 'status', connected: false, timestamp: Date.now() });
      scheduleReconnect();
    });
  };

  wss.on('connection', (ws: WebSocket) => {
    logger.info('New WebSocket client connected');
    clients.add(ws);

    // Send initial connection status
    ws.send(JSON.stringify({
      type: 'status',
      connected: isFixConnected,
      timestamp: Date.now()
    }));

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket client error: ${error}`);
      clients.delete(ws);
    });
  });

  wss.on('error', (error) => {
    logger.error(`WebSocket server error: ${error}`);
    broadcastError(`WebSocket server error: ${error}`);
  });

  initializeFixClient();

  logger.info(`WebSocket server started on port ${port}`);

  return {
    close: (): void => {
      try {
        clients.forEach((client) => client.close());
        clients.clear();
        wss.close();
        if (fixClient) {
          fixClient.stop();
          fixClient = null;
        }
        logger.info('WebSocket server closed successfully');
      } catch (error) {
        logger.error(`Error closing WebSocket server: ${error}`);
      }
    },
    getClientCount: () => clients.size,
    isFixConnected: () => isFixConnected,
    emitToClients: (message: WebSocketMessage) => {
      broadcast(message);
    }
  };
}