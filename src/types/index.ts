import { FieldTag } from '../constants';

export interface FixClientOptions {
    host: string;
    port: number;
    senderCompId: string;
    targetCompId: string;
    username: string;
    password: string;
    heartbeatIntervalSecs: number;
    resetOnLogon?: boolean;
    resetOnLogout?: boolean;
    resetOnDisconnect?: boolean;
    validateFieldsOutOfOrder?: boolean;
    checkFieldsOutOfOrder?: boolean;
    rejectInvalidMessage?: boolean;
    forceResync?: boolean;
    fileLogPath?: string;
    fileStorePath?: string;
    connectTimeoutMs?: number;
    reconnectIntervalMs?: number;
    maxReconnectAttempts?: number;
    onBehalfOfCompId?: string;
    rawDataLength?: number;
    rawData?: string;
    partyId?: string;
  }
  
  export interface MarketDataItem {
    symbol: string;
    entryType: string;
    price?: number;
    size?: number;
    entryId?: string;
    timestamp?: string;
    '55'?: string;   // SYMBOL
    '270'?: string;  // MD_ENTRY_PX
    '387'?: string;  // TOTAL_VOLUME_TRADED
    '52'?: string;   // SENDING_TIME
    '269'?: string;  // MD_ENTRY_TYPE
    '1500'?: string; // Channel number
    channelDescription?: string;
    [key: string]: any; // Allow any other FIX fields
  }

  
  export interface TradingSessionInfo {
    sessionId?: string;
    tradingSessionID: string;
    status: string;
    startTime?: string;
    endTime?: string;
    timestamp?: string;
  }

  export interface SecurityInfo {
    symbol: string;
    securityDesc: string;
    securityType?: string;
    marketId?: string;
    productType?: string;  // Added for PSX distinction between EQUITY (4) and INDEX (5)
    lotSize?: number;
    tickSize?: number;
    exchange?: string;
    isin?: string;
    securityId?: string;  // Added for PSX unique identifier
    currency?: string;
    product?: string;
    issuer?: string;
    cfiCode?: string;
    tradingSessionId?: string;  // Which trading session this security belongs to (REG, FUT, etc.)
    roundLot?: number;          // Trading lot size
    minTradeVolume?: number;    // Minimum trading volume
  }
  
  export interface FixClientOptions {
    host: string;
    port: number;
    senderCompId: string;
    targetCompId: string;
    username: string;
    password: string;
    heartbeatIntervalSecs: number;
    connectTimeoutMs?: number;
    partyId?: string;
    onBehalfOfCompId?: string;
    rawDataLength?: number;
    rawData?: string;  // Add rawData as optional field
    resetOnLogon?: boolean;  // Add resetOnLogon as optional field
    initialSequenceNumbers?: {
      main?: number;
      marketData?: number;
      securityList?: number;
      tradingStatus?: number;
    };
  } 

  export interface WebSocketMessage {
    type: 'realtime'| 'logon' | 'logout' | 'kseData' | 'error' | 'status';
    data?: MarketDataItem[] | TradingSessionInfo | SecurityInfo[] | any;
    message?: string;
    timestamp?: number;
    connected?: boolean;
    categorized?: {
      equities: SecurityInfo[];
      indices: SecurityInfo[];
      other: SecurityInfo[];
    };
    count?: number;
  }
  
  export interface FixConfig {
    host: string;
    port: number;
    senderCompId: string;
    targetCompId: string;
    username: string;
    password: string;
    heartbeatIntervalSecs: number;
    resetOnLogon: boolean;
  }

  export interface FixClient {
    on(event: 'reject' | 'logon' | 'logout' | 'error' | 'disconnected' | 'connected' | 'realtime', listener: (...args: any[]) => void): FixClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendLogon(): void;
    sendLogout(text?: string): void;
    start(): void;
    stop(): void;
  }