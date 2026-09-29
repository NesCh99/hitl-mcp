/**
 * Narrow interfaces so WhatsAppAdapter can be unit-tested without Baileys/network.
 * Production wires these to @whiskeysockets/baileys.
 */

export interface WhatsAppMessageKey {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

export interface WhatsAppQuoteMessage {
  key: WhatsAppMessageKey;
  message?: Record<string, unknown> | null;
}

export interface WhatsAppSendResult {
  key?: WhatsAppMessageKey;
  message?: Record<string, unknown> | null;
}

export interface WhatsAppChatInfo {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  /** Sometimes present on conversation objects. */
  pnJid?: string | null;
  lidJid?: string | null;
}

export interface WhatsAppContactInfo {
  id: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

export interface WhatsAppConnectionUpdate {
  connection?: "open" | "connecting" | "close";
  qr?: string;
  lastDisconnect?: { error?: unknown };
  isNewLogin?: boolean;
}

export interface WhatsAppMessagesUpsert {
  messages: WhatsAppQuoteMessage[];
  type: "notify" | "append" | string;
}

export type WhatsAppEventMap = {
  "connection.update": WhatsAppConnectionUpdate;
  "creds.update": unknown;
  "messages.upsert": WhatsAppMessagesUpsert;
  "chats.upsert": WhatsAppChatInfo[];
  "chats.update": WhatsAppChatInfo[];
  "contacts.upsert": WhatsAppContactInfo[];
  "contacts.update": Array<Partial<WhatsAppContactInfo> & { id?: string }>;
  "messaging-history.set": {
    chats?: WhatsAppChatInfo[];
    contacts?: WhatsAppContactInfo[];
  };
};

export interface WhatsAppEventEmitter {
  on<E extends keyof WhatsAppEventMap>(
    event: E,
    handler: (payload: WhatsAppEventMap[E]) => void,
  ): void;
  off?<E extends keyof WhatsAppEventMap>(
    event: E,
    handler: (payload: WhatsAppEventMap[E]) => void,
  ): void;
}

export interface WhatsAppAuthCreds {
  registered?: boolean;
  me?: { id?: string | null } | null;
}

export interface WhatsAppGroupInviteInfo {
  id: string;
  subject?: string;
  size?: number;
  desc?: string;
}

export interface WhatsAppSocket {
  ev: WhatsAppEventEmitter;
  authState?: { creds: WhatsAppAuthCreds };
  user?: { id?: string | null } | null;
  sendMessage: (
    jid: string,
    content: { text: string },
    options?: { quoted?: WhatsAppQuoteMessage },
  ) => Promise<WhatsAppSendResult | undefined>;
  requestPairingCode?: (phoneNumber: string) => Promise<string>;
  /** Baileys helper — resolves once the WebSocket is open. */
  waitForSocketOpen?: () => Promise<void>;
  /** Resolve a group invite code to metadata (no join required). */
  groupGetInviteInfo?: (code: string) => Promise<WhatsAppGroupInviteInfo>;
  /** Optional metadata lookup for a known group JID. */
  groupMetadata?: (jid: string) => Promise<WhatsAppGroupInviteInfo>;
  /** Baileys end() is async — clears keepAlive and closes the WebSocket. */
  end?: (error?: Error) => void | Promise<void>;
}

export interface CreatedWhatsAppSocket {
  socket: WhatsAppSocket;
  saveCreds: () => Promise<void>;
}

export type CreateWhatsAppSocket = (
  authDir: string,
) => Promise<CreatedWhatsAppSocket>;
