import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * Interface for sequence numbers to be stored
 */
interface StoredSequences {
  main: number;
  server: number;
  marketData: number;
  securityList: number;
  tradingStatus: number;
  lastUpdated: string;
}

/**
 * Utility to persist sequence numbers to a file and load them back
 */
export class SequenceStore {
  private filePath: string;
  private today: string;
  private lastSavedData: StoredSequences | null = null;

  constructor(filename = 'sequence-store.json') {
    // Store file in the same directory as the application
    this.filePath = path.join(process.cwd(), filename);
    // Get today's date in YYYYMMDD format for date comparison
    this.today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    logger.info(`[SEQUENCE_STORE] Initialized with file path: ${this.filePath}`);
  }

  /**
   * Save sequence numbers to the file
   */
  public saveSequences(sequences: {
    main: number;
    server: number;
    marketData: number;
    securityList: number;
    tradingStatus: number;
  }): boolean {
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
      
      const data: StoredSequences = {
        ...sequences,
        lastUpdated: new Date().toISOString()
      };
      
      // Cache the data we're saving
      this.lastSavedData = data;
      
      // Create the directory if it doesn't exist
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`[SEQUENCE_STORE] Created directory: ${dir}`);
      }
      
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
      logger.info(`[SEQUENCE_STORE] Saved sequence numbers to ${this.filePath}`);
      return true;
    } catch (error) {
      logger.error(`[SEQUENCE_STORE] Error saving sequence numbers: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Load sequence numbers from the file
   * Returns null if file doesn't exist, is from a different day, or has invalid data
   */
  public loadSequences(): {
    main: number;
    server: number;
    marketData: number;
    securityList: number;
    tradingStatus: number;
  } | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info(`[SEQUENCE_STORE] No sequence store file found at ${this.filePath}`);
        return null;
      }

      const fileContent = fs.readFileSync(this.filePath, 'utf8');
      const data: StoredSequences = JSON.parse(fileContent);
      
      // Store the data we loaded
      this.lastSavedData = data;
      
      // Check if the stored sequence is from today
      const storedDate = new Date(data.lastUpdated).toISOString().split('T')[0].replace(/-/g, '');
      if (storedDate !== this.today) {
        logger.info(`[SEQUENCE_STORE] Stored sequence is from ${storedDate}, but today is ${this.today}. Starting fresh.`);
        return null;
      }

      logger.info(`[SEQUENCE_STORE] Loaded sequence numbers from ${this.filePath}: main=${data.main}, server=${data.server}`);
      return {
        main: data.main,
        server: data.server,
        marketData: data.marketData,
        securityList: data.securityList,
        tradingStatus: data.tradingStatus
      };
    } catch (error) {
      logger.error(`[SEQUENCE_STORE] Error loading sequence numbers: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get the file path where sequences are stored
   */
  public getFilePath(): string {
    return this.filePath;
  }
} 