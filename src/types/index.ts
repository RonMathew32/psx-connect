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
  }
  
  export interface MarketDataItem {
    symbol: string;
    entryType: string;
    price?: number;
    size?: number;
    entryId?: string;
    timestamp?: string;
  }
  
  export interface SecurityInfo {
    symbol: string;
    securityType: string;
    securityDesc?: string;
    currency?: string;
    isin?: string;
  }
  
  export interface TradingSessionInfo {
    sessionId: string;
    status: string;
    startTime?: string;
    endTime?: string;
  }