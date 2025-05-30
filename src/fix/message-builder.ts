import { SOH, FieldTag, MessageType, DEFAULT_CONNECTION, ProductType, SecurityType } from '../constants';
import { FixClientOptions } from '../types';
import { SequenceManager } from '../utils/sequence-manager';

// Market codes from specification
export const MarketCode = {
  REGULAR: '01',
  BILLS_AND_BOND: '02',
  STOCK_DELIVERABLE_FUTURE: '03',
  STOCK_OPTION: '05',
  INDEX_OPTION: '06',
  STOCK_INDEX_FUTURE: '07',
  ODD_LOT: '08',
  NEGOTIATED_DEAL: '09',
  EQUITIES_SQUARE_UP: '10',
  FUTURES_SQUARE_UP: '12',
  TRADE_RECTIFICATION: '13'
};

/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * 
 * @returns Current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
 * 
 */
function getCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');

  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());
  const milliseconds = pad(now.getUTCMilliseconds(), 3);

  return `${year}${month}${day}-${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Core message builder interface
 * @param msgType Message type
 * @param senderCompID Sender component ID
 * @param targetCompID Target component ID
 * @param seqNum Message sequence number
 * @param field Tag and value to add to the message
 * @param buildMessage Build the message
 * 
 */
interface MessageBuilder {
  setMsgType(msgType: string): MessageBuilder;
  setSenderCompID(senderCompID: string): MessageBuilder;
  setTargetCompID(targetCompID: string): MessageBuilder;
  setMsgSeqNum(seqNum: number): MessageBuilder;
  addField(tag: string, value: string): MessageBuilder;
  buildMessage(): string;
}

/**
 * Creates a generic FIX message builder
 * 
 * @param beginString Begin string
 * @returns Message builder
 * 
 */
export function createMessageBuilder(beginString: string = 'FIXT.1.1'): MessageBuilder {
  let headerFields: Record<string, string> = {
    [FieldTag.BEGIN_STRING]: beginString,
  };
  let bodyFields: Record<string, string> = {};

  const setMsgType = (msgType: string) => {
    headerFields[FieldTag.MSG_TYPE] = msgType;
    return messageBuilder;
  };

  const setSenderCompID = (senderCompID: string) => {
    headerFields[FieldTag.SENDER_COMP_ID] = senderCompID;
    return messageBuilder;
  };

  const setTargetCompID = (targetCompID: string) => {
    headerFields[FieldTag.TARGET_COMP_ID] = targetCompID;
    return messageBuilder;
  };

  const setMsgSeqNum = (seqNum: number) => {
    headerFields[FieldTag.MSG_SEQ_NUM] = seqNum.toString();
    return messageBuilder;
  };

  const addField = (tag: string, value: string) => {
    bodyFields[tag] = value;
    return messageBuilder;
  };

  const buildMessage = () => {
    if (!headerFields[FieldTag.MSG_TYPE]) {
      throw new Error('Message type is required');
    }

    if (!headerFields[FieldTag.SENDING_TIME]) {
      headerFields[FieldTag.SENDING_TIME] = getCurrentTimestamp();
    }

    const allFields = { ...headerFields, ...bodyFields };

    const sortedTags = Object.keys(allFields).sort((a, b) => {
      const headerOrder: { [key: string]: number } = {
        [FieldTag.BEGIN_STRING]: 1,
        [FieldTag.BODY_LENGTH]: 2,
        [FieldTag.MSG_TYPE]: 3,
        [FieldTag.SENDER_COMP_ID]: 4,
        [FieldTag.TARGET_COMP_ID]: 5,
        [FieldTag.MSG_SEQ_NUM]: 6,
        [FieldTag.SENDING_TIME]: 7,
      };

      if (headerOrder[a] && headerOrder[b]) {
        return headerOrder[a] - headerOrder[b];
      }
      if (headerOrder[a]) return -1;
      if (headerOrder[b]) return 1;
      return parseInt(a) - parseInt(b);
    });

    let bodyContent = '';
    for (const tag of sortedTags) {
      if (tag !== FieldTag.BEGIN_STRING && tag !== FieldTag.BODY_LENGTH) {
        bodyContent += `${tag}=${allFields[tag]}${SOH}`;
      }
    }

    const bodyLength = bodyContent.length;

    let message = `${FieldTag.BEGIN_STRING}=${allFields[FieldTag.BEGIN_STRING]}${SOH}`;
    message += `${FieldTag.BODY_LENGTH}=${bodyLength}${SOH}`;
    message += bodyContent;

    let checksum = 0;
    for (let i = 0; i < message.length; i++) {
      checksum += message.charCodeAt(i);
    }
    checksum = checksum % 256;

    const checksumStr = checksum.toString().padStart(3, '0');
    message += `${FieldTag.CHECK_SUM}=${checksumStr}${SOH}`;

    return message;
  };

  const messageBuilder: MessageBuilder = {
    setMsgType,
    setSenderCompID,
    setTargetCompID,
    setMsgSeqNum,
    addField,
    buildMessage,
  };

  return messageBuilder;
}

/**
 * Creates a Logon message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * 
 */
export function createLogonMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGON)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(1)
    .addField(FieldTag.ENCRYPT_METHOD, DEFAULT_CONNECTION.ENCRYPT_METHOD)
    .addField(FieldTag.HEART_BT_INT, options.heartbeatIntervalSecs.toString())
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, DEFAULT_CONNECTION.RESET_SEQ_NUM)
    .addField(FieldTag.USERNAME, options.username)
    .addField(FieldTag.PASSWORD, options.password)
    .addField(FieldTag.DEFAULT_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)
    .addField(FieldTag.DEFAULT_CSTM_APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_CSTM_APPL_VER_ID);

  return builder;
}

/**
 * Creates a Logout message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param text Text message
 * 
 */
export function createLogoutMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  text?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.LOGOUT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement())
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, DEFAULT_CONNECTION.RESET_SEQ_NUM);

  if (text) {
    builder.addField(FieldTag.TEXT, text);
  }

  return builder;
}

/**
 * Creates a Heartbeat message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param testReqId Test request ID
 * 
 */
export function createHeartbeatMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  testReqId?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement());

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }

  return builder;
}

/**
 * Creates a Test Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param testReqId Test request ID
 * 
 */
export function createTestRequestMessageBuilder(
  options: FixClientOptions,
  testReqId?: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TEST_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .addField(FieldTag.MSG_SEQ_NUM, "2");

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }

  return builder;
}

/**
 * Creates a Resend Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param beginSeqNo Message sequence number of first message in range to be resent
 * @param endSeqNo Message sequence number of last message in range to be resent. 
 *                 Use 0 to request all messages after beginSeqNo.
 */
export function createResendRequestMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  beginSeqNo: number,
  endSeqNo: number
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.RESEND_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement())
    .addField(FieldTag.BEGIN_SEQ_NO, beginSeqNo.toString())
    .addField(FieldTag.END_SEQ_NO, endSeqNo.toString());

  return builder;
}

/**
 * Creates a Sequence Reset message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param newSeqNo New sequence number
 * @param gapFill If true, sets GapFillFlag to 'Y', otherwise 'N' or omitted
 * @returns Message builder for Sequence Reset
 * 
 */
export function createSequenceResetRequestMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  newSeqNo: number,
  gapFill: boolean = false
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SEQUENCE_RESET)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextAndIncrement())
    .addField(FieldTag.NEW_SEQ_NO, newSeqNo.toString());

  // GapFillFlag is optional, include only if specified
  if (gapFill) {
    builder.addField(FieldTag.GAP_FILL_FLAG, DEFAULT_CONNECTION.RESET_SEQ_NUM);
  }

  return builder;
}

/**
 * Creates a Trading Session Status Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param requestId Request ID
 * @param tradingSessionID Trading session ID
 * @returns Message builder for Trading Session Status Request
 * 
 */
export function createTradingSessionStatusRequestBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string,
  tradingSessionID: string = 'REG'
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.TRADING_SESSION_STATUS_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(2)
    .addField(FieldTag.TRAD_SES_REQ_ID, requestId)
    .addField(FieldTag.TRADING_SESSION_ID, tradingSessionID)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, "0")

  return builder;
}

/**
 * Creates a Security Status Request message builder
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param requestId Request ID
 * @param symbol Symbol to request status for
 * @returns Message builder for Security Status Request
 * 
 */
export function createSecurityStatusRequestBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string,
  symbol: string = "NA"
): MessageBuilder {
  // Current timestamp in FIX format (YYYYMMDD-HH:MM:SS)
  const now = new Date();
  const origTime = now.toISOString().replace(/[-T:Z.]/g, '').substring(0, 8) + '-' + 
                  now.toISOString().substring(11, 19).replace(/:/g, '');
  
  // Build a message with fields from the specification
  const builder = createMessageBuilder()
    .setMsgType('f')  // Security Status message type
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(2)
    // Add the required fields from the specification
    .addField(FieldTag.ORIG_TIME, origTime)                 // Tag 42: OrigTime
    .addField(FieldTag.CHANNEL_NO, '1')                     // Tag 10201: ChannelNo
    .addField(FieldTag.SYMBOL, symbol)                      // Tag 55: Symbol
    .addField(FieldTag.SECURITY_SWITCH_TYPE, '1')           // Tag 10203: SecuritySwitchType
    .addField(FieldTag.SECURITY_SWITCH_STATUS, 'Y');        // Tag 10204: SecuritySwitchStatus (Y=OPEN)

  return builder;
}

/**
 * Creates a Market Data Request message builder
 */
export function createMarketDataRequestBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  symbols: string[],
  entryTypes: string[] = ['0', '1', '2', '3', '5', '6', '7', '8', '9', 'B'],
  subscriptionType: string = '1',
  requestId: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .addField(FieldTag.MSG_SEQ_NUM, "2")
    .addField(FieldTag.MD_REQ_ID, requestId)
    .addField(FieldTag.MARKET_DEPTH, '0')
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
    .addField(FieldTag.MD_UPDATE_TYPE, '0')
    .addField(FieldTag.SYMBOL, 'NA')
    .addField(FieldTag.NO_RELATED_SYM, symbols.length.toString())
    .addField(FieldTag.NO_TRADING_SESSION, '1')
    .addField(FieldTag.TRADING_SESSION_ID, 'FUT');

  // .addField(FieldTag.NO_PARTY_IDS, '1')
  // .addField(FieldTag.PARTY_ID, options.partyId || options.senderCompId)
  // .addField(FieldTag.PARTY_ID_SOURCE, 'D')
  // .addField(FieldTag.PARTY_ROLE, '3')

  builder.addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());
  for (const entryType of entryTypes) {
    builder.addField(FieldTag.MD_ENTRY_TYPE, entryType);
  }

  return builder;
}


/**
 * Creates a Security List Request message builder for REG Equity
 */
export function createSecurityListRequestForREGEquityBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string
): MessageBuilder {
  return createMessageBuilder()
  .setMsgType(MessageType.SECURITY_LIST_REQUEST)
  .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
  .setSenderCompID(options.senderCompId)
  .setTargetCompID(options.targetCompId)
  .addField(FieldTag.TRANSACT_TIME, getCurrentTimestamp())
  .addField("15", "008")
  .addField(FieldTag.SYMBOL, "NA")
  .addField(FieldTag.SECURITY_REQ_ID, requestId)
  .addField(FieldTag.TRADING_SESSION_ID, "REG")
  .addField(FieldTag.PRODUCT, "5")
  .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
  .addField(FieldTag.APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)                          // TradingSessionID
}

/**
 * Creates a Security List Request message builder for FUT Equity
 */
export function createSecurityListRequestForFutEquityBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string
): MessageBuilder {
  // Build a message with an exact sequence of fields that matches a previously successful message
  const builder = createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST)
    .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .addField(FieldTag.TRANSACT_TIME, getCurrentTimestamp())
    .addField("15", "008")
    .addField(FieldTag.SYMBOL, "UPP9")
    .addField(FieldTag.SECURITY_REQ_ID, requestId)
    .addField(FieldTag.TRADING_SESSION_ID, "FUT")
    .addField(FieldTag.PRODUCT, "5")
    .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
    .addField(FieldTag.APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)

  return builder;
}

/**
 * Creates a Security List Request message builder for REG Index
 */
export function createSecurityListRequestForRegIndexBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string
): MessageBuilder {
  const builder = createMessageBuilder()
  .setMsgType(MessageType.SECURITY_LIST_REQUEST)
  .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement())
  .setSenderCompID(options.senderCompId)
  .setTargetCompID(options.targetCompId)
  .addField(FieldTag.TRANSACT_TIME, getCurrentTimestamp())
  .addField("15", "008")
  .addField(FieldTag.SYMBOL, "UPP9")
  .addField(FieldTag.SECURITY_REQ_ID, requestId)
  .addField(FieldTag.TRADING_SESSION_ID, "REG")
  .addField(FieldTag.PRODUCT, "4")
  .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, "0")
  .addField(FieldTag.APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)

  return builder;
}

/**
 * Creates a Security List Request message builder for FUT Index
 */
export function createSecurityListRequestForFutIndexBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  requestId: string
): MessageBuilder {
  return createMessageBuilder()
    .setMsgType(MessageType.SECURITY_LIST_REQUEST) // Message Type
    .setSenderCompID(options.senderCompId) // Sender Comp ID
    .setTargetCompID(options.targetCompId) // Target Comp ID
    .setMsgSeqNum(sequenceManager.getNextSecurityListAndIncrement()) // Sequence number
    .addField(FieldTag.SECURITY_REQ_ID, requestId) // Security Request ID
    .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, '4') // 4 = All Securities
    .addField(FieldTag.SYMBOL, 'NA')                   // Symbol is required
    .addField(FieldTag.PRODUCT, ProductType.INDEX)                   // 4 = EQUITY as in fixpkf-50
    .addField(FieldTag.SECURITY_TYPE, SecurityType.FUTURE)      // FUT session
    .addField(FieldTag.SECURITY_EXCHANGE, 'PSX')                           // SecurityExchange = Pakistan Stock Exchange
    .addField(FieldTag.APPL_VER_ID, DEFAULT_CONNECTION.DEFAULT_APPL_VER_ID)
}

/**
 * Creates an Index Market Data Request message builder
 */
export function createIndexMarketDataRequestBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  symbols: string[],
  requestId: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextMarketDataAndIncrement())
    .addField(FieldTag.MD_REQ_ID, requestId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '0')
    .addField(FieldTag.MARKET_DEPTH, '0')
    .addField(FieldTag.MD_UPDATE_TYPE, '0')
    .addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());

  symbols.forEach(symbol => {
    builder.addField(FieldTag.SYMBOL, symbol);
  });

  builder
    .addField(FieldTag.NO_MD_ENTRY_TYPES, '1')
    .addField(FieldTag.MD_ENTRY_TYPE, '3');

  return builder;
}

/**
 * Creates a Symbol Market Data Subscription message builder
 */
export function createSymbolMarketDataSubscriptionBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  symbols: string[],
  requestId: string
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.MARKET_DATA_REQUEST)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(sequenceManager.getNextMarketDataAndIncrement())
    .addField(FieldTag.MD_REQ_ID, requestId)
    .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, '1')
    .addField(FieldTag.MARKET_DEPTH, '0')
    .addField(FieldTag.MD_UPDATE_TYPE, '0')
    .addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());

  symbols.forEach(symbol => {
    builder.addField(FieldTag.SYMBOL, symbol);
  });

  builder
    .addField(FieldTag.NO_MD_ENTRY_TYPES, '3')
    .addField(FieldTag.MD_ENTRY_TYPE, '0')
    .addField(FieldTag.MD_ENTRY_TYPE, '1')
    .addField(FieldTag.MD_ENTRY_TYPE, '2');

  return builder;
}

/**
 * Creates a News message builder
 * 
 * The News (B) message is a general free format message used for abnormal situations.
 * 
 * @param options Fix client options
 * @param sequenceManager Sequence manager
 * @param headline News headline
 * @param text News text body
 * @param origTime Message originating time (optional, defaults to current time)
 * @param urgency News urgency (optional, defaults to '1' Flash)
 * @returns Message builder for News message
 */
export function createNewsMessageBuilder(
  options: FixClientOptions,
  sequenceManager: SequenceManager,
  headline: string,
  text: string,
  origTime?: string,
  urgency: string = '1'
): MessageBuilder {
  const builder = createMessageBuilder()
    .setMsgType(MessageType.NEWS)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .addField(FieldTag.MSG_SEQ_NUM, "2")
    .addField(FieldTag.HEADLINE, headline)
    .addField(FieldTag.URGENCY, urgency)
    .addField(FieldTag.LINES_OF_TEXT, '1') // Just using 1 line of text for simplicity
    .addField(FieldTag.TEXT, text);

  // Add origination time if provided, otherwise it will use the standard sending time
  if (origTime) {
    builder.addField(FieldTag.ORIG_TIME, origTime);
  }

  return builder;
}

export function getMessageTypeName(msgType: string): string {
  // Find the message type name by its value
  for (const [name, value] of Object.entries(MessageType)) {
    if (value === msgType) {
      return name;
    }
  }
  return 'UNKNOWN';
} 