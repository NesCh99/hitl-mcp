# hitl-mcp

> Stay aware of what your agent is doing. Get pinged for tiny decisions. Go back to the chat when something bigger needs you.

HITL-MCP is an **ephemeral communication bridge** between an AI agent execution and a human channel you already use (Slack, …).

It is **not** a task manager, messaging platform, SaaS product, centralized gateway, or agent orchestration system.

The agent owns its own task state and context. HITL only delivers progress and short questions.

---

## Vision

```text
Agent starts work     → notify_human ("Started …")
Agent makes progress  → notify_human (milestones)
Small, quick choice   → ask_human   (brief channel reply)
Something important
  / long to read      → notify_human ("Open the agent chat to reply")
Agent finishes        → notify_human ("Done …")
```

| Situation | Tool | Where you respond |
|---|---|---|
| Progress from start → finish | `notify_human` | Nowhere (FYI only) |
| Tiny question (yes/no, A/B, one line) | `ask_human` | In the channel thread |
| Important / long / needs context | `notify_human` | In the **agent chat** |

HITL is awareness + triage — not a second inbox for deep conversations.

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

Nothing about the interaction is stored by HITL. Pending asks live in memory only and disappear when the process exits.

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

Exactly two:

### `notify_human`

One-way update. Use for:

- start / progress / done
- “Something needs you in the agent chat — open it to reply”

### `ask_human`

Short question; waits for a **brief** channel reply (confirm, pick an option, one line).

Optional `label` sets the Slack thread title. On Slack, the first call opens a thread; later calls stay in it.

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

### MCP client config

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
- [Agent rules](docs/agent-rules.md)

Optional agent guidance: [`agent-rules/HITL.md`](agent-rules/HITL.md)

---

## Non-goals

No task management, databases, REST API, web dashboard, user accounts, or conversation history.

---

## License

MIT
