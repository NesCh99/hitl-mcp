import type { CredentialStore } from "../../auth/credential-store.js";
import { HitlError } from "../../core/types.js";
import type {
  ChannelType,
  SendMessageOptions,
  SentMessage,
  SessionRef,
} from "../../core/types.js";
import type {
  ChannelAdapter,
  ListedTarget,
  MessageHandler,
} from "../channel-adapter.js";
import {
  clearWhatsAppAuthDir,
  ensureWhatsAppAuthDir,
  parseWhatsAppCredentials,
  safeErrorMessage,
  type WhatsAppCredentials,
} from "./whatsapp-auth.js";
import {
  defaultSetupPhrase,
  matchesSetupPhrase,
  normalizeWhatsAppChatJid,
  parseWhatsAppInviteCode,
} from "./whatsapp-setup.js";
import {
  mapWhatsAppEventToIncoming,
  normalizeWhatsAppMessage,
} from "./whatsapp-events.js";
import type {
  CreateWhatsAppSocket,
  WhatsAppChatInfo,
  WhatsAppContactInfo,
  WhatsAppQuoteMessage,
  WhatsAppSocket,
} from "./types.js";
import { formatHitlOutbound } from "../../core/outbound-format.js";

/** Baileys logged-out status; mirrored so tests need not import Baileys. */
const BAILEYS_LOGGED_OUT = 401;
/** After QR/pairing, Baileys closes with 515 and expects a fresh socket. */
const BAILEYS_RESTART_REQUIRED = 515;

const MAX_CONNECT_ATTEMPTS = 5;

export interface WhatsAppAdapterOptions {
  credentialStore: CredentialStore;
  /** Override for tests. */
  createSocket?: CreateWhatsAppSocket;
  /**
   * When true (default on TTY), print QR codes to stdout during first-time link.
   * Setup relies on this; MCP runtime usually already has a linked session.
   */
  printQr?: boolean;
  /**
   * Delay after the socket is ready before requestPairingCode.
   * Baileys needs the noise handshake finished; too early → Connection Closed.
   */
  pairingReadyDelayMs?: number;
}

interface WhatsAppSessionThread {
  targetId: string;
  sessionId: string;
  rootMessageId: string;
  rootMessage: WhatsAppQuoteMessage;
  label: string;
}

function sessionKey(targetId: string, sessionId: string): string {
  return `${targetId}::${sessionId}`;
}

function sessionLabel(session: SessionRef): string {
  const name = session.name?.trim();
  if (name) {
    return name;
  }
  return session.id;
}

function defaultPrintQr(): boolean {
  return Boolean(process.stdout.isTTY);
}

async function defaultCreateSocket(authDir: string) {
  silenceLibsignalSessionLogs();

  const baileys = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);

  // Keep Baileys logs quiet during setup/MCP stdio.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logger: any;
  try {
    const pino = await import("pino");
    logger = pino.default({ level: "silent" });
  } catch {
    logger = undefined;
  }

  const socket = baileys.default({
    auth: {
      creds: state.creds,
      keys: baileys.makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Ubuntu/Chrome is the most reliable preset for multi-device linking.
    browser: baileys.Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    syncFullHistory: false,
    // Skip heavy history sync; it often precedes flaky post-pair disconnects.
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    ...(logger ? { logger } : {}),
  });
  return {
    socket: socket as unknown as WhatsAppSocket,
    saveCreds,
  };
}

/**
 * libsignal prints full SessionEntry objects (including key material) via
 * console.info("Closing session:", …). Suppress that noise — and secret dump —
 * for HITL CLI / MCP stdio.
 */
let libsignalLogsSilenced = false;
function silenceLibsignalSessionLogs(): void {
  if (libsignalLogsSilenced) {
    return;
  }
  libsignalLogsSilenced = true;
  const original = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("Closing session:")
    ) {
      return;
    }
    original(...args);
  };
}

function disconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const boom = error as {
    output?: { statusCode?: number };
    statusCode?: number;
  };
  return boom.output?.statusCode ?? boom.statusCode;
}

