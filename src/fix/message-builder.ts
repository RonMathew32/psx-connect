import { SOH, MessageType, FieldTag, DEFAULT_CONNECTION, SecurityListRequestType } from './constants';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';

interface Field {
  tag: number;
  value: string;
}

export class FixMessageBuilder {
  private fields: Field[] = [];
  private beginString: string;
  private msgSeqNum: number = 1;

  constructor(beginString: string = DEFAULT_CONNECTION.VERSION) {
    this.beginString = beginString;
  }

  /**
   * Add a field to the message
   */
  addField(tag: number, value: string): FixMessageBuilder {
    this.fields.push({ tag, value });
    return this;
  }

  /**
   * Get the current message sequence number
   */
  getSeqNum(): number {
    return this.msgSeqNum;
  }

  /**
   * Set the message sequence number
   */
  setSeqNum(seqNum: number): FixMessageBuilder {
    this.msgSeqNum = seqNum;
    return this;
  }

  /**
   * Increment the message sequence number
   */
  incrementSeqNum(): FixMessageBuilder {
    this.msgSeqNum++;
    return this;
  }

  /**
   * Calculate the checksum for a message
   */
  private calculateChecksum(message: string): string {
    let sum = 0;
    for (let i = 0; i < message.length; i++) {
      sum += message.charCodeAt(i);
    }
    return (sum % 256).toString().padStart(3, '0');
  }

  /**
   * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
   */
  static getCurrentTimestamp(): string {
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
   * Format a timestamp for FIX messages
   */
  private formatTimestamp(): string {
    return FixMessageBuilder.getCurrentTimestamp();
  }

  /**
   * Build the message into a string
   */
  build(): string {
    // Sort fields to ensure consistent order
    this.fields.sort((a, b) => a.tag - b.tag);

    // Add required message fields if they're not already added
    const hasField = (tag: number) => this.fields.some(field => field.tag === tag);

    if (!hasField(FieldTag.MSG_SEQ_NUM)) {
      this.addField(FieldTag.MSG_SEQ_NUM, this.msgSeqNum.toString());
    }

    if (!hasField(FieldTag.SENDING_TIME)) {
      this.addField(FieldTag.SENDING_TIME, this.formatTimestamp());
    }

    // Join all fields except header and trailer
    const body = this.fields
      .map(field => `${field.tag}=${field.value}`)
      .join(SOH);

    // Calculate body length (length of the body plus the SOH after each field)
    const bodyLength = body.length + this.fields.length - 1;

    // Create the message
    const message = `${FieldTag.BEGIN_STRING}=${this.beginString}${SOH}${FieldTag.BODY_LENGTH}=${bodyLength}${SOH}${body}${SOH}`;

    // Calculate checksum
    const checksum = this.calculateChecksum(message);

    // Return the complete message
    return `${message}${FieldTag.CHECK_SUM}=${checksum}${SOH}`;
  }

  /**
   * Create a logon message
   */
  static createLogonMessage(
    senderCompId: string,
    targetCompId: string,
    username: string,
    password: string,
    resetSeqNum: boolean = true,
    heartBtInt: number = 30
  ): string {
    return new FixMessageBuilder()
    .addField(FieldTag.MSG_TYPE, MessageType.LOGON)
    .addField(FieldTag.SENDER_COMP_ID, senderCompId)
    .addField(FieldTag.TARGET_COMP_ID, targetCompId)
    .addField(FieldTag.ENCRYPT_METHOD, DEFAULT_CONNECTION.ENCRYPT_METHOD) // should be '0'
    .addField(FieldTag.HEART_BT_INT, heartBtInt.toString()) // typically '30'
    .addField(FieldTag.RESET_SEQ_NUM_FLAG, resetSeqNum ? 'Y' : 'N') // usually 'Y'
    .addField(FieldTag.PASSWORD, password) // typically TargetCompID
    .addField(FieldTag.DEFAULT_APPL_VER_ID, '9') // FIX 5.0
    .addField(1408, 'FIX5.00_PSX_1.00') // Correct version tag
      .build();
  }

  /**
   * Create a heartbeat message
   */
  static createHeartbeatMessage(
    senderCompId: string,
    targetCompId: string,
    testReqId?: string
  ): string {
    const builder = new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.HEARTBEAT)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(FieldTag.SENDING_TIME, this.getCurrentTimestamp());

    if (testReqId) {
      builder.addField(FieldTag.TEST_REQ_ID, testReqId);
    }

    return builder.build();
  }

