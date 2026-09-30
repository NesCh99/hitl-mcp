# Slack channel

HITL-MCP talks to Slack through **Socket Mode** on your local machine.

## Prerequisites

1. A Slack workspace where you can create apps
2. Node.js 20+
3. HITL-MCP installed and built

## Create a Slack App

1. Open [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it and pick your workspace

### Enable Socket Mode

1. **Socket Mode** → enable **Enable Socket Mode**
2. Create an **App-Level Token** with scope `connections:write`
3. Copy the `xapp-...` token

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

Socket Mode replaces a Request URL.

### Install the app

1. **Install App** to your workspace
2. Copy the **Bot User OAuth Token** (`xoxb-...`)

### Invite the bot

In Slack, invite the bot to each channel you want as a HITL target:

```text
/invite @YourBotName
```

Setup lists channels where the bot is a member.

## Configure HITL-MCP

```bash
npm run setup
# or: node dist/index.js setup
```

1. Choose **Slack**
2. Paste the bot token (`xoxb-...`)
3. Paste the app-level token (`xapp-...`)
4. Select a default target, shown as `#channel-name (public|private)`

Credentials are stored under `~/.hitl-mcp/credentials/`. Setup sends a short
greeting to the chosen target so you can confirm delivery.

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

Start the server with `npm start`, or let the MCP client launch the command above.

## How replies work

HITL uses **one Slack thread per MCP connection**:

1. First `ask_human` / `notify_human` posts a root message:
   `**assistant** Started working on {label || id}`
2. Later messages stay in that thread
3. Reply **in the thread**
4. The adapter maps Slack `thread_ts` → `replyToMessageId`
5. HITL resolves the matching pending request; if several wait in the same thread, the oldest wins
6. The pending request is removed from memory

Outbound HITL text is prefixed with `**assistant**`.

Optional `label` is a display title for the opener.

## Tool examples

### ask_human

```json
{
  "question": "Should I create branch feature/x?",
  "label": "Feature X"
}
```

### ask_human with a target override

```json
{
  "question": "Should I create branch feature/x?",
  "target": {
    "channel": "slack",
    "id": "C0123456789"
  }
}
```

### notify_human

```json
{
  "message": "Deploy to staging finished successfully.",
  "label": "Feature X"
}
```

Posts into the same thread, creating the opener first when needed.

## Troubleshooting

| Symptom | Check |
|---|---|
| No targets in setup | Invite the bot to channels; confirm `channels:read` / `groups:read` |
| Messages not received / `ask_human` Socket Mode timeout | Enable **Socket Mode**; app-level token (`xapp-…`) with `connections:write`; Event Subscriptions for `message.channels` / `message.groups`. `notify_human` does **not** need Socket Mode (Web API only). |
| Messages not received | Event subscriptions + `channels:history` / `groups:history`; Socket Mode on |
| `ask_human` times out waiting for reply | Reply **in the thread** |
| Auth errors | Re-run setup; regenerate tokens if revoked |

## Security

- Tokens stay on your machine via the credential store
- Tokens are redacted from error messages
- Runtime HITL state stays in memory and disappears when the process exits
