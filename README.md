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
| stdio MVP | No HTTP server for the MVP |
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

# Configure a default channel + target (fake channel for MVP)
npm run setup
# or: node dist/index.js setup

# Run the MCP server (stdio)
npm start
```

### MCP client config (example)

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

## MVP status

The first milestone is **core + FakeChannelAdapter**:

- MCP stdio server
- `ask_human` / `notify_human`
- In-memory pending requests + reply correlation
- Local config + credential store
- `hitl-mcp setup`
- Tests without external providers

Slack (Socket Mode) and WhatsApp adapters are scaffolded under `src/channels/` and are the next implementation milestone.

---

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Channels](docs/channels.md)

---

## Non-goals (MVP)

No task management, databases, REST API, HTTP server, web dashboard, user accounts, analytics, billing, cloud sync, conversation history, or agent orchestration.

---

## License

MIT
