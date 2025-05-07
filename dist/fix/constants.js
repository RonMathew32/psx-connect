"use strict";
/**
 * FIX protocol constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONNECTION = exports.SecurityType = exports.SecurityListRequestType = exports.MDUpdateType = exports.MDEntryType = exports.SubscriptionRequestType = exports.FieldTag = exports.MessageType = exports.SOH = void 0;
// Standard FIX delimiter - SOH (Start of Header) character (ASCII 1)
exports.SOH = String.fromCharCode(1);
/**
 * FIX message types
 */
var MessageType;
(function (MessageType) {
    MessageType["HEARTBEAT"] = "0";
    MessageType["TEST_REQUEST"] = "1";
    MessageType["RESEND_REQUEST"] = "2";
    MessageType["REJECT"] = "3";
    MessageType["SEQUENCE_RESET"] = "4";
    MessageType["LOGOUT"] = "5";
    MessageType["LOGON"] = "A";
    MessageType["NEWS"] = "B";
    MessageType["EMAIL"] = "C";
    MessageType["NEW_ORDER_SINGLE"] = "D";
    MessageType["EXECUTION_REPORT"] = "8";
    MessageType["ORDER_CANCEL_REJECT"] = "9";
    MessageType["MARKET_DATA_REQUEST"] = "V";
    MessageType["MARKET_DATA_SNAPSHOT_FULL_REFRESH"] = "W";
    MessageType["MARKET_DATA_INCREMENTAL_REFRESH"] = "X";
    MessageType["SECURITY_LIST_REQUEST"] = "x";
    MessageType["SECURITY_LIST"] = "y";
    MessageType["TRADING_SESSION_STATUS_REQUEST"] = "g";
    MessageType["TRADING_SESSION_STATUS"] = "h";
})(MessageType || (exports.MessageType = MessageType = {}));
/**
 * FIX field tags
 */
exports.FieldTag = {
    BEGIN_STRING: '8',
    BODY_LENGTH: '9',
    MSG_TYPE: '35',
    SENDER_COMP_ID: '49',
    TARGET_COMP_ID: '56',
    MSG_SEQ_NUM: '34',
    SENDING_TIME: '52',
    CHECK_SUM: '10',
    TEXT: '58',
    TEST_REQ_ID: '112',
    ENCRYPT_METHOD: '98',
    HEART_BT_INT: '108',
    RESET_SEQ_NUM_FLAG: '141',
    USERNAME: '553',
    PASSWORD: '554',
    //Real-time Market Data
    ORIG_TIME: '42',
    MD_REPORT_ID: '1500',
    PREV_CLOSE_PX: '140',
    TOTAL_VOLUME_TRADED: '387',
    NO_MD_ENTRIES: '268',
    NO_ORDERS: '73',
    ORDER_QTY: '38',
    ORDER_ID: '37',
    // Additional field tags needed by the application
    DEFAULT_APPL_VER_ID: '1137',
    DEFAULT_CSTM_APPL_VER_ID: '1129',
    MD_REQ_ID: '262',
    SUBSCRIPTION_REQUEST_TYPE: '263',
    MARKET_DEPTH: '264',
    MD_UPDATE_TYPE: '265',
    NO_MD_ENTRY_TYPES: '267',
    MD_ENTRY_TYPE: '269',
    MD_ENTRY_PX: '270', // Market Data Entry Price
    MD_ENTRY_SIZE: '271', // Market Data Entry Size
    MD_REJECT_REASON: '281', // Market Data Reject Reason
    NO_RELATED_SYM: '146',
    SYMBOL: '55',
    SECURITY_LIST_REQUEST_TYPE: '559',
    SECURITY_REQ_ID: '320',
    SECURITY_STATUS_REQ_ID: '324', // Security Status Request ID
    SECURITY_TYPE: '167',
    SECURITY_DESC: '107', // Security Description
    TRADING_SESSION_ID: '336',
    TRAD_SES_REQ_ID: '335',
    TRAD_SES_STATUS: '340', // Trading Session Status
    START_TIME: '341', // Start Time
    END_TIME: '342', // End Time
    ON_BEHALF_OF_COMP_ID: '115',
    RAW_DATA: '96',
    RAW_DATA_LENGTH: '95',
    REF_SEQ_NUM: '45',
    REF_TAG_ID: '373',
    MARKET_ID: '10201'
};
// Subscription Request Types
var SubscriptionRequestType;
(function (SubscriptionRequestType) {
    SubscriptionRequestType["SNAPSHOT"] = "0";
    SubscriptionRequestType["SNAPSHOT_PLUS_UPDATES"] = "1";
    SubscriptionRequestType["DISABLE_PREVIOUS_SNAPSHOT_PLUS_UPDATE_REQUEST"] = "2";
})(SubscriptionRequestType || (exports.SubscriptionRequestType = SubscriptionRequestType = {}));
// Market Data Entry Types
var MDEntryType;
(function (MDEntryType) {
    MDEntryType["BID"] = "0";
    MDEntryType["OFFER"] = "1";
    MDEntryType["TRADE"] = "2";
    MDEntryType["INDEX_VALUE"] = "3";
    MDEntryType["OPENING_PRICE"] = "4";
    MDEntryType["CLOSING_PRICE"] = "5";
    MDEntryType["SETTLEMENT_PRICE"] = "6";
    MDEntryType["TRADING_SESSION_HIGH_PRICE"] = "7";
    MDEntryType["TRADING_SESSION_LOW_PRICE"] = "8";
    MDEntryType["TRADING_SESSION_VWAP_PRICE"] = "9";
})(MDEntryType || (exports.MDEntryType = MDEntryType = {}));
// Market Data Update Types
var MDUpdateType;
(function (MDUpdateType) {
    MDUpdateType["FULL_REFRESH"] = "0";
    MDUpdateType["INCREMENTAL_REFRESH"] = "1";
})(MDUpdateType || (exports.MDUpdateType = MDUpdateType = {}));
// Security List Request Types
var SecurityListRequestType;
(function (SecurityListRequestType) {
    SecurityListRequestType["ALL_SECURITIES"] = "0";
    SecurityListRequestType["PRODUCT"] = "1";
    SecurityListRequestType["TRADING_STATUS"] = "2";
    SecurityListRequestType["ALL_SECURITIES_IN_CATEGORY"] = "3";
})(SecurityListRequestType || (exports.SecurityListRequestType = SecurityListRequestType = {}));
// Security Types
var SecurityType;
(function (SecurityType) {
    SecurityType["COMMON_STOCK"] = "CS";
    SecurityType["PREFERRED_STOCK"] = "PS";
    SecurityType["FUTURE"] = "FUT";
    SecurityType["OPTION"] = "OPT";
    SecurityType["BOND"] = "BOND";
})(SecurityType || (exports.SecurityType = SecurityType = {}));
// Default connection parameters
exports.DEFAULT_CONNECTION = {
    VERSION: 'FIXT.1.1',
    ENCRYPT_METHOD: '0',
    HEARTBEAT_INTERVAL: '30',
    RESET_SEQ_NUM: 'Y'
};
