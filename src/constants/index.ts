/**
 * FIX protocol constants
 */

// Standard FIX delimiter - SOH (Start of Header) character (ASCII 1)
export const SOH = String.fromCharCode(1);

/**
 * FIX message types
 */
export enum MessageType {
  HEARTBEAT = '0',
  TEST_REQUEST = '1',
  RESEND_REQUEST = '2',
  REJECT = '3',
  SEQUENCE_RESET = '4',
  LOGOUT = '5',
  LOGON = 'A',
  NEWS = 'B',
  EMAIL = 'C',
  NEW_ORDER_SINGLE = 'D',
  EXECUTION_REPORT = '8',
  ORDER_CANCEL_REJECT = '9',
  MARKET_DATA_REQUEST = 'V',
  MARKET_DATA_SNAPSHOT_FULL_REFRESH = 'W',
  MARKET_DATA_INCREMENTAL_REFRESH = 'X',
  MARKET_DATA_REQUEST_REJECT = 'Y',  // Added PKF-50 specific
  SECURITY_LIST_REQUEST = 'x',
  SECURITY_LIST = 'y',
  TRADING_SESSION_STATUS_REQUEST = 'g',
  TRADING_SESSION_STATUS = 'h'
}

/**
 * FIX field tags
 */
export enum FieldTag {
  BEGIN_STRING = '8',               // Begin string
  BODY_LENGTH = '9',                // Body length
  CHECK_SUM = '10',                 // Checksum
  CURRENCY = '15',                  // Currency of the security
  ORDER_ID = '37',                  // Order ID
  ORDER_QTY = '38',                 // Order quantity
  ORIG_TIME = '42',                 // Original time
  POSS_DUP_FLAG = '43',             // Possible duplicate flag
  REF_SEQ_NUM = '45',               // Reference sequence number
  ISIN = '48',                      // International Securities Identification Number
  SECURITY_ID = '48',               // Duplicate of ISIN but kept for clarity
  SENDER_COMP_ID = '49',            // Sender CompID
  SENDING_TIME = '52',              // Sending time
  SYMBOL = '55',                    // Symbol
  TEXT = '58',                      // Text
  TARGET_COMP_ID = '56',            // Target CompID
  NO_ORDERS = '73',                 // Number of orders
  RAW_DATA_LENGTH = '95',           // Raw data length
  RAW_DATA = '96',                  // Raw data
  ENCRYPT_METHOD = '98',            // Encryption method
  ISSUER = '106',                   // Issuer of the security
  SECURITY_DESC = '107',            // Security description
  HEART_BT_INT = '108',             // Heartbeat interval
  TEST_REQ_ID = '112',              // Test request ID
  ON_BEHALF_OF_COMP_ID = '115',     // On behalf of CompID
  PREV_CLOSE_PX = '140',            // Previous closing price
  RESET_SEQ_NUM_FLAG = '141',       // Reset sequence number flag
  NO_RELATED_SYM = '146',           // Number of related symbols
  SECURITY_TYPE = '167',            // Security type
  SECURITY_EXCHANGE = '207',        // Security exchange
  MD_REQ_ID = '262',                // Market data request ID
  SUBSCRIPTION_REQUEST_TYPE = '263', // Subscription request type
  MARKET_DEPTH = '264',             // Market depth
  MD_UPDATE_TYPE = '265',           // Market data update type
  NO_MD_ENTRY_TYPES = '267',        // Number of market data entry types
  NO_MD_ENTRIES = '268',            // Number of market data entries
  MD_ENTRY_TYPE = '269',            // Market data entry type
  MD_ENTRY_PX = '270',              // Market data entry price
  MD_ENTRY_SIZE = '271',            // Market data entry size
  MD_ENTRY_DATE = '272',            // Market data entry date
  MD_ENTRY_TIME = '273',            // Market data entry time
  MD_ENTRY_POSITION_NO = '290',     // Market data entry position number
  SECURITY_REQ_ID = '320',          // Security request ID
  SECURITY_STATUS_REQ_ID = '324',   // Security status request ID
  SECURITY_TRADING_STATUS = '326',  // Security trading status
  HALT_REASON = '327',              // Halt reason
  MSG_SEQ_NUM = '34',               // Message sequence number
  MSG_TYPE = '35',                  // Message type
  TRAD_SES_REQ_ID = '335',          // Trading session request ID
  TRADING_SESSION_ID = '336',       // Trading session ID
  TRAD_SES_STATUS = '340',          // Trading session status
  START_TIME = '341',               // Start time
  END_TIME = '342',                 // End time
  REF_TAG_ID = '371',               // Reference tag ID
  TOTAL_VOLUME_TRADED = '387',      // Total volume traded
  TOT_NO_RELATED_SYM = '393',       // Total number of related symbols
  NO_SECURITIES = '393',            // Number of securities in a security list response, same as TOT_NO_RELATED_SYM
  PARTY_ID_SOURCE = '447',          // Party ID source
  PARTY_ID = '448',                 // Party ID
  PARTY_ROLE = '452',               // Party role
  NO_PARTY_IDS = '453',             // Number of party IDs
  PRODUCT = '460',                  // Product type
  CFI_CODE = '461',                 // Classification of Financial Instrument code
  USERNAME = '553',                 // Username
  PASSWORD = '554',                 // Password
  SECURITY_LIST_REQUEST_TYPE = '559', // Security list request type
  ROUND_LOT = '561',                // Trading lot size of a security
  MIN_TRADE_VOL = '562',            // Minimum trading volume for a security
  TRADING_SESSION_SUB_ID = '625',   // Trading session sub ID
  MD_REJECT_REASON = '816',         // Market data reject reason
  LAST_FRAGMENT = '893',            // Indicates whether this is the last message in a sequence of messages
  MD_REPORT_ID = '963',             // Market data report ID
  SECURITY_STATUS = '965',          // Security status
  APPL_VER_ID = '1128',             // Application version ID
  DEFAULT_APPL_VER_ID = '1137',     // Default application version ID
  MARKET_ID = '1301',               // Market ID
  NO_TRADING_SESSION_RULES = '1309', // Number of trading session rules
  TRADING_SESSION_RULES_GROUP = '1310', // Trading session rules
  DEFAULT_CSTM_APPL_VER_ID = '1408' // Default custom application version ID
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
  BOND = 'BOND',
  FUTURE = 'FUT',
  OPTION = 'OPT'
}

// PKF-50 Specific Product Types
export enum ProductType {
  AGENCY = '1',
  COMMODITY = '2',
  CORPORATE = '3',
  CURRENCY = '4',
  EQUITY = '5',
  GOVERNMENT = '6',
  INDEX = '7',
  LOAN = '8',
  MONEYMARKET = '9',
  MORTGAGE = '10',
  MUNICIPAL = '11',
  OTHER = '12',
  FINANCING = '13'
}

// PKF-50 Specific Party Roles
export enum PartyRole {
  EXECUTING_FIRM = '1',
  CLEARING_FIRM = '2',
  CLIENT_ID = '3'
}

// Default connection parameters
export const DEFAULT_CONNECTION = {
  VERSION: 'FIXT.1.1',
  ENCRYPT_METHOD: '0',
  HEARTBEAT_INTERVAL: '30',
  RESET_SEQ_NUM: 'Y',
  DEFAULT_APPL_VER_ID: '9',
  DEFAULT_CSTM_APPL_VER_ID: 'FIX5.00_PSX_1.00'
}; 