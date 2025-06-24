"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProcessedData = exports.sendSymbolUpdate = exports.sendSymbolSnapshot = exports.grpcClient = void 0;
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const logger_1 = require("./logger");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class GRPCClient {
    constructor() {
        this.processed = [];
        const PROTO_PATH = path.resolve(__dirname, '../../proto/fixfeed.proto');
        const packageDef = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const proto = grpc.loadPackageDefinition(packageDef);
        logger_1.logger.info(`Loaded proto: ${Object.keys(proto)}`);
        const FIXFeed = proto.fix.FIXFeed;
        const server = process.env.PKFSERVER || 'pkfinance.info:31039';
        logger_1.logger.info(`[SERVER] ${server}`);
        try {
            this.client = new FIXFeed(server, grpc.credentials.createInsecure());
            // Check connection status
            this.client.getChannel().getConnectivityState(true); // Force a connection attempt
            const state = this.client.getChannel().getConnectivityState(false);
            if (state === grpc.connectivityState.READY) {
                logger_1.logger.info(`gRPC connection established successfully to ${server}`);
            }
            else {
                logger_1.logger.warn(`gRPC connection not ready, current state: ${state} for server ${server}`);
                // Watch for state changes
                this.client.getChannel().watchConnectivityState(state, Infinity, () => {
                    const newState = this.client.getChannel().getConnectivityState(false);
                    if (newState === grpc.connectivityState.READY) {
                        logger_1.logger.info(`gRPC connection established successfully to ${server}`);
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
    processSymbolData(data) {
        // Set date if empty
        if (!data.entry_date?.trim()) {
            data.entry_date = new Date().toISOString().split('T')[0];
        }
        // Process change value
        if (!data.change) {
            if (data.price_delta) {
                data.change = data.price_delta;
            }
            else if (data.net_change) {
                data.change = data.net_change;
            }
            else {
                logger_1.logger.warn(`No change value for ${data.symbol}`);
            }
        }
        // Remove milliseconds from entry_time
        if (data.entry_time) {
            data.entry_time = data.entry_time.split('.')[0];
        }
        return data;
    }
    async sendSymbolMessage(method, data) {
        return new Promise((resolve, reject) => {
            data = this.processSymbolData(data);
            // Only process if session is open or empty
            if (!data.session_status || data.session_status === 'open') {
                this.processed.push(data);
                this.client[method](data, (err, response) => {
                    if (err) {
                        logger_1.logger.error(`gRPC Error sending ${method}: ${err.message}`, { data });
                        reject(err);
                    }
                    else {
                        logger_1.logger.info(`${method} sent successfully`, { data, response });
                        resolve(response);
                    }
                });
            }
            else {
                logger_1.logger.info(`Skipping ${method}, status is ${data.session_status}`);
                resolve({ status: 200, message: 'Skipped due to session status' });
            }
        });
    }
    async sendSymbolSnapshot(data) {
        return this.sendSymbolMessage('SymbolSnapshot', data);
    }
    async sendSymbolUpdate(data) {
        return this.sendSymbolMessage('SymbolUpdate', data);
    }
    getProcessedData() {
        return this.processed;
    }
}
// Export singleton instance
exports.grpcClient = new GRPCClient();
// Export convenience methods
const sendSymbolSnapshot = (data) => exports.grpcClient.sendSymbolSnapshot(data);
exports.sendSymbolSnapshot = sendSymbolSnapshot;
const sendSymbolUpdate = (data) => exports.grpcClient.sendSymbolUpdate(data);
exports.sendSymbolUpdate = sendSymbolUpdate;
const getProcessedData = () => exports.grpcClient.getProcessedData();
exports.getProcessedData = getProcessedData;
