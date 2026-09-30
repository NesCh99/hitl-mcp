# Cursor

Optional guide if you use HITL-MCP with Cursor.

## Allow HITL tools

Add HITL to Cursor’s **allowed tools** so you are not prompted to approve every HITL call.

**IDE:** Settings → Agents / Tools → allow the `hitl` MCP tools (or allow the `hitl` server).

**CLI** (`~/.cursor/cli-config.json`):

```json
{
  "permissions": {
    "allow": [
      "Mcp(hitl, ask_human)",
      "Mcp(hitl, notify_human)",
      "Mcp(hitl, configure_hitl)"
    ]
  }
}
```

If your MCP server is named differently in `mcp.json`, use that name instead of `hitl`.

## MCP config (project)

Prefer **project** `.cursor/mcp.json` so HITL is only available where you want it. Pass the workspace so project HITL config merges:

```json
{
  "mcpServers": {
    "hitl": {
      "command": "node",
      "args": ["/absolute/path/to/hitl-mcp/dist/index.js"],
      "env": {
        "HITL_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Optional project overrides: `<workspace>/.hitl-mcp/config.json` (see [configuration.md](./configuration.md)).

## Per-chat slash commands

Type in the agent chat (the agent should call `configure_hitl`):

| Command | Effect |
|---|---|
| `/hitl.off` | Soft-disable HITL for this chat |
| `/hitl.on` | Re-enable |
| `/hitl-channel.slack` | Use the Slack target |
| `/hitl-channel.whatsapp` | Use the WhatsApp target |

The part after `/hitl-channel.` is the **provider** (`slack` / `whatsapp`), not the human `label`. See [configuration.md](./configuration.md).

## Thread identity

With Cursor today, the channel thread is keyed by the MCP connection / transport session. Optional `label` titles the thread opener.

## Timeouts

`MCP error -32001: Request timed out` comes from Cursor’s MCP client.

| Path | Approx. limit |
|---|---|
| CLI / ACP | ~60 seconds |
| IDE Agent | Longer (tens of minutes) |

Keep `ask_human` for tiny, fast answers. For slower decisions, use `notify_human` and continue in the chat.
