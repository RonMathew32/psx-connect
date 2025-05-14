import { WebSocketServer, WebSocket } from 'ws';
import { createFixClient, FixClient } from './fix/fix-client';
import logger from './utils/logger';
import { MarketDataItem, TradingSessionInfo, SecurityInfo } from './types';

interface WebSocketMessage {
  type: 'marketData' | 'tradingSessionStatus' | 'securityList' | 'logon' | 'logout' | 'kseData' | 'error' | 'status';
  data?: MarketDataItem[] | TradingSessionInfo | SecurityInfo[] | any;
  message?: string;
  timestamp?: number;
  connected?: boolean;
  categorized?: {
    equities: SecurityInfo[];
    indices: SecurityInfo[];
    other: SecurityInfo[];
  };
  count?: number;
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
      fixClient.start();
      isFixConnected = true;
      logger.info('FIX client initialized and connected');
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

    // Market data events
    fixClient.on('marketData', (data: MarketDataItem[]) => {
      try {
        // Ensure we have valid parsed data before broadcasting
        if (Array.isArray(data) && data.length > 0) {
          logger.info(`[WEBSOCKET] Broadcasting market data with ${data.length} entries`);
          broadcast({ type: 'marketData', data, timestamp: Date.now() });
        } else {
          // Handle raw message case
          logger.info(`[WEBSOCKET] Broadcasting raw market data message`);
          broadcast({ type: 'marketData', data, timestamp: Date.now() });
        }
      } catch (error) {
        logger.error(`[WEBSOCKET] Error processing market data: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Trading session status events
    fixClient.on('tradingSessionStatus', (data: TradingSessionInfo) => {
      try {
        // Validate and process data before broadcasting
        if (data && data.sessionId) {
          logger.info(`[WEBSOCKET] Broadcasting trading session status: ${JSON.stringify(data)}`);
          broadcast({ type: 'tradingSessionStatus', data, timestamp: Date.now() });
        } else {
          logger.warn(`[WEBSOCKET] Received invalid trading session data: ${JSON.stringify(data)}`);
        }
      } catch (error) {
        logger.error(`[WEBSOCKET] Error processing trading session status: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Security list events
    fixClient.on('securityList', (data: SecurityInfo[]) => {
      try {
        // Validate and process security list before broadcasting
        if (Array.isArray(data)) {
          logger.info(`[WEBSOCKET] Broadcasting security list with ${data.length} symbols`);
          
          // Categorize securities for better frontend handling
          const categorizedData = {
            equities: data.filter(s => s.securityType === 'CS' || s.securityType === '4'),
            indices: data.filter(s => s.securityType === 'MLEG' || s.securityType === '5'),
            other: data.filter(s => s.securityType !== 'CS' && s.securityType !== '4' && 
                                   s.securityType !== 'MLEG' && s.securityType !== '5')
          };
          
          broadcast({ 
            type: 'securityList', 
            data: data,
            categorized: categorizedData,
            count: data.length,
            timestamp: Date.now() 
          });
        } else {
          logger.warn(`[WEBSOCKET] Received invalid security list data`);
          broadcast({ type: 'securityList', data: [], count: 0, timestamp: Date.now() });
        }
      } catch (error) {
        logger.error(`[WEBSOCKET] Error processing security list: ${error instanceof Error ? error.message : String(error)}`);
        broadcast({ type: 'securityList', data: [], count: 0, timestamp: Date.now() });
      }
    });

    // KSE data events
    fixClient.on('kseData', (data: MarketDataItem[]) => {
      try {
        // Validate and process KSE data before broadcasting
        if (Array.isArray(data) && data.length > 0) {
          logger.info(`[WEBSOCKET] Broadcasting KSE data for ${data[0].symbol}`);
          broadcast({ type: 'kseData', data, timestamp: Date.now() });
        } else {
          logger.warn(`[WEBSOCKET] Received empty KSE data`);
        }
      } catch (error) {
        logger.error(`[WEBSOCKET] Error processing KSE data: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Connection events
    fixClient.on('logon', () => {
      try {
        logger.info(`[WEBSOCKET] Broadcasting logon event`);
        broadcast({ type: 'logon', message: 'Logged in to FIX server', timestamp: Date.now() });
        
        // After successful login, wait for the security list timer to kick in
        // The FIX client will automatically start sending security list requests
        // with the correct sequence number
        logger.info(`[WEBSOCKET] FIX client logged in, automatic security list requests will start shortly`);
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