import { SOH, FieldTag } from '../constants';

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
    
    // Process repeating groups for market data entries if present
    if (result[FieldTag.NO_MD_ENTRIES]) {
      const noMDEntries = parseInt(result[FieldTag.NO_MD_ENTRIES], 10);
      
      // Handle each MD entry
      for (let i = 1; i <= noMDEntries; i++) {
        // For each entry, check for MDEntryType, MDEntryPx, MDEntrySize
        const mdEntryType = fields.find(f => f.startsWith(`269.${i}=`) || f.startsWith(`269_${i}=`));
        const mdEntryPx = fields.find(f => f.startsWith(`270.${i}=`) || f.startsWith(`270_${i}=`));
        const mdEntrySize = fields.find(f => f.startsWith(`271.${i}=`) || f.startsWith(`271_${i}=`));
        const mdPriceLevel = fields.find(f => f.startsWith(`1023.${i}=`) || f.startsWith(`1023_${i}=`));
        
        // Add to the result with a structured naming convention
        if (mdEntryType) {
          const entryPrefix = `MD ENTRY ${i}`;
          const entryTypeVal = mdEntryType.substring(mdEntryType.indexOf('=') + 1);
          result[`${entryPrefix}:${FieldTag.MD_ENTRY_TYPE}`] = entryTypeVal;
          
          if (mdEntryPx) {
            const pxVal = mdEntryPx.substring(mdEntryPx.indexOf('=') + 1);
            result[`${entryPrefix}:${FieldTag.MD_ENTRY_PX}`] = pxVal;
          }
          
          if (mdEntrySize) {
            const sizeVal = mdEntrySize.substring(mdEntrySize.indexOf('=') + 1);
            result[`${entryPrefix}:${FieldTag.MD_ENTRY_SIZE}`] = sizeVal;
          }
          
          if (mdPriceLevel) {
            const levelVal = mdPriceLevel.substring(mdPriceLevel.indexOf('=') + 1);
            result[`${entryPrefix}:${FieldTag.MD_PRICE_LEVEL}`] = levelVal;
          }
          
          // Process order details if present
          const noOrders = fields.find(f => f.startsWith(`73.${i}=`) || f.startsWith(`73_${i}=`));
          if (noOrders) {
            const noOrdersVal = noOrders.substring(noOrders.indexOf('=') + 1);
            result[`${entryPrefix}:${FieldTag.NO_ORDERS}`] = noOrdersVal;
            
            const numOrders = parseInt(noOrdersVal, 10);
            for (let j = 1; j <= numOrders; j++) {
              const orderPrefix = `${entryPrefix}:ORDER ${j}`;
              
              const orderQty = fields.find(f => f.startsWith(`38.${i}.${j}=`) || f.startsWith(`38_${i}_${j}=`));
              const orderId = fields.find(f => f.startsWith(`37.${i}.${j}=`) || f.startsWith(`37_${i}_${j}=`));
              
              if (orderQty) {
                const qtyVal = orderQty.substring(orderQty.indexOf('=') + 1);
                result[`${orderPrefix}:${FieldTag.ORDER_QTY}`] = qtyVal;
              }
              
              if (orderId) {
                const idVal = orderId.substring(orderId.indexOf('=') + 1);
                result[`${orderPrefix}:${FieldTag.ORDER_ID}`] = idVal;
              }
            }
          }
          
          const numberOfOrders = fields.find(f => f.startsWith(`346.${i}=`) || f.startsWith(`346_${i}=`));
          if (numberOfOrders) {
            const numVal = numberOfOrders.substring(numberOfOrders.indexOf('=') + 1);
            result[`${entryPrefix}:${FieldTag.NUMBER_OF_ORDERS}`] = numVal;
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error parsing FIX message:', error);
    return null;
  }
}