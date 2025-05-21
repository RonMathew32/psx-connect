import { EventEmitter } from "events";
import {logger} from "../utils/logger";
import { SequenceManager } from "../utils/sequence-manager";
import { FieldTag } from "../constants";
import { ParsedFixMessage } from "./message-parser";
import { MarketDataItem, SecurityInfo, TradingSessionInfo } from "../types";

function processMarketData(
    parsedMessage: ParsedFixMessage,
    emitter: EventEmitter,
    type: 'SNAPSHOT' | 'INCREMENTAL'
  ): void {
    try {
      logger.info(`[MARKET_DATA:${type}] Processing market data...`);
      const marketData: MarketDataItem[] = [];
      const symbol = parsedMessage[FieldTag.SYMBOL] || 'UNKNOWN';
      const noMDEntries = parseInt(parsedMessage[FieldTag.NO_MD_ENTRIES] || '0', 10);
  
      for (let i = 1; i <= noMDEntries; i++) {
        const entryPrefix = `MD ENTRY ${i}`;
        const entryType = parsedMessage[`${entryPrefix}:${FieldTag.MD_ENTRY_TYPE}`];
        const entryPx = parsedMessage[`${entryPrefix}:${FieldTag.MD_ENTRY_PX}`];
        const entrySize = parsedMessage[`${entryPrefix}:${FieldTag.MD_ENTRY_SIZE}`];
  
        if (entryType && entryPx) {
          marketData.push({
            symbol,
            entryType,
            price: parseFloat(entryPx),
            size: entrySize ? parseInt(entrySize, 10) : undefined,
            timestamp: parsedMessage[FieldTag.SENDING_TIME] || new Date().toISOString(),
          });
        }
      }
  
      if (marketData.length > 0) {
        emitter.emit('marketData', marketData);
        emitter.emit('kseData', marketData);
      }
  
      emitter.emit('categorizedData', {
        category: 'MARKET_DATA',
        type,
        symbol,
        data: parsedMessage,
        timestamp: new Date().toISOString(),
      });
  
      logger.info(`[MARKET_DATA:${type}] Processing complete for symbol: ${symbol}`);
    } catch (error) {
      logger.error(`[MARKET_DATA:${type}] Error handling: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

export const handleLogon = (
    message: ParsedFixMessage,
    sequenceManager: SequenceManager,
    emitter: EventEmitter,
    requestedEquitySecurities: { value: boolean }
): void => {
    logger.info(`[SESSION:LOGON] Processing logon message from server`);
    const wasPreviouslyLoggedIn = requestedEquitySecurities.value;
    requestedEquitySecurities.value = true;

    // Get server's sequence number
    const serverSeqNum = parseInt(message[FieldTag.MSG_SEQ_NUM] || "1", 10);
    logger.info(`[SESSION:LOGON] Server's sequence number: ${serverSeqNum}`);

    // Check if a sequence reset is requested
    const resetFlag = message[FieldTag.RESET_SEQ_NUM_FLAG] === "Y";

    // Process the logon using the sequence manager to ensure correct sequence numbers
    sequenceManager.processLogon(serverSeqNum, resetFlag);

    logger.info(
        `[SESSION:LOGON] Successfully logged in to FIX server with sequence numbers: ${JSON.stringify(
            sequenceManager.getAll()
        )}`
    );

    // Emit event so client can handle login success
    emitter.emit("logon", message);

    // Schedule trading session status request after a short delay
    if (!wasPreviouslyLoggedIn) {
        setTimeout(() => {
            emitter.emit("requestTradingSessionStatus");
        }, 1000);
    }

    logger.info(`[SESSION:LOGON] Processing complete`);
};

export const handleLogout = (
    message: ParsedFixMessage,
    emitter: EventEmitter,
    sequenceManager: SequenceManager,
    requestedEquitySecurities: { value: boolean },
    socket: any,
    connect: () => Promise<void>
): { isSequenceError: boolean; expectedSeqNum?: number } => {
    logger.info(`[SESSION:LOGOUT] Handling logout message`);

    // Get any provided text reason for the logout
    const text = message[FieldTag.TEXT];

    // Reset sequence numbers on any logout
    logger.info("[SESSION:LOGOUT] Resetting all sequence numbers due to logout");
    sequenceManager.resetAll();
    logger.info(
        `[SESSION:LOGOUT] After reset, sequence numbers: ${JSON.stringify(
            sequenceManager.getAll()
        )}`
    );

    // Reset the requestedEquitySecurities flag so we can request them again after reconnect
    requestedEquitySecurities.value = false;
    logger.info("[SESSION:LOGOUT] Reset requestedEquitySecurities flag");

    // Check if this is a sequence number related logout
    if (
        text &&
        (text.includes("MsgSeqNum") ||
            text.includes("too large") ||
            text.includes("sequence"))
    ) {
        logger.warn(
            `[SESSION:LOGOUT] Received logout due to sequence number issue: ${text}`
        );

        // Try to parse the expected sequence number from the message
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                logger.info(
                    `[SESSION:LOGOUT] Server expects sequence number: ${expectedSeqNum}`
                );

                // Perform a full disconnect and reconnect with sequence reset
                if (socket) {
                    logger.info(
                        "[SESSION:LOGOUT] Disconnecting due to sequence number error"
                    );
                    socket.destroy();
                    socket = null;
                }

                // Wait a moment before reconnecting
                setTimeout(() => {
                    // Reset sequence numbers to what the server expects
                    sequenceManager.forceReset(expectedSeqNum);

                    logger.info(
                        `[SESSION:LOGOUT] Reconnecting with adjusted sequence numbers: ${JSON.stringify(
                            sequenceManager.getAll()
                        )}`
                    );
                    connect();
                }, 2000);

                return { isSequenceError: true, expectedSeqNum };
            } else {
                // If we can't parse the expected sequence number, do a full reset
                logger.info(
                    "[SESSION:LOGOUT] Cannot parse expected sequence number, performing full reset"
                );

                if (socket) {
                    socket.destroy();
                    socket = null;
                }

                setTimeout(() => {
                    // Reset sequence numbers
                    sequenceManager.resetAll();

                    logger.info(
                        "[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers"
                    );
                    connect();
                }, 2000);

                return { isSequenceError: true };
            }
        } else {
            // No match found, do a full reset
            logger.info(
                "[SESSION:LOGOUT] No expected sequence number found in message, performing full reset"
            );

            if (socket) {
                socket.destroy();
                socket = null;
            }

            setTimeout(() => {
                // Reset sequence numbers
                sequenceManager.resetAll();

                logger.info(
                    "[SESSION:LOGOUT] Reconnecting with fully reset sequence numbers"
                );
                connect();
            }, 2000);

            return { isSequenceError: true };
        }
    } else {
        // For normal logout (not sequence error), also reset the sequence numbers
        logger.info("[SESSION:LOGOUT] Normal logout, sequence numbers reset");

        emitter.emit("logout", message);
        return { isSequenceError: false };
    }
};

