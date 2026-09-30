# Configuration

HITL persists **user preferences** and **provider credentials**.

## Config hierarchy

| Layer | Path | Role |
|---|---|---|
| Global | `~/.hitl-mcp/config.json` | Shared defaults and targets |
| Project | `<workspace>/.hitl-mcp/config.json` | Overrides for one repo (optional) |
| Credentials | `~/.hitl-mcp/credentials/` | Always global |

Project config **overrides** global: `defaultTarget` replaces if set; `targets` merge by **channel** (project wins on the same channel); `channels.*` shallow-merge.

Point the MCP process at the workspace so project config is found:

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

## Config file shape

```json
{
  "defaultTarget": "whatsapp",
  "targets": [
    {
      "channel": "whatsapp",
      "id": "120363412819593593@g.us",
      "label": "Family HITL"
    },
    {
      "channel": "slack",
      "id": "C123456789",
      "label": "#agent-hitl"
    }
  ],
  "channels": {
    "slack": { "enabled": true },
    "whatsapp": { "enabled": true }
  }
}
```

### Targets

At most **one destination per provider channel** (`slack`, `whatsapp`, `fake`).

| Field | Required | Meaning |
|---|---|---|
| `channel` | yes | Provider: `slack`, `whatsapp`, or `fake` |
| `id` | yes | Provider destination (Slack channel id, WhatsApp JID, …) |
| `label` | no | **Display only** — WhatsApp group title or Slack `#channel` |

### `/hitl-channel.<channel>`

The suffix is the **provider channel**, matching `targets[].channel`:

| You type | Uses |
|---|---|
| `/hitl-channel.whatsapp` | the WhatsApp target |
| `/hitl-channel.slack` | the Slack target |
| `/hitl-channel.#agent-hitl` | **no** — that is `label` |
| `/hitl-channel.C123` | **no** — that is `id` |

### Default

`defaultTarget` is a channel: `"whatsapp"` or `"slack"` (etc.).

### Project override example

```json
{
  "defaultTarget": "slack",
  "targets": [
    {
      "channel": "slack",
      "id": "C_TEAM_PROJECT",
      "label": "#project-hitl"
    }
  ]
}
```

## Per-chat controls

Ephemeral (in memory for this MCP process / chat session):

| User types | Agent calls | Effect |
|---|---|---|
| `/hitl.off` | `configure_hitl({ enabled: false })` | Soft-skip ask/notify |
| `/hitl.on` | `configure_hitl({ enabled: true })` | Re-enable |
| `/hitl-channel.slack` | `configure_hitl({ channel: "slack" })` | Use Slack target |
| `/hitl-channel` / clear | `configure_hitl({ channel: null })` | Back to config default |

When disabled, `ask_human` / `notify_human` return a soft success (`skipped: true`) and do **not** send to any channel.

### Runtime tool override

Agents may still pass a per-call `target: { channel, id }`. That beats session channel and config default for that call only; it does not rewrite config files.

## Credentials

Path: `~/.hitl-mcp/credentials/<provider>.json`

Credentials are stored separately from configuration. Files are written with restricted permissions when the OS allows it (`0600`).

HITL does **not** create user accounts. There is no email, password, or centralized identity.

## Setup command

```bash
hitl-mcp setup
```

Flow:

1. Detect existing configuration
2. Ask which channel/provider to use
3. Authenticate that provider
4. Discover available destinations
5. Let you select one (saves `channel` + `id` + `label`)
6. Set that channel as `defaultTarget`
7. Store provider credentials/session as required

Re-run setup anytime to change a channel’s destination or the default.

## What is never stored

- pending requests
- request / correlation IDs
- questions and answers
- conversation history
- agent state
- per-chat `/hitl.off` / channel selection (ephemeral only)
- approval / audit history
