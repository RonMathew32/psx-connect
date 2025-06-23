"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTradeMessage = exports.grpcClient = void 0;
const grpc_js_1 = __importDefault(require("@grpc/grpc-js"));
const proto_loader_1 = __importDefault(require("@grpc/proto-loader"));
const path_1 = __importDefault(require("path"));
class GRPCClient {
    constructor() {
        const PROTO_PATH = path_1.default.resolve(__dirname, '../../proto/fixfeed.proto');
        const packageDef = proto_loader_1.default.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const proto = grpc_js_1.default.loadPackageDefinition(packageDef);
        const FIXFeed = proto.fix.FIXFeed;
        const server = process.env.PKFSERVER || 'pkfinance.info:31039';
        this.client = new FIXFeed(server, grpc_js_1.default.credentials.createInsecure());
    }
    async sendTradeMessage(tradeData) {
        return new Promise((resolve, reject) => {
            this.client.YourTradeMethod(tradeData, (err, response) => {
                if (err) {
                    console.error('gRPC Error:', err);
                    reject(err);
                }
                else {
                    console.log('Trade sent:', response);
                    resolve(response);
                }
            });
        });
    }
}
// Export singleton instance
exports.grpcClient = new GRPCClient();
// Export the sendTradeMessage function for convenience
const sendTradeMessage = (tradeData) => exports.grpcClient.sendTradeMessage(tradeData);
exports.sendTradeMessage = sendTradeMessage;
