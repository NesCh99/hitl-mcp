import type { IncomingMessage } from "../../core/types.js";

/**
 * Map WhatsApp provider events into normalized IncomingMessage.
 * Provider-specific structures stay inside this adapter module.
 */

export interface WhatsAppMessageEvent {
  chatId: string;
  messageId: string;
  senderId: string;
  text: string;
  quotedMessageId?: string;
}

export function mapWhatsAppEventToIncoming(
  event: WhatsAppMessageEvent,
): IncomingMessage {
  return {
    channel: "whatsapp",
    targetId: event.chatId,
    messageId: event.messageId,
    replyToMessageId: event.quotedMessageId,
    senderId: event.senderId,
    text: event.text,
  };
}
