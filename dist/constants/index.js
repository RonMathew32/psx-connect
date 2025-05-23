"use strict";
/**
 * FIX protocol constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONNECTION = exports.PartyRole = exports.ProductType = exports.SecurityType = exports.SecurityListRequestType = exports.MDUpdateType = exports.MDEntryType = exports.SubscriptionRequestType = exports.FieldTag = exports.MessageType = exports.SOH = void 0;
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
    MessageType["MARKET_DATA_REQUEST_REJECT"] = "Y";
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
    FieldTag["CHECK_SUM"] = "10";
    FieldTag["CURRENCY"] = "15";
    FieldTag["ORDER_ID"] = "37";
    FieldTag["ORDER_QTY"] = "38";
    FieldTag["ORIG_TIME"] = "42";
    FieldTag["POSS_DUP_FLAG"] = "43";
    FieldTag["REF_SEQ_NUM"] = "45";
    FieldTag["ISIN"] = "48";
    FieldTag["SECURITY_ID"] = "48";
    FieldTag["SENDER_COMP_ID"] = "49";
    FieldTag["SENDING_TIME"] = "52";
    FieldTag["SYMBOL"] = "55";
    FieldTag["TEXT"] = "58";
    FieldTag["TARGET_COMP_ID"] = "56";
    FieldTag["NO_ORDERS"] = "73";
    FieldTag["RAW_DATA_LENGTH"] = "95";
    FieldTag["RAW_DATA"] = "96";
    FieldTag["ENCRYPT_METHOD"] = "98";
    FieldTag["ISSUER"] = "106";
    FieldTag["SECURITY_DESC"] = "107";
    FieldTag["HEART_BT_INT"] = "108";
    FieldTag["TEST_REQ_ID"] = "112";
    FieldTag["ON_BEHALF_OF_COMP_ID"] = "115";
    FieldTag["PREV_CLOSE_PX"] = "140";
    FieldTag["RESET_SEQ_NUM_FLAG"] = "141";
    FieldTag["NO_RELATED_SYM"] = "146";
    FieldTag["SECURITY_TYPE"] = "167";
    FieldTag["SECURITY_EXCHANGE"] = "207";
    FieldTag["MD_REQ_ID"] = "262";
    FieldTag["SUBSCRIPTION_REQUEST_TYPE"] = "263";
    FieldTag["MARKET_DEPTH"] = "264";
    FieldTag["MD_UPDATE_TYPE"] = "265";
    FieldTag["NO_MD_ENTRY_TYPES"] = "267";
    FieldTag["NO_MD_ENTRIES"] = "268";
    FieldTag["MD_ENTRY_TYPE"] = "269";
    FieldTag["MD_ENTRY_PX"] = "270";
    FieldTag["MD_ENTRY_SIZE"] = "271";
    FieldTag["MD_ENTRY_DATE"] = "272";
    FieldTag["MD_ENTRY_TIME"] = "273";
    FieldTag["MD_ENTRY_POSITION_NO"] = "290";
    FieldTag["SECURITY_REQ_ID"] = "320";
    FieldTag["SECURITY_STATUS_REQ_ID"] = "324";
    FieldTag["SECURITY_TRADING_STATUS"] = "326";
    FieldTag["HALT_REASON"] = "327";
    FieldTag["MSG_SEQ_NUM"] = "34";
    FieldTag["MSG_TYPE"] = "35";
    FieldTag["TRAD_SES_REQ_ID"] = "335";
    FieldTag["TRADING_SESSION_ID"] = "336";
    FieldTag["TRAD_SES_STATUS"] = "340";
    FieldTag["START_TIME"] = "341";
    FieldTag["END_TIME"] = "342";
    FieldTag["REF_TAG_ID"] = "371";
    FieldTag["TOTAL_VOLUME_TRADED"] = "387";
    FieldTag["TOT_NO_RELATED_SYM"] = "393";
    FieldTag["NO_SECURITIES"] = "393";
    FieldTag["PARTY_ID_SOURCE"] = "447";
    FieldTag["PARTY_ID"] = "448";
    FieldTag["PARTY_ROLE"] = "452";
    FieldTag["NO_PARTY_IDS"] = "453";
    FieldTag["PRODUCT"] = "460";
    FieldTag["CFI_CODE"] = "461";
    FieldTag["USERNAME"] = "553";
    FieldTag["PASSWORD"] = "554";
    FieldTag["SECURITY_LIST_REQUEST_TYPE"] = "559";
    FieldTag["ROUND_LOT"] = "561";
    FieldTag["MIN_TRADE_VOL"] = "562";
    FieldTag["TRADING_SESSION_SUB_ID"] = "625";
    FieldTag["MD_REJECT_REASON"] = "816";
    FieldTag["LAST_FRAGMENT"] = "893";
    FieldTag["MD_REPORT_ID"] = "963";
    FieldTag["SECURITY_STATUS"] = "965";
    FieldTag["APPL_VER_ID"] = "1128";
    FieldTag["DEFAULT_APPL_VER_ID"] = "1137";
    FieldTag["MARKET_ID"] = "1301";
    FieldTag["NO_TRADING_SESSION_RULES"] = "1309";
    FieldTag["TRADING_SESSION_RULES_GROUP"] = "1310";
    FieldTag["DEFAULT_CSTM_APPL_VER_ID"] = "1408"; // Default custom application version ID
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
    SecurityType["BOND"] = "BOND";
    SecurityType["FUTURE"] = "FUT";
    SecurityType["OPTION"] = "OPT";
})(SecurityType || (exports.SecurityType = SecurityType = {}));
// PKF-50 Specific Product Types
var ProductType;
(function (ProductType) {
    ProductType["AGENCY"] = "1";
    ProductType["COMMODITY"] = "2";
    ProductType["CORPORATE"] = "3";
    ProductType["CURRENCY"] = "4";
    ProductType["EQUITY"] = "5";
    ProductType["GOVERNMENT"] = "6";
    ProductType["INDEX"] = "7";
    ProductType["LOAN"] = "8";
    ProductType["MONEYMARKET"] = "9";
    ProductType["MORTGAGE"] = "10";
    ProductType["MUNICIPAL"] = "11";
    ProductType["OTHER"] = "12";
    ProductType["FINANCING"] = "13";
})(ProductType || (exports.ProductType = ProductType = {}));
// PKF-50 Specific Party Roles
var PartyRole;
(function (PartyRole) {
    PartyRole["EXECUTING_FIRM"] = "1";
    PartyRole["CLEARING_FIRM"] = "2";
    PartyRole["CLIENT_ID"] = "3";
})(PartyRole || (exports.PartyRole = PartyRole = {}));
// Default connection parameters
exports.DEFAULT_CONNECTION = {
    VERSION: 'FIXT.1.1',
    ENCRYPT_METHOD: '0',
    HEARTBEAT_INTERVAL: '30',
    RESET_SEQ_NUM: 'Y',
    DEFAULT_APPL_VER_ID: '9',
    DEFAULT_CSTM_APPL_VER_ID: 'FIX5.00_PSX_1.00'
};
