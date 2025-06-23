const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

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
    const server = process.env.PKFSERVER || 'pkfinance.info:31039';
    this.client = new FIXFeed(server, grpc.credentials.createInsecure()) as FIXFeedClient;
  }

  async sendTradeMessage(tradeData: TradeData): Promise<GRPCResponse> {
    return new Promise((resolve, reject) => {
      this.client.YourTradeMethod(tradeData, (err: Error | null, response: GRPCResponse) => {
        if (err) {
          console.error('gRPC Error:', err);
          reject(err);
        } else {
          console.log('Trade sent:', response);
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