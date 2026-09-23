import { describe, expect, it } from "vitest";
import { resolveSession } from "../src/mcp/session.js";

describe("resolveSession", () => {
  it("uses transport sessionId when present", () => {
    const resolved = resolveSession({
      connectionId: "conn-fallback",
      transportSessionId: "transport-xyz",
      label: "Ship notes",
    });
    expect(resolved).toEqual({
      id: "transport-xyz",
      name: "Ship notes",
    });
  });

  it("falls back to MCP connection id", () => {
    const resolved = resolveSession({
      connectionId: "conn-123",
      label: "  Feature X  ",
    });
    expect(resolved).toEqual({
      id: "conn-123",
      name: "Feature X",
    });
  });

  it("ignores empty labels", () => {
    const resolved = resolveSession({
      connectionId: "conn-123",
      label: "   ",
    });
    expect(resolved.name).toBeUndefined();
  });
});