function chatLabel(
  chat: WhatsAppChatInfo,
  contacts: Map<string, WhatsAppContactInfo>,
  selfJid?: string,
): string {
  const id = chat.id ?? "unknown";

  if (selfJid && isSameWhatsAppUser(id, selfJid)) {
    return "Me (this account)";
  }

  if (id.endsWith("@g.us")) {
    return chat.name?.trim() || chat.displayName?.trim() || "Group chat";
  }

  const contact = findContact(contacts, id, chat);
  const fromContact =
    contact?.name?.trim() ||
    contact?.notify?.trim() ||
    contact?.verifiedName?.trim();
  if (fromContact) {
    return fromContact;
  }

  const fromChat = chat.name?.trim() || chat.displayName?.trim();
  if (fromChat) {
    return fromChat;
  }

  if (id.endsWith("@lid")) {
    return "WhatsApp contact";
  }

  if (id.endsWith("@s.whatsapp.net")) {
    const phone = id.split("@")[0] ?? id;
    return phone;
  }

  return "Chat";
}

function findContact(
  contacts: Map<string, WhatsAppContactInfo>,
  chatId: string,
  chat: WhatsAppChatInfo,
): WhatsAppContactInfo | undefined {
  return (
    contacts.get(chatId) ||
    (chat.pnJid ? contacts.get(chat.pnJid) : undefined) ||
    (chat.lidJid ? contacts.get(chat.lidJid) : undefined) ||
    [...contacts.values()].find(
      (c) =>
        c.id === chatId ||
        c.lid === chatId ||
        c.phoneNumber === chatId ||
        (chat.pnJid && (c.id === chat.pnJid || c.phoneNumber === chat.pnJid)) ||
        (chat.lidJid && (c.id === chat.lidJid || c.lid === chat.lidJid)),
    )
  );
}

function isSameWhatsAppUser(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const userA = a.split("@")[0]?.split(":")[0];
  const userB = b.split("@")[0]?.split(":")[0];
  return Boolean(userA && userB && userA === userB);
}

