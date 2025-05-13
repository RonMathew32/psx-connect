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
var FieldTag;
(function (FieldTag) {
    FieldTag["BEGIN_STRING"] = "8";
    FieldTag["BODY_LENGTH"] = "9";
    FieldTag["MSG_TYPE"] = "35";
    FieldTag["SENDER_COMP_ID"] = "49";
    FieldTag["TARGET_COMP_ID"] = "56";
    FieldTag["MSG_SEQ_NUM"] = "34";
    FieldTag["SENDING_TIME"] = "52";
    FieldTag["CHECK_SUM"] = "10";
    FieldTag["TEXT"] = "58";
    FieldTag["TEST_REQ_ID"] = "112";
    FieldTag["ENCRYPT_METHOD"] = "98";
    FieldTag["HEART_BT_INT"] = "108";
    FieldTag["RESET_SEQ_NUM_FLAG"] = "141";
    FieldTag["USERNAME"] = "553";
    FieldTag["PASSWORD"] = "554";
    FieldTag["DEFAULT_APPL_VER_ID"] = "1137";
    FieldTag["POSS_DUP_FLAG"] = "43";
    FieldTag["REF_SEQ_NUM"] = "45";
    FieldTag["REF_TAG_ID"] = "371";
    FieldTag["TRAD_SES_REQ_ID"] = "335";
    FieldTag["TRADING_SESSION_ID"] = "336";
    FieldTag["TRADING_SESSION_SUB_ID"] = "625";
    FieldTag["TRAD_SES_STATUS"] = "340";
    FieldTag["START_TIME"] = "341";
    FieldTag["END_TIME"] = "342";
    FieldTag["SYMBOL"] = "55";
    FieldTag["SECURITY_REQ_ID"] = "320";
    FieldTag["SECURITY_LIST_REQUEST_TYPE"] = "559";
    FieldTag["SECURITY_TYPE"] = "167";
    FieldTag["SECURITY_DESC"] = "107";
    FieldTag["MD_REQ_ID"] = "262";
    FieldTag["MARKET_DEPTH"] = "264";
    FieldTag["MD_UPDATE_TYPE"] = "265";
    FieldTag["NO_RELATED_SYM"] = "146";
    FieldTag["NO_MD_ENTRY_TYPES"] = "267";
    FieldTag["MD_ENTRY_TYPE"] = "269";
    FieldTag["NO_MD_ENTRIES"] = "268";
    FieldTag["MD_ENTRY_PX"] = "270";
    FieldTag["MD_ENTRY_SIZE"] = "271";
    FieldTag["SUBSCRIPTION_REQUEST_TYPE"] = "263";
    FieldTag["MD_ENTRY_DATE"] = "272";
    FieldTag["MD_ENTRY_TIME"] = "273";
    FieldTag["RAW_DATA"] = "96";
    FieldTag["RAW_DATA_LENGTH"] = "95";
    FieldTag["MD_ENTRY_POSITION_NO"] = "290";
    FieldTag["TOT_NO_RELATED_SYM"] = "393";
    FieldTag["MD_REPORT_ID"] = "963";
    FieldTag["SECURITY_STATUS_REQ_ID"] = "324";
    FieldTag["SECURITY_STATUS"] = "965";
    FieldTag["SECURITY_TRADING_STATUS"] = "326";
    FieldTag["HALT_REASON"] = "327";
    FieldTag["MARKET_ID"] = "1301";
    FieldTag["MD_REJECT_REASON"] = "816";
    FieldTag["PREV_CLOSE_PX"] = "140";
    FieldTag["TOTAL_VOLUME_TRADED"] = "387";
    FieldTag["ORIG_TIME"] = "42";
    FieldTag["NO_ORDERS"] = "73";
    FieldTag["ORDER_QTY"] = "38";
    FieldTag["ORDER_ID"] = "37";
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
// Default connection parameters
exports.DEFAULT_CONNECTION = {
    VERSION: 'FIXT.1.1',
    ENCRYPT_METHOD: '0',
    HEARTBEAT_INTERVAL: '30',
    RESET_SEQ_NUM: 'Y'
};
