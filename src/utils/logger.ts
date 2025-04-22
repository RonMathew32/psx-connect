import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Get log file path from environment or use default
const logFilePath = process.env.LOG_FILE_PATH || path.join(logsDir, 'psx-connect.log');

// Setup logs rotation
const rotateOptions = {
  maxsize: 5242880, // 5MB
  maxFiles: 5,
  tailable: true
};

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      const logMessage = stack 
        ? `${timestamp} [${level}]: ${message}\n${stack}` 
        : `${timestamp} [${level}]: ${message}`;
      return logMessage;
    })
  ),
  transports: [
    // Log to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          const logMessage = stack 
            ? `${timestamp} [${level}]: ${message}\n${stack}` 
            : `${timestamp} [${level}]: ${message}`;
          return logMessage;
        })
      )
    }),
    // Log to file
    new winston.transports.File({ 
      filename: logFilePath,
      ...rotateOptions
    }),
    // Separate error log
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      ...rotateOptions
    })
  ],
  exceptionHandlers: [
    // Log unhandled exceptions
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      ...rotateOptions
    }),
    new winston.transports.Console()
  ],
  rejectionHandlers: [
    // Log unhandled promise rejections
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      ...rotateOptions
    }),
    new winston.transports.Console()
  ]
});

// Create a stream object with a write function for Morgan
logger.stream = {
  write: (message: string) => {
    logger.info(message.trim());
  }
};

export default logger; 