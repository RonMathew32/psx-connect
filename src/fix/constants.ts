// FIX Message Types
export enum MessageType {
  HEARTBEAT = '0',
  TEST_REQUEST = '1',
  RESEND_REQUEST = '2',
  REJECT = '3',
  SEQUENCE_RESET = '4',
  LOGOUT = '5',
  LOGON = 'A',
  MARKET_DATA_REQUEST = 'V',
  MARKET_DATA_SNAPSHOT_FULL_REFRESH = 'W',
  MARKET_DATA_INCREMENTAL_REFRESH = 'X',
  SECURITY_LIST_REQUEST = 'x',
  SECURITY_LIST = 'y',
  TRADING_SESSION_STATUS_REQUEST = 'g',
  TRADING_SESSION_STATUS = 'h'
}

// FIX Field Tags
export enum FieldTag {
  BEGIN_STRING = 8,
  BODY_LENGTH = 9,
  MSG_TYPE = 35,
  SENDER_COMP_ID = 49,
  TARGET_COMP_ID = 56,
  MSG_SEQ_NUM = 34,
  SENDING_TIME = 52,
  ENCRYPT_METHOD = 98,
  HEART_BT_INT = 108,
  RESET_SEQ_NUM_FLAG = 141,
  USERNAME = 553,
  PASSWORD = 554,
  ON_BEHALF_OF_COMP_ID = 115,
  RAW_DATA = 96,
  RAW_DATA_LENGTH = 95,
  DEFAULT_APPL_VER_ID = 1137,
  DEFAULT_CSTM_APPL_VER_ID = 1129,
  TEST_REQ_ID = 112,
  CHECK_SUM = 10,
  MD_REQ_ID = 262,
  SUBSCRIPTION_REQUEST_TYPE = 263,
  MARKET_DEPTH = 264,
  MD_UPDATE_TYPE = 265,
  NO_MD_ENTRY_TYPES = 267,
  NO_RELATED_SYM = 146,
  SECURITY_LIST_REQUEST_TYPE = 559,
  SECURITY_TYPE = 167,
  SYMBOL = 55,
  MD_ENTRY_TYPE = 269,
  TRADING_SESSION_ID = 336,
  TEXT = 58
}

// Subscription Request Types
export enum SubscriptionRequestType {
  SNAPSHOT = '0',
  SNAPSHOT_PLUS_UPDATES = '1',
  DISABLE_PREVIOUS_SNAPSHOT_PLUS_UPDATE_REQUEST = '2'
}

// Market Data Entry Types
export enum MDEntryType {
  BID = '0',
  OFFER = '1',
  TRADE = '2',
  INDEX_VALUE = '3',
  OPENING_PRICE = '4',
  CLOSING_PRICE = '5',
  SETTLEMENT_PRICE = '6',
  TRADING_SESSION_HIGH_PRICE = '7',
  TRADING_SESSION_LOW_PRICE = '8',
  TRADING_SESSION_VWAP_PRICE = '9'
}

// Market Data Update Types
export enum MDUpdateType {
  FULL_REFRESH = '0',
  INCREMENTAL_REFRESH = '1'
}

// Security List Request Types
export enum SecurityListRequestType {
  ALL_SECURITIES = '0',
  PRODUCT = '1',
  TRADING_STATUS = '2',
  ALL_SECURITIES_IN_CATEGORY = '3'
}

// Security Types
export enum SecurityType {
  COMMON_STOCK = 'CS',
  PREFERRED_STOCK = 'PS',
  FUTURE = 'FUT',
  OPTION = 'OPT',
  BOND = 'BOND'
}

// Delimiter
export const SOH = String.fromCharCode(1); // ASCII code 1 (Start of Heading)

// Default connection parameters
export const DEFAULT_CONNECTION = {
  VERSION: 'FIXT.1.1',
  ENCRYPT_METHOD: '0',
  HEARTBEAT_INTERVAL: '30',
  RESET_SEQ_NUM: 'Y'
}; 