"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Create logs directory if it doesn't exist
const logsDir = path_1.default.join(process.cwd(), 'logs');
if (!fs_1.default.existsSync(logsDir)) {
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
// Get log file path from environment or use default
const logFilePath = process.env.LOG_FILE_PATH || path_1.default.join(logsDir, 'psx-connect.log');
// Setup logs rotation
const rotateOptions = {
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
};
// Configure logger
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ level, message, timestamp, stack }) => {
        const logMessage = stack
            ? `${timestamp} [${level}]: ${message}\n${stack}`
            : `${timestamp} [${level}]: ${message}`;
        return logMessage;
    })),
    transports: [
        // Log to console
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.timestamp(), winston_1.default.format.printf(({ level, message, timestamp, stack }) => {
                const logMessage = stack
                    ? `${timestamp} [${level}]: ${message}\n${stack}`
                    : `${timestamp} [${level}]: ${message}`;
                return logMessage;
            }))
        }),
        // Log to file
        new winston_1.default.transports.File({
            filename: logFilePath,
            ...rotateOptions
        }),
        // Separate error log
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, 'error.log'),
            level: 'error',
            ...rotateOptions
        })
    ],
    exceptionHandlers: [
        // Log unhandled exceptions
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, 'exceptions.log'),
            ...rotateOptions
        }),
        new winston_1.default.transports.Console()
    ],
    rejectionHandlers: [
        // Log unhandled promise rejections
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, 'rejections.log'),
            ...rotateOptions
        }),
        new winston_1.default.transports.Console()
    ]
});
// Add the stream property to the logger
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    }
};
exports.default = logger;
