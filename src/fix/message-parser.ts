import { SOH } from '../constants';

/**
 * Parsed FIX message as a dictionary of tag-value pairs
 */
export interface ParsedFixMessage {
  [key: string]: string;
}
/**
 * Parse a FIX message string into a tag-value object
 * @param message The raw FIX message string
 * @returns ParsedFixMessage or null if parsing failed
 */
export function parseFixMessage(message: string): ParsedFixMessage | null {
  try {
    const result: ParsedFixMessage = {};
    
    // Split on SOH character
    const fields = message.split(SOH);
    
    // Process each field
    for (const field of fields) {
      if (!field) continue;
      
      // Split tag=value
      const separatorIndex = field.indexOf('=');
      if (separatorIndex > 0) {
        const tag = field.substring(0, separatorIndex);
        const value = field.substring(separatorIndex + 1);
        result[tag] = value;
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error parsing FIX message:', error);
    return null;
  }
}