/**
 * WhatsApp ChannelAdapter using Baileys.
 *
 * One MCP connection (`session`) → one logical conversation root in the target chat:
 * 1. First message opens a root: "Started working on {name|id}"
 * 2. ask_human / notify_human posts quote that root
 * 3. Human reply-quotes a HITL message; adapter maps quotes to the session root
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly type: ChannelType = "whatsapp";

  private readonly credentialStore: CredentialStore;
  private readonly createSocket: CreateWhatsAppSocket;
  private readonly printQr: boolean;
  private readonly pairingReadyDelayMs: number;

  private readonly handlers: MessageHandler[] = [];
  /** Session roots for the current process. */
  private readonly sessions = new Map<string, WhatsAppSessionThread>();
  private readonly sessionLocks = new Map<string, Promise<WhatsAppSessionThread>>();
  /** Outbound message id → session root id. */
  private readonly correlationRoots = new Map<string, string>();
  private readonly chats = new Map<string, WhatsAppChatInfo>();
  private readonly contacts = new Map<string, WhatsAppContactInfo>();

  private credentials: WhatsAppCredentials | undefined;
  private socket: WhatsAppSocket | undefined;
  private saveCreds: (() => Promise<void>) | undefined;
  private credsSaveQueue: Promise<void> = Promise.resolve();
  private connected = false;
  private connecting: Promise<void> | undefined;
  private selfJid: string | undefined;
  /** Set when WhatsApp invalidates the linked device (401 / device_removed). */
  private sessionInvalidated = false;

  constructor(options: WhatsAppAdapterOptions) {
    this.credentialStore = options.credentialStore;
    this.createSocket = options.createSocket ?? defaultCreateSocket;
    this.printQr = options.printQr ?? defaultPrintQr();
    this.pairingReadyDelayMs = options.pairingReadyDelayMs ?? 3000;
  }

  async isAuthenticated(): Promise<boolean> {
    if (this.credentials) {
      return true;
    }
    const stored = await this.credentialStore.get("whatsapp");
    if (!stored) {
      return false;
    }
    try {
      parseWhatsAppCredentials(stored);
      return true;
    } catch {
      return false;
    }
  }

  async authenticate(): Promise<void> {
    const stored = await this.credentialStore.get("whatsapp");
    if (!stored) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "WhatsApp credentials not found. Run `hitl-mcp setup` and choose WhatsApp.",
      );
    }

    let credentials: WhatsAppCredentials;
    try {
      credentials = parseWhatsAppCredentials(stored);
    } catch (error) {
      throw new HitlError(
        "CONFIG_ERROR",
        `Invalid WhatsApp credentials: ${safeErrorMessage(error)}`,
      );
    }

    try {
      await ensureWhatsAppAuthDir(credentials.authDir);
    } catch (error) {
      throw new HitlError(
        "CONFIG_ERROR",
        `WhatsApp auth directory is not usable: ${safeErrorMessage(error)}`,
      );
    }

    this.credentials = credentials;
    this.selfJid = credentials.selfJid
      ? normalizeWhatsAppChatJid(credentials.selfJid)
      : undefined;
  }

  async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.sessions.clear();
    this.sessionLocks.clear();
    this.correlationRoots.clear();

    const socket = this.socket;
    this.socket = undefined;
    this.saveCreds = undefined;
    this.connected = false;

    if (socket?.end) {
      try {
        await socket.end(undefined);
      } catch (error) {
        throw new HitlError(
          "CONNECTION_FAILURE",
          `Failed to disconnect WhatsApp: ${safeErrorMessage(error)}`,
        );
      }
    }
  }

  async listTargets(): Promise<ListedTarget[]> {
    await this.connect();

    // Ensure the linked account itself is visible with a friendly label.
    if (this.selfJid && !this.chats.has(this.selfJid)) {
      this.chats.set(this.selfJid, { id: this.selfJid, name: "Me (this account)" });
    }

    const targets: ListedTarget[] = [];
    const seen = new Set<string>();
    for (const chat of this.chats.values()) {
      if (!chat.id || isIgnoredChatId(chat.id)) {
        continue;
      }
      const targetId = normalizeWhatsAppChatJid(chat.id);
      if (seen.has(targetId)) {
        continue;
      }
      seen.add(targetId);
      targets.push({
        channel: "whatsapp",
        targetId,
        label: chatLabel(
          { ...chat, id: targetId },
          this.contacts,
          this.selfJid,
        ),
      });
    }

    targets.sort((a, b) =>
      (a.label ?? a.targetId).localeCompare(b.label ?? b.targetId),
    );
    return targets;
  }

  /** Linked WhatsApp account as a HITL target (notes-to-self / “Me”). */
  getMyAccountTarget(): ListedTarget | undefined {
    if (!this.selfJid) {
      return undefined;
    }
    const targetId = normalizeWhatsAppChatJid(this.selfJid);
    const chat = this.chats.get(targetId) ??
      this.chats.get(this.selfJid) ?? {
        id: targetId,
        name: "Me (this account)",
      };
    return {
      channel: "whatsapp",
      targetId,
      label: chatLabel({ ...chat, id: targetId }, this.contacts, targetId),
    };
  }

  async sendMessage(
    targetId: string,
    message: string,
    options?: SendMessageOptions,
  ): Promise<SentMessage> {
    await this.connect();

    const session = options?.session;
    if (!session?.id) {
      throw new HitlError(
        "INVALID_TARGET",
        "WhatsApp requires a session id so messages can share a conversation root.",
      );
    }

    const thread = await this.ensureSessionThread(targetId, session);
    const result = await this.post(targetId, message, thread.rootMessage);

    const messageId = result.key?.id;
    if (!messageId) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        "WhatsApp sendMessage did not return a message id.",
      );
    }

    this.correlationRoots.set(messageId, thread.rootMessageId);

    return {
      messageId,
      correlationId: thread.rootMessageId,
      target: { channel: "whatsapp", targetId },
      text: message,
    };
  }

  async sendPlainMessage(
    targetId: string,
    message: string,
  ): Promise<SentMessage> {
    await this.connect();
    const result = await this.post(targetId, message);
    const messageId = result.key?.id;
    if (!messageId) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        "WhatsApp sendPlainMessage did not return a message id.",
      );
    }
    return {
      messageId,
      target: { channel: "whatsapp", targetId },
      text: message,
    };
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  /** Whether the Baileys socket currently reports an open connection. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * If WhatsApp removed/logged out this device, return a typed error once and
   * clear the local auth material so the next setup starts clean.
   */
  async takeSessionInvalidationError(): Promise<HitlError | undefined> {
    if (!this.sessionInvalidated) {
      return undefined;
    }
    this.sessionInvalidated = false;
    const authDir = this.credentials?.authDir;
    if (authDir) {
      try {
        await clearWhatsAppAuthDir(authDir);
      } catch {
        // Best-effort wipe.
      }
    }
    this.credentials = undefined;
    await this.credentialStore.delete("whatsapp");
    return new HitlError(
      "PROVIDER_NOT_AUTHENTICATED",
      "WhatsApp removed this linked device (session invalidated). Local auth was cleared — run `hitl-mcp setup` and scan again. Prefer a secondary number, and only one HITL process at a time.",
    );
  }

  /**
   * Resolve a group invite link/code to a ListedTarget via groupGetInviteInfo.
   * Does not join the group — you should already be a member (or join separately)
   * before using it as a HITL target.
   */
  async resolveGroupInvite(linkOrCode: string): Promise<ListedTarget> {
    await this.connect();
    const socket = await this.requireSocket();
    if (!socket.groupGetInviteInfo) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        "This WhatsApp client cannot resolve invite links.",
      );
    }

    let code: string;
    try {
      code = parseWhatsAppInviteCode(linkOrCode);
    } catch (error) {
      throw new HitlError("INVALID_TARGET", safeErrorMessage(error));
    }

    let info;
    try {
      info = await socket.groupGetInviteInfo(code);
    } catch (error) {
      throw new HitlError(
        "TARGET_NOT_FOUND",
        `Could not resolve invite: ${safeErrorMessage(error)}`,
      );
    }

    if (!info.id) {
      throw new HitlError(
        "TARGET_NOT_FOUND",
        "Invite resolved but returned no group id.",
      );
    }

    this.chats.set(info.id, {
      id: info.id,
      name: info.subject,
    });

    return {
      channel: "whatsapp",
      targetId: info.id,
      label: info.subject?.trim() || "Group chat",
    };
  }

  /**
   * Resolve a friendly label for a chat/group JID (group subject, contact name, etc.).
   * Used by setup when the user pastes a raw JID or after detect-by-message.
   */
  async resolveTargetInfo(jid: string): Promise<ListedTarget> {
    await this.connect();
    const targetId = normalizeWhatsAppChatJid(jid.trim());
    if (!targetId.includes("@")) {
      throw new HitlError(
        "INVALID_TARGET",
        "Expected a full JID like 1203630...@g.us or 15551234567@s.whatsapp.net",
      );
    }

    if (targetId.endsWith("@g.us")) {
      const subject = await this.enrichGroupLabel(targetId);
      if (subject) {
        return { channel: "whatsapp", targetId, label: subject };
      }
    }

    const chat =
      this.chats.get(targetId) ??
      this.chats.get(jid) ??
      ({ id: targetId } satisfies WhatsAppChatInfo);

    const label = chatLabel(
      { ...chat, id: targetId },
      this.contacts,
      this.selfJid,
    );

    return {
      channel: "whatsapp",
      targetId,
      label:
        !label || label === targetId
          ? targetId.endsWith("@g.us")
            ? "Group chat"
            : "Chat"
          : label,
    };
  }

  /**
   * Listen for a setup phrase (default "Hi hitl"), including messages from this
   * account (fromMe), and return matching chats for confirmation.
   */
  async waitForSetupPhrase(options?: {
    phrase?: string;
    timeoutMs?: number;
    onMatch?: (target: ListedTarget, text: string) => void;
  }): Promise<ListedTarget[]> {
    await this.connect();
    const socket = await this.requireSocket();
    const phrase = options?.phrase ?? defaultSetupPhrase();
    const timeoutMs = options?.timeoutMs ?? 90_000;
    const found = new Map<string, ListedTarget>();

    return await new Promise<ListedTarget[]>((resolve) => {
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (graceTimer) {
          clearTimeout(graceTimer);
        }
        socket.ev.off?.("messages.upsert", onUpsert);
        resolve([...found.values()]);
      };

      const timer = setTimeout(finish, timeoutMs);

      const onUpsert = (payload: {
        messages: WhatsAppQuoteMessage[];
        type: string;
      }) => {
        if (payload.type !== "notify" && payload.type !== "append") {
          return;
        }

        void (async () => {
          for (const message of payload.messages) {
            if (settled) {
              return;
            }

            const event = normalizeWhatsAppMessage(message, {
              selfJid: this.selfJid,
              includeFromMe: true,
            });
            if (!event || !matchesSetupPhrase(event.text, phrase)) {
              continue;
            }

            const chatId = normalizeWhatsAppChatJid(event.chatId);
            const enriched = await this.enrichGroupLabel(chatId);
            const label =
              enriched ??
              chatLabel(
                this.chats.get(chatId) ??
                  this.chats.get(event.chatId) ?? { id: chatId },
                this.contacts,
                this.selfJid,
              );

            const target: ListedTarget = {
              channel: "whatsapp",
              targetId: chatId,
              label:
                !label || label === chatId
                  ? chatId.endsWith("@g.us")
                    ? "Group chat"
                    : "Chat"
                  : label,
            };
            const isNew = !found.has(chatId);
            found.set(chatId, target);
            if (isNew) {
              options?.onMatch?.(target, event.text);
            }

            // After the first hit, keep a short window for more matches.
            if (!graceTimer) {
              graceTimer = setTimeout(finish, 5_000);
            }
          }
        })();
      };

      socket.ev.on("messages.upsert", onUpsert);
    });
  }

  private async enrichGroupLabel(jid: string): Promise<string | undefined> {
    if (!jid.endsWith("@g.us") || !this.socket?.groupMetadata) {
      return undefined;
    }
    try {
      const meta = await this.socket.groupMetadata(jid);
      if (meta.subject?.trim()) {
        this.chats.set(jid, {
          ...(this.chats.get(jid) ?? { id: jid }),
          id: jid,
          name: meta.subject,
        });
        return meta.subject.trim();
      }
    } catch {
      // Label enrichment is best-effort during setup.
    }
    return undefined;
  }

  /** Test helper: inspect in-memory session threads. */
  getSessionThread(
    targetId: string,
    sessionId: string,
  ): WhatsAppSessionThread | undefined {
    return this.sessions.get(sessionKey(targetId, sessionId));
  }

  /** Test helper: seed chat discovery without Baileys history sync. */
  seedChat(chat: WhatsAppChatInfo): void {
    if (chat.id) {
      this.chats.set(chat.id, chat);
    }
  }

  /** Test helper: seed contact names used for target labels. */
  seedContact(contact: WhatsAppContactInfo): void {
    this.contacts.set(contact.id, contact);
    if (contact.lid) {
      this.contacts.set(contact.lid, contact);
    }
    if (contact.phoneNumber) {
      this.contacts.set(contact.phoneNumber, contact);
    }
  }

  private async ensureSessionThread(
    targetId: string,
    session: SessionRef,
  ): Promise<WhatsAppSessionThread> {
    const key = sessionKey(targetId, session.id);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const inFlight = this.sessionLocks.get(key);
    if (inFlight) {
      return inFlight;
    }

    const create = this.openSessionThread(targetId, session, key);
    this.sessionLocks.set(key, create);
    try {
      return await create;
    } finally {
      this.sessionLocks.delete(key);
    }
  }

  private async openSessionThread(
    targetId: string,
    session: SessionRef,
    key: string,
  ): Promise<WhatsAppSessionThread> {
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const label = sessionLabel(session);
    const opener = `Started working on ${label}`;
    const result = await this.post(targetId, opener);

    const rootMessageId = result.key?.id;
    if (!rootMessageId) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        "WhatsApp session opener did not return a message id.",
      );
    }

    const rootMessage: WhatsAppQuoteMessage = {
      key: {
        remoteJid: targetId,
        id: rootMessageId,
        fromMe: true,
      },
      message: result.message ?? { conversation: opener },
    };

    this.correlationRoots.set(rootMessageId, rootMessageId);

    const thread: WhatsAppSessionThread = {
      targetId,
      sessionId: session.id,
      rootMessageId,
      rootMessage,
      label,
    };
    this.sessions.set(key, thread);
    return thread;
  }

  private async post(
    targetId: string,
    text: string,
    quoted?: WhatsAppQuoteMessage,
  ): Promise<WhatsAppQuoteMessage> {
    const socket = await this.requireSocket();
    // Device-suffixed JIDs address a single linked device; normalize to the user chat.
    const jid = normalizeWhatsAppChatJid(targetId);

    let result;
    try {
      result = await socket.sendMessage(
        jid,
        { text: formatHitlOutbound(text) },
        quoted ? { quoted } : undefined,
      );
    } catch (error) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `WhatsApp sendMessage failed: ${safeErrorMessage(error)}`,
      );
    }

    if (!result?.key?.id) {
      throw new HitlError(
        "CONNECTION_FAILURE",
        `WhatsApp sendMessage failed for target "${jid}".`,
      );
    }

    return {
      key: result.key,
      message: result.message ?? { conversation: text },
    };
  }

  private async doConnect(): Promise<void> {
    if (!this.credentials) {
      await this.authenticate();
    }

    const credentials = this.credentials;
    if (!credentials) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "WhatsApp is not authenticated.",
      );
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
      this.disposeSocket();

      let created;
      try {
        created = await this.createSocket(credentials.authDir);
      } catch (error) {
        throw new HitlError(
          "CONNECTION_FAILURE",
          `WhatsApp socket failed to start: ${safeErrorMessage(error)}`,
        );
      }

      this.socket = created.socket;
      this.saveCreds = created.saveCreds;
      this.attachListeners(created.socket);

      const outcome = await this.waitUntilOpen(created.socket, credentials, {
        // Pairing code is only useful on the first attempt before registration.
        allowPairing: attempt === 1,
      });

      if (outcome === "open") {
        this.connected = true;

        const selfJidRaw =
          created.socket.user?.id ??
          created.socket.authState?.creds.me?.id ??
          undefined;
        const selfJid = selfJidRaw
          ? normalizeWhatsAppChatJid(selfJidRaw)
          : undefined;
        if (selfJid && selfJid !== credentials.selfJid) {
          const next: WhatsAppCredentials = {
            ...credentials,
            selfJid,
            linkedAt: new Date().toISOString(),
          };
          await this.credentialStore.set("whatsapp", next);
          this.credentials = next;
          this.selfJid = selfJid;
        } else if (selfJid) {
          this.selfJid = selfJid;
        }
        return;
      }

      // outcome === "restart" — persist creds, then open a new socket.
      await this.flushCreds();

      if (this.printQr && attempt === 1) {
        console.log(
          "WhatsApp linked — restarting the connection to finish setup...\n",
        );
      }
      lastError = new HitlError(
        "CONNECTION_FAILURE",
        "WhatsApp requested a connection restart after linking.",
      );
    }

    throw (
      lastError ??
      new HitlError(
        "CONNECTION_FAILURE",
        "WhatsApp failed to connect after restart attempts.",
      )
    );
  }

  private disposeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.saveCreds = undefined;
    this.connected = false;
    if (socket?.end) {
      try {
        // Fire-and-forget during reconnect; disconnect() awaits a clean end.
        void Promise.resolve(socket.end(undefined)).catch(() => undefined);
      } catch {
        // Ignore teardown errors while replacing the socket.
      }
    }
  }

  private attachListeners(socket: WhatsAppSocket): void {
    socket.ev.on("creds.update", () => {
      this.credsSaveQueue = this.credsSaveQueue
        .then(async () => {
          await this.saveCreds?.();
        })
        .catch(() => {
          // Persist failures are surfaced on the next connect/auth attempt.
        });
    });

    socket.ev.on("connection.update", (update) => {
      // Prefer pairing-code UX when configured.
      if (
        update.qr &&
        this.printQr &&
        this.credentials?.linkMethod !== "pairing"
      ) {
        void printQrToTerminal(update.qr);
      }

      if (update.connection === "open") {
        this.connected = true;
        return;
      }

      if (update.connection === "close") {
        this.connected = false;
        const code = disconnectStatusCode(update.lastDisconnect?.error);
        if (code === BAILEYS_LOGGED_OUT) {
          this.sessionInvalidated = true;
        }
      }
    });

    socket.ev.on("chats.upsert", (chats) => {
      this.mergeChats(chats);
    });

    socket.ev.on("chats.update", (chats) => {
      this.mergeChats(chats);
    });

    socket.ev.on("messaging-history.set", (payload) => {
      if (payload.chats) {
        this.mergeChats(payload.chats);
      }
      if (payload.contacts) {
        this.mergeContacts(payload.contacts);
      }
    });

    socket.ev.on("contacts.upsert", (contacts) => {
      this.mergeContacts(contacts);
    });

    socket.ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (!update.id) {
          continue;
        }
        const existing = this.contacts.get(update.id);
        this.mergeContacts([
          {
            id: update.id,
            ...existing,
            ...update,
          },
        ]);
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") {
        return;
      }

      for (const message of messages) {
        // Fresh chats sometimes appear only via inbound messages.
        const jid = message.key.remoteJid;
        if (jid && !isIgnoredChatId(jid) && !this.chats.has(jid)) {
          this.chats.set(jid, { id: jid });
        }

        // Include fromMe: replies from the linked phone are marked fromMe.
        const event = normalizeWhatsAppMessage(message, {
          selfJid: this.selfJid,
          includeFromMe: true,
        });
        if (!event) {
          continue;
        }

        // Skip echoes of messages we sent.
        if (event.fromMe && this.correlationRoots.has(event.messageId)) {
          continue;
        }

        const replyToMessageId = event.quotedMessageId
          ? (this.correlationRoots.get(event.quotedMessageId) ??
            event.quotedMessageId)
          : undefined;

        const incoming = mapWhatsAppEventToIncoming({
          ...event,
          quotedMessageId: replyToMessageId,
        });

        for (const handler of this.handlers) {
          try {
            handler(incoming);
          } catch {
            // Handler errors must not break the WhatsApp event loop.
          }
        }
      }
    });
  }

  private mergeChats(chats: WhatsAppChatInfo[]): void {
    for (const chat of chats) {
      if (!chat.id || isIgnoredChatId(chat.id)) {
        continue;
      }
      const existing = this.chats.get(chat.id);
      this.chats.set(chat.id, { ...existing, ...chat });
    }
  }

  private mergeContacts(contacts: WhatsAppContactInfo[]): void {
    for (const contact of contacts) {
      if (!contact.id) {
        continue;
      }
      const existing = this.contacts.get(contact.id);
      const merged = { ...existing, ...contact, id: contact.id };
      this.contacts.set(contact.id, merged);
      if (merged.lid) {
        this.contacts.set(merged.lid, merged);
      }
      if (merged.phoneNumber) {
        this.contacts.set(merged.phoneNumber, merged);
      }
    }
  }

  private async waitUntilOpen(
    socket: WhatsAppSocket,
    credentials: WhatsAppCredentials,
    options?: { allowPairing?: boolean },
  ): Promise<"open" | "restart"> {
    const timeoutMs = 120_000;
    const wantsPairing =
      options?.allowPairing !== false &&
      credentials.linkMethod === "pairing" &&
      Boolean(credentials.phoneNumber);

    return await new Promise<"open" | "restart">((resolve, reject) => {
      let settled = false;
      let pairingStarted = false;

      const finish = (result: "open" | "restart" | Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(pairingFallbackTimer);
        socket.ev.off?.("connection.update", onUpdate);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish(
          new HitlError(
            "CONNECTION_FAILURE",
            wantsPairing
              ? "Timed out waiting for WhatsApp pairing. Confirm the phone number, enter the code under Linked Devices → Link with phone number, then retry."
              : "Timed out waiting for WhatsApp to connect. Scan the QR code, then retry.",
          ),
        );
      }, timeoutMs);

      const startPairing = () => {
        if (pairingStarted || settled || !wantsPairing) {
          return;
        }
        pairingStarted = true;
        void requestPairingWithRetry();
      };

      const requestPairingWithRetry = async () => {
        if (!socket.requestPairingCode) {
          finish(
            new HitlError(
              "CONNECTION_FAILURE",
              "WhatsApp pairing is unavailable in this client build.",
            ),
          );
          return;
        }

        if (socket.authState?.creds.registered) {
          return;
        }

        const phone = credentials.phoneNumber!;
        console.log(`\nRequesting WhatsApp pairing code for ${phone}...`);

        // sendNode requires an open WS — "connecting" is too early.
        try {
          await socket.waitForSocketOpen?.();
        } catch (error) {
          finish(
            new HitlError(
              "CONNECTION_FAILURE",
              `WhatsApp socket was not open for pairing: ${safeErrorMessage(error)}`,
            ),
          );
          return;
        }

        // Brief cushion after open/qr so the noise handshake can finish.
        await sleep(this.pairingReadyDelayMs);

        if (settled) {
          return;
        }

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const code = await socket.requestPairingCode(phone);
            if (settled) {
              return;
            }
            const display = formatPairingCode(code);
            console.log(`\nWhatsApp pairing code: ${display}`);
            console.log(
              "On your phone: WhatsApp → Linked Devices → Link a device → Link with phone number instead",
            );
            console.log(`Enter code: ${display}\n`);
            return;
          } catch (error) {
            const message = safeErrorMessage(error);
            const closed = /connection closed/i.test(message);
            if (closed && attempt < maxAttempts && !settled) {
              console.log(
                `Pairing request not ready yet (attempt ${attempt}/${maxAttempts}), retrying...`,
              );
              await sleep(2000);
              try {
                await socket.waitForSocketOpen?.();
              } catch {
                // Retry loop will surface the failure.
              }
              continue;
            }
            finish(
              new HitlError(
                "CONNECTION_FAILURE",
                `WhatsApp pairing code failed: ${message}`,
              ),
            );
            return;
          }
        }
      };

      const onUpdate = (update: {
        connection?: string;
        qr?: string;
        lastDisconnect?: { error?: unknown };
      }) => {
        // `qr` means the registration channel is up — safest pairing gate.
        // Do not use `connecting`; the WebSocket may not be open yet.
        if (wantsPairing && update.qr) {
          startPairing();
        }

        if (update.connection === "open") {
          finish("open");
          return;
        }

        if (update.connection === "close") {
          const code = disconnectStatusCode(update.lastDisconnect?.error);
          if (code === BAILEYS_LOGGED_OUT) {
            finish(
              new HitlError(
                "PROVIDER_NOT_AUTHENTICATED",
                "WhatsApp session was logged out. Run `hitl-mcp setup` again.",
              ),
            );
            return;
          }
          // Normal after first QR/pairing link — caller recreates the socket.
          if (code === BAILEYS_RESTART_REQUIRED) {
            finish("restart");
            return;
          }
          finish(
            new HitlError(
              "CONNECTION_FAILURE",
              `WhatsApp connection closed${code ? ` (${code})` : ""}.`,
            ),
          );
        }
      };

      socket.ev.on("connection.update", onUpdate);

      // Fallback if Baileys never emits qr in this environment.
      const pairingFallbackTimer = setTimeout(() => {
        if (wantsPairing) {
          startPairing();
        }
      }, 8000);
      if (!wantsPairing) {
        clearTimeout(pairingFallbackTimer);
      }
    });
  }

  private async flushCreds(): Promise<void> {
    try {
      await this.credsSaveQueue;
      await this.saveCreds?.();
    } catch {
      // Best-effort; auth dir may already be up to date.
    }
  }

  private async requireSocket(): Promise<WhatsAppSocket> {
    if (!this.socket || !this.connected) {
      await this.connect();
    }
    if (!this.socket) {
      throw new HitlError(
        "PROVIDER_NOT_AUTHENTICATED",
        "WhatsApp socket is not available.",
      );
    }
    return this.socket;
  }
}

function isIgnoredChatId(jid: string): boolean {
  return (
    jid === "status@broadcast" ||
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast")
  );
}

async function printQrToTerminal(qr: string): Promise<void> {
  try {
    const qrcode = await import("qrcode-terminal");
    console.log("\nScan this QR code with WhatsApp → Linked Devices:\n");
    qrcode.default.generate(qr, { small: true });
    console.log("");
  } catch {
    console.log("\nWhatsApp QR code received (install qrcode-terminal to render).");
    console.log(qr);
    console.log("");
  }
}

function formatPairingCode(code: string): string {
  const compact = code.replace(/[-\s]/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
