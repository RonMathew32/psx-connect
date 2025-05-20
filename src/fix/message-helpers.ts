import { MessageType, FieldTag } from './constants';
import { createMessageBuilder } from './message-builder';
import { SequenceManager } from './sequence-manager';

interface MessageOptions {
  senderCompId: string;
  targetCompId: string;
  username: string;
  password: string;
  heartbeatIntervalSecs: number;
}


/**
 * Create a heartbeat message
 */
export function createHeartbeatMessage(
  options: MessageOptions,
  seqManager: SequenceManager,
  testReqId?: string
): string {
  const builder = createMessageBuilder();

  builder
    .setMsgType(MessageType.HEARTBEAT)
    .setSenderCompID(options.senderCompId)
    .setTargetCompID(options.targetCompId)
    .setMsgSeqNum(seqManager.getNextAndIncrement());

  if (testReqId) {
    builder.addField(FieldTag.TEST_REQ_ID, testReqId);
  }
  
  return builder.buildMessage();
}

/**
 * Get human-readable name for a message type
 */
export function getMessageTypeName(msgType: string): string {
  // Find the message type name by its value
  for (const [name, value] of Object.entries(MessageType)) {
    if (value === msgType) {
      return name;
    }
  }
  return 'UNKNOWN';
} 