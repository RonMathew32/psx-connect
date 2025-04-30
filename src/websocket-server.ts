import { WebSocketServer, WebSocket } from 'ws';
import { createFixClient, FixClient } from './fix/fix-client';
import logger from './utils/logger';

export function createWebSocketServer(port: number) {
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();
  let fixClient: FixClient | null = null;

  // Initialize FIX client
  const initFixClient = () => {
    fixClient = createFixClient({
      host: '172.21.101.36',
      port: 8016,
      senderCompId: 'realtime',
      targetCompId: 'NMDUFISQ0001',
      username: 'realtime',
      password: 'NMDUFISQ0001',
      heartbeatIntervalSecs: 30,
      resetOnLogon: true
    });

    // Handle market data events
    fixClient?.on('marketData', (data) => {
      // Broadcast to all connected clients
      broadcastToClients({
        type: 'marketData',
        data
      });
    });

    // Handle KSE data events
    fixClient?.on('kseData', (data) => {
      // Broadcast to all connected clients
      broadcastToClients({
        type: 'kseData',
        data
      });
    });

    // Start the FIX client
    fixClient?.start();
  };

  // Broadcast data to all connected clients
  const broadcastToClients = (data: any) => {
    const message = JSON.stringify(data);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  wss.on('connection', (ws) => {
    logger.info('New WebSocket client connected');
    clients.add(ws);

    // Send initial data if available
    if (fixClient) {
      // You can send any initial data here
    }

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error}`);
    });
  });

  // Initialize FIX client when server starts
  initFixClient();

  logger.info(`WebSocket server started on port ${port}`);

  return {
    close: () => {
      wss.close();
      if (fixClient) {
        fixClient.stop();
      }
    }
  };
} 