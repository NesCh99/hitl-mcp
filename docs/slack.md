# Slack channel

HITL-MCP talks to Slack through **Socket Mode** on your local machine. No public HTTP endpoint and no HITL-operated Slack bot.

## Prerequisites

1. A Slack workspace where you can create apps
2. Node.js 20+
3. HITL-MCP installed and built

## Create a Slack App

1. Open [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it (e.g. `HITL Local`) and pick your workspace

### Enable Socket Mode

1. **Socket Mode** → enable **Enable Socket Mode**
2. Create an **App-Level Token** with scope `connections:write`
3. Copy the `xapp-...` token (store it securely; HITL will ask for it during setup)

### Bot token scopes

Under **OAuth & Permissions** → **Bot Token Scopes**, add:

| Scope | Why |
|---|---|
| `chat:write` | Send `ask_human` / `notify_human` messages |
| `channels:read` | Discover public channels |
| `groups:read` | Discover private channels the bot can see |
| `channels:history` | Receive messages in public channels |
| `groups:history` | Receive messages in private channels |

### Event subscriptions

Under **Event Subscriptions**:

1. Enable events
2. Subscribe the bot to:
   - `message.channels`
   - `message.groups`

Socket Mode replaces a Request URL — you do not need to expose an HTTP endpoint.

### Install the app

1. **Install App** to your workspace
2. Copy the **Bot User OAuth Token** (`xoxb-...`)

### Invite the bot

In Slack, invite the bot to each channel you want as a HITL target:

```text
/invite @YourBotName
```

Setup only lists channels where the bot is a member.

## Configure HITL-MCP

```bash
npm run setup
# or: node dist/index.js setup
```

1. Choose **Slack**
2. Paste the bot token (`xoxb-...`)
3. Paste the app-level token (`xapp-...`)
4. Select a default target (shown as `#channel-name (public|private)`)

Credentials are stored locally under `~/.hitl-mcp/credentials/` (separate from `config.json`). They are never sent to a HITL server and must not be committed to git.

## Connect an MCP client

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

Start the server with `npm start` (or let the MCP client launch the command above).

## How replies work

HITL uses **one Slack thread per MCP connection** (or host-provided transport session when available):

1. First `ask_human` / `notify_human` posts a root message:
   `Started working on {label || id}`
2. Later messages stay **in that thread**
3. Reply **in the thread** in Slack
4. The adapter maps Slack `thread_ts` → `replyToMessageId` (= thread root)
5. HITL resolves the matching in-memory pending request (FIFO if several asks wait in the same thread)
6. The pending request is removed from memory

Optional `label` is only a display title for the opener.

Unrelated channel messages (not in the thread) do not resolve pending questions.

## Tool examples

### ask_human

```json
{
  "question": "Should I create branch feature/x?",
  "label": "Feature X"
}
```

### ask_human (per-call target override)

```json
{
  "question": "Should I create branch feature/x?",
  "target": {
    "channel": "slack",
    "targetId": "C0123456789"
  }
}
```

The override does not change the saved default target.

### notify_human

```json
{
  "message": "Deploy to staging finished successfully.",
  "label": "Feature X"
}
```

Posts into the same thread (creates the opener first if needed).

## Troubleshooting

| Symptom | Check |
|---|---|
| No targets in setup | Invite the bot to channels; confirm `channels:read` / `groups:read` |
| Messages not received | Event subscriptions + `channels:history` / `groups:history`; Socket Mode on |
| `ask_human` times out | Reply **in the thread** (not a new top-level message) |
| Auth errors | Re-run setup; regenerate tokens if revoked |

## Security

- Tokens stay on your machine via the existing credential store
- Tokens are redacted from error messages
- Runtime HITL state (questions, answers, pending requests) is never persisted