export const handleSequenceError = (
    expectedSeqNum: number | undefined,
    sequenceManager: SequenceManager,
    socket: any,
    connect: () => Promise<void>
): void => {
    if (expectedSeqNum !== undefined) {
        logger.info(
            `[SEQUENCE:ERROR] Server expects sequence number: ${expectedSeqNum}`
        );

        // Perform a full disconnect and reconnect with sequence reset
        if (socket) {
            logger.info(
                "[SEQUENCE:ERROR] Disconnecting due to sequence number error"
            );
            socket.destroy();
            socket = null;
        }

        // Wait a moment before reconnecting
        setTimeout(() => {
            // Reset sequence numbers to what the server expects for PKF-50 compliance
            logger.info(`[SEQUENCE:ERROR] Setting sequence numbers for reconnect:`);

            // For PKF-50, maintain the specialized sequence numbers
            sequenceManager.forceReset(expectedSeqNum);

            // Log all sequence numbers after reset for verification
            const seqNumbers = sequenceManager.getAll();
            logger.info(
                `[SEQUENCE:ERROR] After reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`
            );

            logger.info(
                `[SEQUENCE:ERROR] Reconnecting with adjusted sequence numbers`
            );
            connect();
        }, 2000);
    } else {
        // If we can't parse the expected sequence number, do a full reset
        logger.info(
            "[SEQUENCE:ERROR] Cannot determine expected sequence number, performing full reset"
        );

        if (socket) {
            socket.destroy();
            socket = null;
        }

        setTimeout(() => {
            // Reset all sequence numbers to defaults per PKF-50
            sequenceManager.resetAll();

            // Log all sequence numbers after reset for verification
            const seqNumbers = sequenceManager.getAll();
            logger.info(
                `[SEQUENCE:ERROR] After full reset: Main=${seqNumbers.main}, Server=${seqNumbers.server}, MarketData=${seqNumbers.marketData}, SecurityList=${seqNumbers.securityList}, TradingStatus=${seqNumbers.tradingStatus}`
            );

            logger.info(
                "[SEQUENCE:ERROR] Reconnecting with fully reset sequence numbers"
            );
            connect();
        }, 2000);
    }
};

