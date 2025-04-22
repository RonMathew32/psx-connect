"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Create logs directory if it doesn't exist
const logsDir = path_1.default.join(process.cwd(), 'logs');
if (!fs_1.default.existsSync(logsDir)) {
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
const logFilePath = process.env.LOG_FILE_PATH || path_1.default.join(logsDir, 'psx-connect.log');
// Create formatter for console output
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp(), winston_1.default.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
}));
// Create logger
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'debug', // Set default level to debug
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.Console({
            format: consoleFormat
        }),
        new winston_1.default.transports.File({
            filename: 'pkf-log/error.log',
            level: 'error'
        }),
        new winston_1.default.transports.File({
            filename: 'pkf-log/debug.log',
            level: 'debug'
        }),
        new winston_1.default.transports.File({
            filename: 'pkf-log/combined.log'
        })
    ]
});
exports.default = logger;
