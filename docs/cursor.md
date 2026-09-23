# Cursor

Optional guide if you use HITL-MCP with Cursor.

## Allow HITL tools

Add HITL to Cursor’s **allowed tools** so you are not prompted to approve every `notify_human` / `ask_human` call.

**IDE:** Settings → Agents / Tools → allow the `hitl` MCP tools (or allow the `hitl` server).

**CLI** (`~/.cursor/cli-config.json`):

```json
{
  "permissions": {
    "allow": [
      "Mcp(hitl, ask_human)",
      "Mcp(hitl, notify_human)"
    ]
  }
}
```

If your MCP server is named differently in `mcp.json`, use that name instead of `hitl`.

## MCP config

```json
{
  "mcpServers": {
    "hitl": {
      "command": "node",
      "args": ["/absolute/path/to/hitl-mcp/dist/index.js"]
    }
  }
}
```

## Thread identity

HITL does not ask the model to pass a session id. With Cursor today, the Slack thread is keyed by the MCP connection (usually one process per workspace). Optional `label` is only a display title for the thread opener.

## Timeouts

`MCP error -32001: Request timed out` comes from Cursor’s MCP client.

| Path | Approx. limit |
|---|---|
| CLI / ACP | ~60 seconds |
| IDE Agent | Longer (tens of minutes) |

Keep `ask_human` for tiny, fast answers. For slower decisions, use `notify_human` and continue in the chat.