  /**
   * Create a test request message
   */
  static createTestRequestMessage(
    senderCompId: string,
    targetCompId: string,
    testReqId?: string
  ): string {
    return new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.TEST_REQUEST)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(FieldTag.SENDING_TIME, this.getCurrentTimestamp())
      .addField(FieldTag.TEST_REQ_ID, testReqId || new Date().getTime().toString())
      .build();
  }

  /**
   * Create a logout message
   */
  static createLogoutMessage(
    senderCompId: string,
    targetCompId: string,
    text?: string
  ): string {
    const builder = new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.LOGOUT)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(FieldTag.SENDING_TIME, this.getCurrentTimestamp());

    if (text) {
      builder.addField(FieldTag.TEXT, text);
    }

    return builder.build();
  }

  /**
   * Create a market data request message
   */
  static createMarketDataRequest(
    senderCompId: string,
    targetCompId: string,
    symbols: string[],
    entryTypes: string[],
    subscriptionType: string,
    marketDepth: number = 0
  ): string {
    const mdReqId = uuidv4();
    const builder = new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.MARKET_DATA_REQUEST)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(FieldTag.MD_REQ_ID, mdReqId)
      .addField(FieldTag.SUBSCRIPTION_REQUEST_TYPE, subscriptionType)
      .addField(FieldTag.MARKET_DEPTH, marketDepth.toString())
      .addField(FieldTag.MD_UPDATE_TYPE, '0') // Full refresh
      .addField(FieldTag.NO_MD_ENTRY_TYPES, entryTypes.length.toString());

    // Add entry types
    for (let i = 0; i < entryTypes.length; i++) {
      builder.addField(269, entryTypes[i]); // MDEntryType is tag 269
    }

    // Add symbols
    builder.addField(FieldTag.NO_RELATED_SYM, symbols.length.toString());
    for (let i = 0; i < symbols.length; i++) {
      builder.addField(FieldTag.SYMBOL, symbols[i]);
    }

    return builder.build();
  }

  /**
   * Create a security list request
   */
  static createSecurityListRequest(
    senderCompId: string,
    targetCompId: string,
    securityType?: string
  ): string {
    const reqId = uuidv4();
    const builder = new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.SECURITY_LIST_REQUEST)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(FieldTag.SECURITY_LIST_REQUEST_TYPE, SecurityListRequestType.ALL_SECURITIES)
      .addField(320, reqId); // SecurityReqID is tag 320

    if (securityType) {
      builder.addField(FieldTag.SECURITY_TYPE, securityType);
    }

    return builder.build();
  }

  /**
   * Create a trading session status request
   */
  static createTradingSessionStatusRequest(
    senderCompId: string,
    targetCompId: string,
    tradingSessionId?: string
  ): string {
    const reqId = uuidv4();
    const builder = new FixMessageBuilder()
      .addField(FieldTag.MSG_TYPE, MessageType.TRADING_SESSION_STATUS_REQUEST)
      .addField(FieldTag.SENDER_COMP_ID, senderCompId)
      .addField(FieldTag.TARGET_COMP_ID, targetCompId)
      .addField(335, reqId); // TradSesReqID is tag 335

    if (tradingSessionId) {
      builder.addField(FieldTag.TRADING_SESSION_ID, tradingSessionId);
    }

    return builder.build();
  }
} 