export const handleMarketDataSnapshot = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    processMarketData(parsedMessage, emitter, 'SNAPSHOT');
  };

  export const handleMarketDataIncremental = (parsedMessage: ParsedFixMessage, emitter: EventEmitter): void => {
    processMarketData(parsedMessage, emitter, 'INCREMENTAL');
  };

export const handleSecurityList = (
    parsedMessage: ParsedFixMessage,
    emitter: EventEmitter,
    securityCache: { EQUITY: SecurityInfo[]; INDEX: SecurityInfo[] }
): void => {
    try {
        logger.info("[SECURITY_LIST] Processing security list...");

        const securities: SecurityInfo[] = [];
        const noRelatedSym = parseInt(
            parsedMessage[FieldTag.NO_RELATED_SYM] || "0",
            10
        );
        const product = parsedMessage["460"] || "4"; // Default to EQUITY if not specified
        const productType = product === "5" ? "INDEX" : "EQUITY";
        const isFinalFragment = parsedMessage[FieldTag.LAST_FRAGMENT] === "Y";
        const reqId = parsedMessage[FieldTag.SECURITY_REQ_ID] || "";
        
        logger.info(
            `[SECURITY_LIST:${productType}] Processing ${noRelatedSym} securities, fragment is ${isFinalFragment ? 'final' : 'partial'}, reqId: ${reqId}`
        );

        for (let i = 1; i <= noRelatedSym; i++) {
            const symPrefix = `RELATED SYM ${i}`;
            const symbol = parsedMessage[`${symPrefix}:${FieldTag.SYMBOL}`];
            const securityDesc = parsedMessage[`${symPrefix}:${FieldTag.SECURITY_DESC}`];
            const isin = parsedMessage[`${symPrefix}:${FieldTag.ISIN}`] || "";
            const securityId = parsedMessage[`${symPrefix}:${FieldTag.SECURITY_ID}`] || "";
            const currency = parsedMessage[`${symPrefix}:${FieldTag.CURRENCY}`] || "PKR";
            const issuer = parsedMessage[`${symPrefix}:${FieldTag.ISSUER}`] || "";
            const cfiCode = parsedMessage[`${symPrefix}:${FieldTag.CFI_CODE}`] || "";
            const securityType = parsedMessage[`${symPrefix}:167`] || ""; // SecurityType
            
            // Trading session info
            let tradingSessionId = "REG";
            const noTradingSessionRules = parseInt(parsedMessage[`${symPrefix}:1309`] || "0", 10);
            
            if (noTradingSessionRules > 0) {
                tradingSessionId = parsedMessage[`${symPrefix}:TRD SESS RULES 1:${FieldTag.TRADING_SESSION_ID}`] || "REG";
            }

            if (symbol) {
                securities.push({
                    symbol,
                    securityDesc: securityDesc || "",
                    product: productType,
                    isin,
                    securityId,
                    currency,
                    issuer,
                    cfiCode,
                    securityType,
                    tradingSessionId
                });
                
                logger.debug(`[SECURITY_LIST:${productType}] Processed symbol: ${symbol}, desc: ${securityDesc || 'N/A'}`);
            }
        }

        // If we received securities, update cache based on product type
        if (securities.length > 0) {
            if (isFinalFragment || securityCache[productType].length === 0) {
                // If this is the final fragment or we have no existing data, replace the cache
                securityCache[productType] = securities;
                logger.info(`[SECURITY_LIST:${productType}] Replaced cache with ${securities.length} securities`);
            } else {
                // Otherwise append to existing cache
                securityCache[productType] = [...securityCache[productType], ...securities];
                logger.info(`[SECURITY_LIST:${productType}] Added ${securities.length} securities to cache, total now: ${securityCache[productType].length}`);
            }
        }

        // Emit events
        emitter.emit("securityList", securities);
        emitter.emit(`${productType.toLowerCase()}SecurityList`, securities);

        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "SECURITY_LIST",
            type: productType,
            count: noRelatedSym,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });

        logger.info(
            `[SECURITY_LIST:${productType}] Processing complete for ${noRelatedSym} securities ${isFinalFragment ? '(final fragment)' : ''}`
        );
    } catch (error) {
        logger.error(
            `[SECURITY_LIST] Error handling security list: ${error instanceof Error ? error.message : String(error)}`
        );
    }
};

