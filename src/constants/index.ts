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
  SECURITY_LIST_REQUEST = 'x',
  SECURITY_LIST = 'y',
  TRADING_SESSION_STATUS_REQUEST = 'g',
  TRADING_SESSION_STATUS = 'h',
  MARKET_DATA_REQUEST_REJECT = 'Y'  // Added PKF-50 specific
}

/**
 * FIX field tags
 */
export enum FieldTag {
  BEGIN_STRING = '8',
  BODY_LENGTH = '9',
  MSG_TYPE = '35',
  SENDER_COMP_ID = '49',
  TARGET_COMP_ID = '56',
  MSG_SEQ_NUM = '34',
  SENDING_TIME = '52',
  CHECK_SUM = '10',
  TEXT = '58',
  TEST_REQ_ID = '112',
  ENCRYPT_METHOD = '98',
  HEART_BT_INT = '108',
  RESET_SEQ_NUM_FLAG = '141',
  USERNAME = '553',
  PASSWORD = '554',
  DEFAULT_APPL_VER_ID = '1137',
  POSS_DUP_FLAG = '43',
  REF_SEQ_NUM = '45',
  REF_TAG_ID = '371',
  TRAD_SES_REQ_ID = '335',
  TRADING_SESSION_ID = '336',
  TRADING_SESSION_SUB_ID = '625',
  TRAD_SES_STATUS = '340',
  START_TIME = '341',
  END_TIME = '342',
  SYMBOL = '55',
  SECURITY_REQ_ID = '320',
  SECURITY_LIST_REQUEST_TYPE = '559',
  SECURITY_TYPE = '167',
  SECURITY_DESC = '107',
  MD_REQ_ID = '262',
  MARKET_DEPTH = '264',
  MD_UPDATE_TYPE = '265',
  NO_RELATED_SYM = '146',
  NO_MD_ENTRY_TYPES = '267',
  MD_ENTRY_TYPE = '269',
  NO_MD_ENTRIES = '268',
  MD_ENTRY_PX = '270',
  MD_ENTRY_SIZE = '271',
  SUBSCRIPTION_REQUEST_TYPE = '263',
  MD_ENTRY_DATE = '272',
  MD_ENTRY_TIME = '273',
  RAW_DATA = '96',
  RAW_DATA_LENGTH = '95',
  MD_ENTRY_POSITION_NO = '290',
  TOT_NO_RELATED_SYM = '393',
  MD_REPORT_ID = '963',
  SECURITY_STATUS_REQ_ID = '324',
  SECURITY_STATUS = '965',
  SECURITY_TRADING_STATUS = '326',
  HALT_REASON = '327',
  MARKET_ID = '1301',
  MD_REJECT_REASON = '816',
  PREV_CLOSE_PX = '140',
  TOTAL_VOLUME_TRADED = '387',
  ORIG_TIME = '42',
  NO_ORDERS = '73',
  ORDER_QTY = '38',
  ORDER_ID = '37',
  NO_SECURITIES = '393',  // Number of securities in a security list response, same as TOT_NO_RELATED_SYM
  PRODUCT = '460',        // Added for PKF-50
  DEFAULT_CSTM_APPL_VER_ID = '1408',  // Added for PKF-50
  NO_PARTY_IDS = '453',   // Added for PKF-50
  PARTY_ID = '448',       // Added for PKF-50
  PARTY_ID_SOURCE = '447', // Added for PKF-50
  PARTY_ROLE = '452'      // Added for PKF-50
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

// PKF-50 Specific Product Types
export enum ProductType {
  EQUITY = '4',
  INDEX = '5'
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