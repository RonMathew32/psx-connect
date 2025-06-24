const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
import { logger } from "./logger";
import { Client } from '@grpc/grpc-js';
import dotenv from 'dotenv';

dotenv.config();

// Define types for the gRPC service
interface BaseMessage {
  timestamp?: Date;
}

interface SymbolData extends BaseMessage {
  entry_date?: string;
  entry_time?: string;
  symbol?: string;
  price?: string;
  quantity?: string;
  net_change?: string;
  change?: string;
  price_delta?: string;
  trade_volume?: string;
  session_status?: string;
}

interface ServerReply extends BaseMessage {
  status?: number;
  message?: string;
}

// Type for gRPC callback
type GRPCCallback<T> = (error: Error | null, response: T) => void;

interface FIXFeedClient {
  FeedHeartbeat(request: BaseMessage, callback: GRPCCallback<ServerReply>): void;
  MarketStatus(request: BaseMessage & { session_id: string, status: string }, callback: GRPCCallback<ServerReply>): void;
  IndexList(request: BaseMessage & { product: string, session_id: string }, callback: GRPCCallback<ServerReply>): void;
  SymbolList(request: BaseMessage & { product: string, session_id: string, symbols: string[] }, callback: GRPCCallback<ServerReply>): void;
  IndexSnapshot(request: BaseMessage & { indexname: string, value: string, volume: string, net_change: string }, callback: GRPCCallback<ServerReply>): void;
  SymbolSnapshot(request: SymbolData, callback: GRPCCallback<ServerReply>): void;
  SymbolUpdate(request: SymbolData, callback: GRPCCallback<ServerReply>): void;
}

class GRPCClient {
  private client: FIXFeedClient;
  private processed: SymbolData[] = [];

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
   logger.info(`Loaded proto: ${Object.keys(proto)}`);
    const FIXFeed = proto.fix.FIXFeed;
    const server = process.env.PKFSERVER || 'pkfinance.info:31039';
    logger.info(`[SERVER] ${server}`);

    try {
      this.client = new FIXFeed(server, grpc.credentials.createInsecure()) as FIXFeedClient;

      // Check connection status
      (this.client as any).getChannel().getConnectivityState(true); // Force a connection attempt
      const state = ((this.client as unknown) as Client).getChannel().getConnectivityState(false);
      
      if (state === grpc.connectivityState.READY) {
        logger.info(`gRPC connection established successfully to ${server}`);
      } else {
        logger.warn(`gRPC connection not ready, current state: ${state} for server ${server}`);
        // Watch for state changes
        ((this.client as unknown) as Client).getChannel().watchConnectivityState(state, Infinity, () => {
          const newState = ((this.client as unknown) as Client).getChannel().getConnectivityState(false);
          if (newState === grpc.connectivityState.READY) {
            logger.info(`gRPC connection established successfully to ${server}`);
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

  private processSymbolData(data: SymbolData): SymbolData {
    // Set date if empty
    if (!data.entry_date?.trim()) {
      data.entry_date = new Date().toISOString().split('T')[0];
    }

    // Process change value
    if (!data.change) {
      if (data.price_delta) {
        data.change = data.price_delta;
      } else if (data.net_change) {
        data.change = data.net_change;
      } else {
        logger.warn(`No change value for ${data.symbol}`);
      }
    }

    // Remove milliseconds from entry_time
    if (data.entry_time) {
      data.entry_time = data.entry_time.split('.')[0];
    }

    return data;
  }

  private async sendSymbolMessage(method: 'SymbolSnapshot' | 'SymbolUpdate', data: SymbolData): Promise<ServerReply> {
    return new Promise((resolve, reject) => {
      data = this.processSymbolData(data);

      // Only process if session is open or empty
      if (!data.session_status || data.session_status === 'open') {
        this.processed.push(data);
        
        this.client[method](data, (err: Error | null, response: ServerReply) => {
          if (err) {
            logger.error(`gRPC Error sending ${method}: ${err.message}`, { data });
            reject(err);
          } else {
            logger.info(`${method} sent successfully`, { data, response });
            resolve(response);
          }
        });
      } else {
        logger.info(`Skipping ${method}, status is ${data.session_status}`);
        resolve({ status: 200, message: 'Skipped due to session status' });
      }
    });
  }

  async sendSymbolSnapshot(data: SymbolData): Promise<ServerReply> {
    return this.sendSymbolMessage('SymbolSnapshot', data);
  }

  async sendSymbolUpdate(data: SymbolData): Promise<ServerReply> {
    return this.sendSymbolMessage('SymbolUpdate', data);
  }

  getProcessedData(): SymbolData[] {
    return this.processed;
  }
}

// Export singleton instance
export const grpcClient = new GRPCClient();

// Export convenience methods
export const sendSymbolSnapshot = (data: SymbolData) => grpcClient.sendSymbolSnapshot(data);
export const sendSymbolUpdate = (data: SymbolData) => grpcClient.sendSymbolUpdate(data);
export const getProcessedData = () => grpcClient.getProcessedData();