export const handleTradingSessionStatus = (
    parsedMessage: ParsedFixMessage,
    emitter: EventEmitter
): void => {
    try {
        logger.info(
            "[TRADING_STATUS:SESSION] Processing trading session status..."
        );

        const sessionInfo: TradingSessionInfo = {
            tradingSessionID: parsedMessage[FieldTag.TRADING_SESSION_ID] || "UNKNOWN",
            status: parsedMessage["340"] || "UNKNOWN", // TradSesStatus
            timestamp:
                parsedMessage[FieldTag.SENDING_TIME] || new Date().toISOString(),
        };

        emitter.emit("tradingSessionStatus", sessionInfo);

        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SESSION",
            session: sessionInfo.tradingSessionID,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });

        logger.info(
            `[TRADING_STATUS:SESSION] Processing complete for session: ${sessionInfo.tradingSessionID}`
        );
    } catch (error) {
        logger.error(
            `[TRADING_STATUS:SESSION] Error handling trading session status: ${error instanceof Error ? error.message : String(error)
            }`
        );
    }
};

export const handleTradingStatus = (
    parsedMessage: ParsedFixMessage,
    emitter: EventEmitter
): void => {
    try {
        logger.info("[TRADING_STATUS:SYMBOL] Processing trading status...");

        const statusInfo = {
            symbol: parsedMessage[FieldTag.SYMBOL] || "UNKNOWN",
            status: parsedMessage["326"] || "UNKNOWN", // TradingStatus
            timestamp:
                parsedMessage[FieldTag.SENDING_TIME] || new Date().toISOString(),
            origTime: parsedMessage["60"], // TransactTime
        };

        emitter.emit("kseTradingStatus", statusInfo);

        // Emit an additional categorized event
        emitter.emit("categorizedData", {
            category: "TRADING_STATUS",
            type: "SYMBOL",
            symbol: statusInfo.symbol,
            status: statusInfo.status,
            data: parsedMessage,
            timestamp: new Date().toISOString(),
        });

        logger.info(
            `[TRADING_STATUS:SYMBOL] Processing complete for symbol: ${statusInfo.symbol}`
        );
    } catch (error) {
        logger.error(
            `[TRADING_STATUS:SYMBOL] Error handling trading status: ${error instanceof Error ? error.message : String(error)
            }`
        );
    }
};

export const handleReject = (
    parsedMessage: ParsedFixMessage
): { isSequenceError: boolean; expectedSeqNum?: number } => {
    const text = parsedMessage[FieldTag.TEXT] || "";
    const isSequenceError =
        text.includes("MsgSeqNum") ||
        text.includes("too large") ||
        text.includes("sequence");

    if (isSequenceError) {
        const expectedSeqNumMatch = text.match(/expected ['"]?(\d+)['"]?/);
        if (expectedSeqNumMatch && expectedSeqNumMatch[1]) {
            const expectedSeqNum = parseInt(expectedSeqNumMatch[1], 10);
            if (!isNaN(expectedSeqNum)) {
                return { isSequenceError: true, expectedSeqNum };
            }
        }
        return { isSequenceError: true };
    }

    return { isSequenceError: false };
};

export const handleMarketDataRequestReject = (
    parsedMessage: ParsedFixMessage,
    emitter: EventEmitter
): void => {
    const rejectInfo = {
        requestId: parsedMessage[FieldTag.MD_REQ_ID] || "UNKNOWN",
        reason: parsedMessage["58"] || "UNKNOWN", // Text
        text: parsedMessage[FieldTag.TEXT],
    };

    emitter.emit("marketDataReject", rejectInfo);
};
