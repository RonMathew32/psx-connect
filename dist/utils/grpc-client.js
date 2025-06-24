"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTradeMessage = exports.grpcClient = void 0;
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const logger_1 = require("./logger");
class GRPCClient {
    constructor() {
        const PROTO_PATH = path.resolve(__dirname, '../../proto/fixfeed.proto');
        const packageDef = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const proto = grpc.loadPackageDefinition(packageDef);
        const FIXFeed = proto.fix.FIXFeed;
        const server = process.env.PKFSERVER || 'pkfinance.info:31039';
        try {
            this.client = new FIXFeed(server, grpc.credentials.createInsecure());
            // Check connection status
            this.client.getChannel().getConnectivityState(true); // Force a connection attempt
            const state = this.client.getChannel().getConnectivityState(false);
            if (state === grpc.connectivityState.READY) {
                logger_1.logger.info(`gRPC connection established successfully to ${process.env.PKFSERVER}`);
            }
            else {
                logger_1.logger.warn(`gRPC connection not ready, current state: ${state} for server ${server}`);
                // Watch for state changes
                this.client.getChannel().watchConnectivityState(state, Infinity, () => {
                    const newState = this.client.getChannel().getConnectivityState(false);
                    if (newState === grpc.connectivityState.READY) {
                        logger_1.logger.info(`gRPC connection established successfully to ${process.env.PKFSERVER}`);
                    }
                    else {
                        logger_1.logger.error(`gRPC connection failed, current state: ${newState} for server ${server}`);
                    }
                });
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to initialize gRPC client for ${server}: ${error.message}`);
            throw error;
        }
    }
    async sendTradeMessage(tradeData) {
        return new Promise((resolve, reject) => {
            this.client.YourTradeMethod(tradeData, (err, response) => {
                if (err) {
                    logger_1.logger.error(`gRPC Error sending trade message: ${err.message}`, { tradeData });
                    reject(err);
                }
                else {
                    logger_1.logger.info('Trade sent successfully', { tradeData, response });
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
