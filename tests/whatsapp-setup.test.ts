import { describe, expect, it } from "vitest";
import {
  formatListedTarget,
  matchesSetupPhrase,
  normalizeWhatsAppChatJid,
  parseWhatsAppInviteCode,
} from "../src/channels/whatsapp/whatsapp-setup.js";

describe("parseWhatsAppInviteCode", () => {
  it("parses full invite URLs and bare codes", () => {
    expect(
      parseWhatsAppInviteCode("https://chat.whatsapp.com/AbCdEfGh123"),
    ).toBe("AbCdEfGh123");
    expect(parseWhatsAppInviteCode("chat.whatsapp.com/AbCdEfGh123")).toBe(
      "AbCdEfGh123",
    );
    expect(parseWhatsAppInviteCode("AbCdEfGh123")).toBe("AbCdEfGh123");
  });

  it("rejects junk", () => {
    expect(() => parseWhatsAppInviteCode("not a link")).toThrow(/parse invite/i);
  });
});

describe("matchesSetupPhrase", () => {
  it("matches hi hitl fuzzily", () => {
    expect(matchesSetupPhrase("Hi hitl")).toBe(true);
    expect(matchesSetupPhrase("hi, hitl!")).toBe(true);
    expect(matchesSetupPhrase("  HI   HITL  ")).toBe(true);
    expect(matchesSetupPhrase("please hi hitl now")).toBe(true);
    expect(matchesSetupPhrase("hello world")).toBe(false);
  });
});

describe("normalizeWhatsAppChatJid", () => {
  it("strips device suffixes from user JIDs", () => {
    expect(
      normalizeWhatsAppChatJid("593960175021:52@s.whatsapp.net"),
    ).toBe("593960175021@s.whatsapp.net");
    expect(normalizeWhatsAppChatJid("123@lid")).toBe("123@lid");
    expect(normalizeWhatsAppChatJid("999:1@lid")).toBe("999@lid");
  });

  it("leaves groups unchanged", () => {
    expect(normalizeWhatsAppChatJid("1203630@g.us")).toBe("1203630@g.us");
  });
});

describe("formatListedTarget", () => {
  it("shows label with id in parentheses", () => {
    expect(
      formatListedTarget({
        channel: "whatsapp",
        id: "1203@g.us",
        label: "Team",
      }),
    ).toBe("Team (1203@g.us)");
  });
});
