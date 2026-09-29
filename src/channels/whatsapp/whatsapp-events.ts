import type { IncomingMessage } from "../../core/types.js";
import type { WhatsAppQuoteMessage } from "./types.js";
import { normalizeWhatsAppChatJid } from "./whatsapp-setup.js";

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
  fromMe?: boolean;
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

/**
 * Normalize a Baileys-like WAMessage into the adapter-local event shape.
 * Returns undefined for messages HITL should ignore.
 */
export function normalizeWhatsAppMessage(
  msg: WhatsAppQuoteMessage,
  options?: { selfJid?: string; includeFromMe?: boolean },
): WhatsAppMessageEvent | undefined {
  const remoteJid = resolveChatJid(msg.key);
  const messageId = msg.key.id ?? undefined;
  if (!remoteJid || !messageId) {
    return undefined;
  }

  if (isIgnoredJid(remoteJid)) {
    return undefined;
  }

  if (msg.key.fromMe && !options?.includeFromMe) {
    return undefined;
  }

  const text = extractText(msg.message);
  if (!text) {
    return undefined;
  }

  const senderId =
    msg.key.participant ??
    (options?.selfJid && isSameUser(remoteJid, options.selfJid)
      ? options.selfJid
      : remoteJid);

  const quotedMessageId = extractQuotedMessageId(msg.message);

  return {
    chatId: remoteJid,
    messageId,
    senderId,
    text,
    quotedMessageId,
    fromMe: Boolean(msg.key.fromMe),
  };
}

/** Prefer group JID or normalized user JID over device-suffixed forms. */
function resolveChatJid(key: {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
}): string | undefined {
  const primary = key.remoteJid ?? undefined;
  const alt = key.remoteJidAlt ?? undefined;

  for (const candidate of [primary, alt]) {
    if (candidate?.endsWith("@g.us")) {
      return candidate;
    }
  }

  const raw = primary ?? alt;
  if (!raw) {
    return undefined;
  }
  return normalizeWhatsAppChatJid(raw);
}

function isSameUser(a: string, b: string): boolean {
  const userA = a.split("@")[0]?.split(":")[0];
  const userB = b.split("@")[0]?.split(":")[0];
  return Boolean(userA && userB && userA === userB);
}

function isIgnoredJid(jid: string): boolean {
  return (
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast")
  );
}

function extractText(
  message: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!message) {
    return undefined;
  }

  const unwrapped = unwrapMessage(message);
  if (!unwrapped) {
    return undefined;
  }

  if (typeof unwrapped.conversation === "string" && unwrapped.conversation) {
    return unwrapped.conversation;
  }

  const extended = asRecord(unwrapped.extendedTextMessage);
  if (typeof extended?.text === "string" && extended.text) {
    return extended.text;
  }

  for (const key of ["imageMessage", "videoMessage", "documentMessage"] as const) {
    const node = asRecord(unwrapped[key]);
    if (typeof node?.caption === "string" && node.caption) {
      return node.caption;
    }
  }

  return undefined;
}

function extractQuotedMessageId(
  message: Record<string, unknown> | null | undefined,
): string | undefined {
  const unwrapped = unwrapMessage(message);
  if (!unwrapped) {
    return undefined;
  }

  for (const value of Object.values(unwrapped)) {
    const node = asRecord(value);
    const contextInfo = asRecord(node?.contextInfo);
    if (typeof contextInfo?.stanzaId === "string" && contextInfo.stanzaId) {
      return contextInfo.stanzaId;
    }
  }

  return undefined;
}

function unwrapMessage(
  message: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!message) {
    return undefined;
  }

  let current: Record<string, unknown> = message;
  for (let i = 0; i < 4; i += 1) {
    const ephemeral = asRecord(current.ephemeralMessage)?.message;
    const viewOnce = asRecord(current.viewOnceMessage)?.message;
    const viewOnceV2 = asRecord(current.viewOnceMessageV2)?.message;
    const edited = asRecord(
      asRecord(current.editedMessage)?.message,
    );

    const next = asRecord(ephemeral) ?? asRecord(viewOnce) ?? asRecord(viewOnceV2) ?? edited;
    if (!next) {
      return current;
    }
    current = next;
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
