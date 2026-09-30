import type { ListedTarget } from "../channel-adapter.js";

const DEFAULT_SETUP_PHRASE = "hi hitl";

/**
 * Extract a WhatsApp group invite code from a full link or bare code.
 * Examples:
 * - https://chat.whatsapp.com/AbCdEfGhIjK
 * - chat.whatsapp.com/AbCdEfGhIjK
 * - AbCdEfGhIjK
 */
export function parseWhatsAppInviteCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Invite link or code is empty.");
  }

  const fromUrl = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/i,
  );
  if (fromUrl?.[1]) {
    return fromUrl[1];
  }

  // Bare invite codes are typically alphanumeric (sometimes with _ / -).
  if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(
    "Could not parse invite. Paste a link like https://chat.whatsapp.com/XXXX or the code alone.",
  );
}

/**
 * Strip device suffixes from 1:1 JIDs so sends go to the user chat, not a
 * single linked device. Groups/broadcasts are left unchanged.
 *
 * Example: `5939…:52@s.whatsapp.net` → `5939…@s.whatsapp.net`
 */
export function normalizeWhatsAppChatJid(jid: string): string {
  const trimmed = jid.trim();
  const at = trimmed.indexOf("@");
  if (at < 0) {
    return trimmed;
  }

  const server = trimmed.slice(at + 1);
  if (
    server === "g.us" ||
    server === "broadcast" ||
    server === "newsletter"
  ) {
    return trimmed;
  }

  if (
    server !== "s.whatsapp.net" &&
    server !== "c.us" &&
    server !== "lid" &&
    server !== "hosted" &&
    server !== "hosted.lid"
  ) {
    return trimmed;
  }

  const userCombined = trimmed.slice(0, at);
  const user = userCombined.split(":")[0] ?? userCombined;
  const normalizedServer = server === "c.us" ? "s.whatsapp.net" : server;
  return `${user}@${normalizedServer}`;
}

/**
 * Fuzzy match for the setup detection phrase (default "Hi hitl").
 * Tolerates punctuation/case and light spacing differences.
 */
export function matchesSetupPhrase(
  text: string,
  phrase: string = DEFAULT_SETUP_PHRASE,
): boolean {
  const normText = normalizePhrase(text);
  const normPhrase = normalizePhrase(phrase);
  if (!normText || !normPhrase) {
    return false;
  }

  if (normText === normPhrase || normText.includes(normPhrase)) {
    return true;
  }

  const compactText = normText.replace(/\s+/g, "");
  const compactPhrase = normPhrase.replace(/\s+/g, "");
  if (compactText === compactPhrase || compactText.includes(compactPhrase)) {
    return true;
  }

  const textTokens = normText.split(/\s+/);
  const phraseTokens = normPhrase.split(/\s+/);
  if (phraseTokens.length >= 2) {
    // Require all phrase tokens to appear in order (not necessarily contiguous).
    let cursor = 0;
    for (const token of textTokens) {
      if (token === phraseTokens[cursor]) {
        cursor += 1;
        if (cursor >= phraseTokens.length) {
          return true;
        }
      }
    }
  }

  return false;
}

export function defaultSetupPhrase(): string {
  return DEFAULT_SETUP_PHRASE;
}

export function formatListedTarget(target: ListedTarget): string {
  if (target.label && target.label !== target.id) {
    return `${target.label} (${target.id})`;
  }
  return target.id;
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
