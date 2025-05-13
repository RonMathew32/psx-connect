import { WebSocketServer, WebSocket } from 'ws';
import { createFixClient, FixClient } from './fix/fix-client';
import logger from './utils/logger';
import { MarketDataItem, TradingSessionInfo, SecurityInfo } from './types';

interface WebSocketMessage {
  type: 'rawMessage' | 'marketData' | 'tradingSessionStatus' | 'securityList' | 'logon' | 'logout' | 'kseData' | 'error' | 'status' | 'requestAcknowledged' | 'pong';
  data?: MarketDataItem[] | string | TradingSessionInfo | any;
  message?: string;
  timestamp?: number;
  connected?: boolean;
  requestType?: string;
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
      if (message.type === 'tradingSessionStatus') {
        logger.info(`Broadcasting trading session status: ${messageStr}`);
      }

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
      
      // Schedule regular security list updates - fetch every 30 minutes
      // This ensures frontend always has the latest security list data
      const securityListInterval = 30 * 60 * 1000; // 30 minutes
      logger.info(`Setting up automatic security list updates every ${securityListInterval/60000} minutes`);
      
      // Request initially after 10 seconds to ensure connection is stable
      setTimeout(() => {
        if (fixClient && isFixConnected) {
          logger.info('Performing initial security list request after startup');
          fixClient.requestSecurityList();
        }
      }, 10000);
      
      // Then set up recurring requests
      setInterval(() => {
        if (fixClient && isFixConnected) {
          logger.info('Performing scheduled security list request');
          fixClient.requestSecurityList();
        }
      }, securityListInterval);
      
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
      tradingSessionStatus: (data: TradingSessionInfo) => {
        return { type: 'tradingSessionStatus', data, timestamp: Date.now() };
      },
      securityList: (data: SecurityInfo[]) => {
        return { type: 'securityList', data, timestamp: Date.now() };
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
          logger.info(`Broadcasting ${event} event: ${JSON.stringify(message)}`);
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

    // Handle incoming messages from clients
    ws.on('message', (message: string) => {
      try {
        const parsedMessage = JSON.parse(message);
        logger.info(`Received message from client: ${JSON.stringify(parsedMessage)}`);
        
        // Handle different message types
        switch (parsedMessage.type) {
          case 'requestSecurityList':
            // Client is requesting security list data
            logger.info('Client requested security list data');
            if (fixClient && isFixConnected) {
              // Request security list data
              logger.info('Requesting security list data from FIX server');
              fixClient.requestSecurityList();
              
              // Also try individual requests for better reliability
              setTimeout(() => {
                if (fixClient && isFixConnected) {
                  logger.info('Sending direct equity security list request');
                  fixClient.sendSecurityListRequestForEquity();
                  
                  setTimeout(() => {
                    if (fixClient && isFixConnected) {
                      logger.info('Sending direct index security list request');
                      fixClient.sendSecurityListRequestForIndex();
                    }
                  }, 3000);
                }
              }, 1000);
              
              // Acknowledge the request
              ws.send(JSON.stringify({
                type: 'requestAcknowledged',
                message: 'Security list request sent to server',
                requestType: 'securityList',
                timestamp: Date.now()
              }));
            } else {
              // FIX client is not connected
              logger.warn('Cannot request security list data: FIX client not connected');
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Cannot request security list data: FIX server not connected',
                timestamp: Date.now()
              }));
            }
            break;

          case 'ping':
            // Simple ping request
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now()
            }));
            break;

          default:
            logger.warn(`Unhandled message type: ${parsedMessage.type}`);
        }
      } catch (error) {
        logger.error(`Error processing client message: ${error}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: `Server could not process your request: ${error}`,
          timestamp: Date.now()
        }));
      }
    });

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
    },
    requestImmediateSecurityList: (): boolean => {
      if (fixClient && isFixConnected) {
        logger.info('Manually triggered immediate security list request');
        fixClient.requestSecurityList();
        broadcast({
          type: 'requestAcknowledged',
          message: 'Manual security list request initiated',
          requestType: 'securityList',
          timestamp: Date.now()
        });
        return true;
      } else {
        logger.warn('Cannot perform manual security list request - not connected');
        return false;
      }
    }
  };
}