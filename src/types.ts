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
  currency?: string;
}

export interface MarketDataItem {
  symbol: string;
  entryType: string;
  price?: number;
  size?: number;
  timestamp?: string;
}

export interface TradingSessionInfo {
  sessionId: string;
  status: string;
  startTime?: string;
  endTime?: string;
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
} 