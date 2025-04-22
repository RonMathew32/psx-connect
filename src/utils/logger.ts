import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = process.env.LOG_FILE_PATH || path.join(logsDir, 'psx-connect.log');

// Create formatter for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
  })
);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug', // Set default level to debug
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    new winston.transports.File({ 
      filename: 'pkf-log/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'pkf-log/debug.log', 
      level: 'debug' 
    }),
    new winston.transports.File({ 
      filename: 'pkf-log/combined.log' 
    })
  ]
});

export default logger; 