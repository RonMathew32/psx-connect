// SOH (Start of Header) character used as field separator in FIX messages
export const SOH = '\x01';

// Default connection settings for FIX protocol
export const DEFAULT_CONNECTION = {
  ENCRYPT_METHOD: '0', // No encryption
  RESET_SEQ_NUM: 'Y',  // Reset sequence numbers on logon
  DEFAULT_APPL_VER_ID: 'FIX.4.4',
  DEFAULT_CSTM_APPL_VER_ID: 'T4.4',
};

// FIX message types
export const MessageType = {
  HEARTBEAT: '0',
  TEST_REQUEST: '1',
  RESEND_REQUEST: '2',
  REJECT: '3',
  SEQUENCE_RESET: '4',
  LOGOUT: '5',
  LOGON: 'A',
  NEWS: 'B',
  EMAIL: 'C',
  NEW_ORDER_SINGLE: 'D',
  EXECUTION_REPORT: '8',
  ORDER_CANCEL_REJECT: '9',
  MARKET_DATA_REQUEST: 'V',
  MARKET_DATA_SNAPSHOT_FULL_REFRESH: 'W',
  MARKET_DATA_INCREMENTAL_REFRESH: 'X',
  MARKET_DATA_REQUEST_REJECT: 'Y',
  SECURITY_LIST: 'y',
  SECURITY_LIST_REQUEST: 'x',
  SECURITY_STATUS: 'f',
  TRADING_SESSION_STATUS: 'h',
  TRADING_SESSION_STATUS_REQUEST: 'g',
};

// FIX field tags
export const FieldTag = {
  // Header fields
  BEGIN_STRING: '8',
  BODY_LENGTH: '9',
  MSG_TYPE: '35',
  SENDER_COMP_ID: '49',
  TARGET_COMP_ID: '56',
  MSG_SEQ_NUM: '34',
  POSS_DUP_FLAG: '43',
  POSS_RESEND: '97',
  SENDING_TIME: '52',
  ORIG_SENDING_TIME: '122',
  
  // Common fields
  TEXT: '58',
  USERNAME: '553',
  PASSWORD: '554',
  ENCRYPT_METHOD: '98',
  HEART_BT_INT: '108',
  RESET_SEQ_NUM_FLAG: '141',
  DEFAULT_APPL_VER_ID: '1137',
  DEFAULT_CSTM_APPL_VER_ID: '10335',
  TEST_REQ_ID: '112',
  CHECK_SUM: '10',
  
  // Market data fields
  MD_REQ_ID: '262',
  SUBSCRIPTION_REQ_TYPE: '263',
  MARKET_DEPTH: '264',
  MD_UPDATE_TYPE: '265',
  NO_MD_ENTRY_TYPES: '267',
  NO_MD_ENTRIES: '268',
  MD_ENTRY_TYPE: '269',
  MD_ENTRY_PX: '270',
  MD_ENTRY_SIZE: '271',
  MD_ENTRY_DATE: '272',
  MD_ENTRY_TIME: '273',
  MD_REQ_REJ_REASON: '281',
  
  // Security fields
  SYMBOL: '55',
  SECURITY_ID: '48',
  SECURITY_DESC: '107',
  CFI_CODE: '461',
  ISSUER: '106',
  SECURITY_ID_SOURCE: '22',
  SECURITY_TYPE: '167',
  TRADING_SESSION_ID: '336',
  LAST_FRAGMENT: '893',
  SECURITY_REQ_ID: '320',
  NO_RELATED_SYM: '146',
  CURRENCY: '15',
  ISIN: '48',
  
  // Order fields
  ORDER_ID: '37',
  ORDER_QTY: '38',
  ORD_TYPE: '40',
  REF_SEQ_NUM: '45',
  REF_TAG_ID: '371',
  
  // Additional fields
  CHANNEL_NO: '10201',
  ORIG_TIME: '42',
  
  // Fields from snapshot data specification
  MD_STREAM_ID: '1500',
  TRADING_PHASE_CODE: '8538',
  PREV_CLOSE_PX: '140',
  NUM_TRADES: '8503',
  TOTAL_VOLUME_TRADE: '387',
  TOTAL_VALUE_TRADE: '8504',
  NO_ORDERS: '73',
  MD_PRICE_LEVEL: '1023',
  NUMBER_OF_ORDERS: '346',
  URGENCY: '61',
  HEADLINE: '148',
}; 