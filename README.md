# hitl-mcp

> Connect your AI agent to a conversation you already use. When the agent needs you, it asks there.

HITL-MCP is an **ephemeral communication bridge** between an AI agent execution and a human.

It is **not** a task manager, messaging platform, SaaS product, centralized gateway, or agent orchestration system.

The agent owns its own task state and context. HITL only provides the communication bridge.

---

## Core idea

```text
AGENT
  ↓
MCP stdio
  ↓
HITL Core
  ↓
Channel Adapter
  ↓
Slack / WhatsApp / …
  ↓
Human
```

When the agent needs a decision, confirmation, or input, it calls `ask_human`. The question appears in a channel you already use. Your reply resolves the call. Then the pending request disappears from memory.

Nothing about the interaction is stored by HITL.

---

## Principles

| Principle | Meaning |
|---|---|
| Local-first | The MCP runs on your machine |
| stdio MVP | No HTTP server for event delivery |
| No central backend | No HITL cloud, no shared gateway |
| No HITL account | No email, password, or centralized identity |
| No task database | Agents keep their own state |
| Ephemeral pending requests | In memory only; gone when the process exits |
| User-owned providers | Your Slack app / your WhatsApp session |
| Persistent config only | Default target + provider prefs locally |
| Credentials separated | Tokens/sessions stored apart from runtime state |
| Per-call overrides | Override the default target without changing config |

**Architectural rule:** if a feature requires HITL to remember something after the current agent execution ends, that feature probably does not belong here.

---

## MCP tools

### `ask_human`

Send a question and wait for a human reply.

```json
{
  "question": "Which option should I choose?",
  "target": { "channel": "slack", "targetId": "C123" },
  "timeoutMs": 300000
}
```

`target` is optional. Without it, the configured default target is used. An override never modifies the saved default.

For Slack, reply **in the thread** of the bot’s question.

### `notify_human`

One-way notification. No pending request. No wait.

```json
{
  "message": "Deploy finished successfully."
}
```

---

## Quick start

```bash
npm install
npm run build

# Configure Slack (or Fake for local testing)
npm run setup
# or: node dist/index.js setup

# Run the MCP server (stdio)
npm start
```

### Slack (Socket Mode)

1. Create a Slack App with Socket Mode enabled
2. Add bot scopes and `message.channels` / `message.groups` events
3. Install the app, copy `xoxb-` and `xapp-` tokens
4. Invite the bot to your HITL channel
5. Run `hitl-mcp setup` → choose Slack

Full walkthrough: [docs/slack.md](docs/slack.md)

### MCP client config (Cursor example)

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

---

## Status

| Channel | Status |
|---|---|
| Fake | Working (tests / local dev) |
| Slack (Socket Mode) | Working |
| WhatsApp | Scaffold only |

---

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Channels](docs/channels.md)
- [Slack setup](docs/slack.md)

---

## Non-goals

No task management, databases, REST API, HTTP server for Slack events, web dashboard, user accounts, analytics, billing, cloud sync, conversation history, or agent orchestration.

---

## License

MIT
