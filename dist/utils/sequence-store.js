"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequenceStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("./logger");
/**
 * Utility to persist sequence numbers to a file and load them back
 */
class SequenceStore {
    constructor(filename = 'sequence-store.json') {
        this.lastSavedData = null;
        // Store file in the same directory as the application
        this.filePath = path_1.default.join(process.cwd(), filename);
        // Get today's date in YYYYMMDD format for date comparison
        this.today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        logger_1.logger.info(`[SEQUENCE_STORE] Initialized with file path: ${this.filePath}`);
    }
    /**
     * Save sequence numbers to the file
     */
    saveSequences(sequences) {
        try {
            // If values are the same as last save, skip writing to file to reduce I/O
            if (this.lastSavedData &&
                this.lastSavedData.main === sequences.main &&
                this.lastSavedData.server === sequences.server &&
                this.lastSavedData.marketData === sequences.marketData &&
                this.lastSavedData.securityList === sequences.securityList &&
                this.lastSavedData.tradingStatus === sequences.tradingStatus) {
                return true;
            }
            const data = {
                ...sequences,
                lastUpdated: new Date().toISOString()
            };
            // Cache the data we're saving
            this.lastSavedData = data;
            // Create the directory if it doesn't exist
            const dir = path_1.default.dirname(this.filePath);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
                logger_1.logger.info(`[SEQUENCE_STORE] Created directory: ${dir}`);
            }
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
            logger_1.logger.info(`[SEQUENCE_STORE] Saved sequence numbers to ${this.filePath}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`[SEQUENCE_STORE] Error saving sequence numbers: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    /**
     * Load sequence numbers from the file
     * Returns null if file doesn't exist, is from a different day, or has invalid data
     */
    loadSequences() {
        try {
            if (!fs_1.default.existsSync(this.filePath)) {
                logger_1.logger.info(`[SEQUENCE_STORE] No sequence store file found at ${this.filePath}`);
                return null;
            }
            const fileContent = fs_1.default.readFileSync(this.filePath, 'utf8');
            const data = JSON.parse(fileContent);
            // Store the data we loaded
            this.lastSavedData = data;
            // Check if the stored sequence is from today
            const storedDate = new Date(data.lastUpdated).toISOString().split('T')[0].replace(/-/g, '');
            if (storedDate !== this.today) {
                logger_1.logger.info(`[SEQUENCE_STORE] Stored sequence is from ${storedDate}, but today is ${this.today}. Starting fresh.`);
                return null;
            }
            logger_1.logger.info(`[SEQUENCE_STORE] Loaded sequence numbers from ${this.filePath}: main=${data.main}, server=${data.server}`);
            return {
                main: data.main,
                server: data.server,
                marketData: data.marketData,
                securityList: data.securityList,
                tradingStatus: data.tradingStatus
            };
        }
        catch (error) {
            logger_1.logger.error(`[SEQUENCE_STORE] Error loading sequence numbers: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /**
     * Get the file path where sequences are stored
     */
    getFilePath() {
        return this.filePath;
    }
}
exports.SequenceStore = SequenceStore;
