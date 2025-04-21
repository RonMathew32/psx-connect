"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONNECTION = exports.SOH = exports.SecurityType = exports.SecurityListRequestType = exports.MDUpdateType = exports.MDEntryType = exports.SubscriptionRequestType = exports.FieldTag = exports.MessageType = void 0;
// FIX Message Types
var MessageType;
(function (MessageType) {
    MessageType["HEARTBEAT"] = "0";
    MessageType["TEST_REQUEST"] = "1";
    MessageType["RESEND_REQUEST"] = "2";
    MessageType["REJECT"] = "3";
    MessageType["SEQUENCE_RESET"] = "4";
    MessageType["LOGOUT"] = "5";
    MessageType["LOGON"] = "A";
    MessageType["MARKET_DATA_REQUEST"] = "V";
    MessageType["MARKET_DATA_SNAPSHOT_FULL_REFRESH"] = "W";
    MessageType["MARKET_DATA_INCREMENTAL_REFRESH"] = "X";
    MessageType["SECURITY_LIST_REQUEST"] = "x";
    MessageType["SECURITY_LIST"] = "y";
    MessageType["TRADING_SESSION_STATUS_REQUEST"] = "g";
    MessageType["TRADING_SESSION_STATUS"] = "h";
})(MessageType || (exports.MessageType = MessageType = {}));
// FIX Field Tags
var FieldTag;
(function (FieldTag) {
    FieldTag[FieldTag["BEGIN_STRING"] = 8] = "BEGIN_STRING";
    FieldTag[FieldTag["BODY_LENGTH"] = 9] = "BODY_LENGTH";
    FieldTag[FieldTag["MSG_TYPE"] = 35] = "MSG_TYPE";
    FieldTag[FieldTag["SENDER_COMP_ID"] = 49] = "SENDER_COMP_ID";
    FieldTag[FieldTag["TARGET_COMP_ID"] = 56] = "TARGET_COMP_ID";
    FieldTag[FieldTag["MSG_SEQ_NUM"] = 34] = "MSG_SEQ_NUM";
    FieldTag[FieldTag["SENDING_TIME"] = 52] = "SENDING_TIME";
    FieldTag[FieldTag["ENCRYPT_METHOD"] = 98] = "ENCRYPT_METHOD";
    FieldTag[FieldTag["HEART_BT_INT"] = 108] = "HEART_BT_INT";
    FieldTag[FieldTag["RESET_SEQ_NUM_FLAG"] = 141] = "RESET_SEQ_NUM_FLAG";
    FieldTag[FieldTag["USERNAME"] = 553] = "USERNAME";
    FieldTag[FieldTag["PASSWORD"] = 554] = "PASSWORD";
    FieldTag[FieldTag["ON_BEHALF_OF_COMP_ID"] = 115] = "ON_BEHALF_OF_COMP_ID";
    FieldTag[FieldTag["RAW_DATA"] = 96] = "RAW_DATA";
    FieldTag[FieldTag["RAW_DATA_LENGTH"] = 95] = "RAW_DATA_LENGTH";
    FieldTag[FieldTag["DEFAULT_APPL_VER_ID"] = 1137] = "DEFAULT_APPL_VER_ID";
    FieldTag[FieldTag["DEFAULT_CSTM_APPL_VER_ID"] = 1129] = "DEFAULT_CSTM_APPL_VER_ID";
    FieldTag[FieldTag["TEST_REQ_ID"] = 112] = "TEST_REQ_ID";
    FieldTag[FieldTag["CHECK_SUM"] = 10] = "CHECK_SUM";
    FieldTag[FieldTag["MD_REQ_ID"] = 262] = "MD_REQ_ID";
    FieldTag[FieldTag["SUBSCRIPTION_REQUEST_TYPE"] = 263] = "SUBSCRIPTION_REQUEST_TYPE";
    FieldTag[FieldTag["MARKET_DEPTH"] = 264] = "MARKET_DEPTH";
    FieldTag[FieldTag["MD_UPDATE_TYPE"] = 265] = "MD_UPDATE_TYPE";
    FieldTag[FieldTag["NO_MD_ENTRY_TYPES"] = 267] = "NO_MD_ENTRY_TYPES";
    FieldTag[FieldTag["NO_RELATED_SYM"] = 146] = "NO_RELATED_SYM";
    FieldTag[FieldTag["SECURITY_LIST_REQUEST_TYPE"] = 559] = "SECURITY_LIST_REQUEST_TYPE";
    FieldTag[FieldTag["SECURITY_TYPE"] = 167] = "SECURITY_TYPE";
    FieldTag[FieldTag["SYMBOL"] = 55] = "SYMBOL";
    FieldTag[FieldTag["MD_ENTRY_TYPE"] = 269] = "MD_ENTRY_TYPE";
    FieldTag[FieldTag["TRADING_SESSION_ID"] = 336] = "TRADING_SESSION_ID";
})(FieldTag || (exports.FieldTag = FieldTag = {}));
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
// Delimiter
exports.SOH = String.fromCharCode(1); // ASCII code 1 (Start of Heading)
// Default connection parameters
exports.DEFAULT_CONNECTION = {
    VERSION: 'FIXT.1.1',
    ENCRYPT_METHOD: '0',
    HEARTBEAT_INTERVAL: '30',
    RESET_SEQ_NUM: 'Y'
};
