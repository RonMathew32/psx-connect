const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
import { logger } from "./logger";
import { Client } from '@grpc/grpc-js';
import dotenv from 'dotenv';

dotenv.config();

// Define types for the gRPC service
interface TradeData {
  symbol?: string;
  price?: number;
  quantity?: number;
  timestamp?: string;
  [key: string]: any;
}

interface GRPCResponse {
  success?: boolean;
  message?: string;
  [key: string]: any;
}

interface FIXFeedClient {
  YourTradeMethod(request: TradeData, callback: (error: Error | null, response: GRPCResponse) => void): void;
}

class GRPCClient {
  private client: FIXFeedClient;

  constructor() {
    const PROTO_PATH = path.resolve(__dirname, '../../proto/fixfeed.proto');
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const FIXFeed = proto.fix.FIXFeed;
    logger.info(`[SERVER] ${process.env.PKFSERVER}`);
    const server = process.env.PKFSERVER || 'pkfinance.info:31039';

    try {
      this.client = new FIXFeed(server, grpc.credentials.createInsecure()) as FIXFeedClient;

      // Check connection status
      (this.client as any).getChannel().getConnectivityState(true); // Force a connection attempt
      const state = ((this.client as unknown) as Client).getChannel().getConnectivityState(false);
      
      if (state === grpc.connectivityState.READY) {
        logger.info(`gRPC connection established successfully to ${process.env.PKFSERVER}`);
      } else {
        logger.warn(`gRPC connection not ready, current state: ${state} for server ${server}`);
        // Watch for state changes
        (this.client as any).getChannel().watchConnectivityState(state, Infinity, () => {
          const newState = (this.client as any).getChannel().getConnectivityState(false);
          if (newState === grpc.connectivityState.READY) {
            logger.info(`gRPC connection established successfully to ${process.env.PKFSERVER}`);
          } else {
            logger.error(`gRPC connection failed, current state: ${newState} for server ${server}`);
          }
        });
      }
    } catch (error: any) {
      logger.error(`Failed to initialize gRPC client for ${server}: ${error.message}`);
      throw error;
    }
  }

  async sendTradeMessage(tradeData: TradeData): Promise<GRPCResponse> {
    return new Promise((resolve, reject) => {
      this.client.YourTradeMethod(tradeData, (err: Error | null, response: GRPCResponse) => {
        if (err) {
          logger.error(`gRPC Error sending trade message: ${err.message}`, { tradeData });
          reject(err);
        } else {
          logger.info('Trade sent successfully', { tradeData, response });
          resolve(response);
        }
      });
    });
  }
}

// Export singleton instance
export const grpcClient = new GRPCClient();

// Export the sendTradeMessage function for convenience
export const sendTradeMessage = (tradeData: TradeData) => grpcClient.sendTradeMessage(tradeData);