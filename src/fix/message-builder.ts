import { SOH, FieldTag } from './constants';

/**
 * Get current timestamp in FIX format (YYYYMMDD-HH:MM:SS.sss)
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
 * Creates a new message builder with utility functions for building FIX messages
 */
export function createMessageBuilder() {
  let headerFields: Record<string, string> = {
    [FieldTag.BEGIN_STRING]: 'FIXT.1.1'
  };

  let bodyFields: Record<string, string> = {};

  /**
   * Sets the message type
   */
  const setMsgType = (msgType: string) => {
    headerFields[FieldTag.MSG_TYPE] = msgType;
    return messageBuilder;
  };

  /**
   * Sets the sender company ID
   */
  const setSenderCompID = (senderCompID: string) => {
    headerFields[FieldTag.SENDER_COMP_ID] = senderCompID;
    return messageBuilder;
  };

  /**
   * Sets the target company ID
   */
  const setTargetCompID = (targetCompID: string) => {
    headerFields[FieldTag.TARGET_COMP_ID] = targetCompID;
    return messageBuilder;
  };

  /**
   * Sets the message sequence number
   */
  const setMsgSeqNum = (seqNum: number) => {
    headerFields[FieldTag.MSG_SEQ_NUM] = seqNum.toString();
    return messageBuilder;
  };

  /**
   * Add a field to the message body
   */
  const addField = (tag: string, value: string) => {
    bodyFields[tag] = value;
    return messageBuilder;
  };

  /**
   * Build the complete FIX message
   */
  const buildMessage = () => {
    // Ensure we have basic required fields
    if (!headerFields[FieldTag.MSG_TYPE]) {
      throw new Error('Message type is required');
    }

    // Add sending time if not already set
    if (!headerFields[FieldTag.SENDING_TIME]) {
      headerFields[FieldTag.SENDING_TIME] = getCurrentTimestamp();
    }

    const allFields = { ...headerFields, ...bodyFields };

    // Convert to string without checksum and body length
    let message = '';
    const sortedTags = Object.keys(allFields).sort((a, b) => {
      // Standard FIX header field order:
      // 8 (BeginString), 9 (BodyLength), 35 (MsgType), 49 (SenderCompID), 
      // 56 (TargetCompID), 34 (MsgSeqNum), 52 (SendingTime)
      const headerOrder: { [key: string]: number } = {
        [FieldTag.BEGIN_STRING]: 1,
        [FieldTag.BODY_LENGTH]: 2,
        [FieldTag.MSG_TYPE]: 3,
        [FieldTag.SENDER_COMP_ID]: 4,
        [FieldTag.TARGET_COMP_ID]: 5,
        [FieldTag.MSG_SEQ_NUM]: 6,
        [FieldTag.SENDING_TIME]: 7
      };

      // If both are header fields, use header order
      if (headerOrder[a] && headerOrder[b]) {
        return headerOrder[a] - headerOrder[b];
      }
      // If only a is header field, it comes first
      if (headerOrder[a]) return -1;
      // If only b is header field, it comes first
      if (headerOrder[b]) return 1;
      // For non-header fields, sort by tag number
      return parseInt(a) - parseInt(b);
    });

    // First build the message without BEGIN_STRING and BODY_LENGTH
    let bodyContent = '';
    for (const tag of sortedTags) {
      if (tag !== FieldTag.BEGIN_STRING && tag !== FieldTag.BODY_LENGTH) {
        bodyContent += `${tag}=${allFields[tag]}${SOH}`;
      }
    }

    // Calculate body length (excluding BEGIN_STRING and BODY_LENGTH fields)
    const bodyLength = bodyContent.length;

    // Build the final message
    message = `${FieldTag.BEGIN_STRING}=${allFields[FieldTag.BEGIN_STRING]}${SOH}`;
    message += `${FieldTag.BODY_LENGTH}=${bodyLength}${SOH}`;
    message += bodyContent;

    // Calculate checksum
    let checksum = 0;
    for (let i = 0; i < message.length; i++) {
      checksum += message.charCodeAt(i);
    }
    checksum = checksum % 256;

    // Add checksum (always 3 characters with leading zeros)
    const checksumStr = checksum.toString().padStart(3, '0');
    message += `${FieldTag.CHECK_SUM}=${checksumStr}${SOH}`;

    return message;
  };

  // Create the builder object with all functions
  const messageBuilder = {
    setMsgType,
    setSenderCompID,
    setTargetCompID,
    setMsgSeqNum,
    addField,
    buildMessage
  };

  return messageBuilder;
}