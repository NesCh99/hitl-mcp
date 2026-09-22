# Configuration

HITL persists only **user preferences** and **provider credentials**. It never persists tasks, messages, responses, or pending requests.

## Config file

Path: `~/.hitl-mcp/config.json`

```json
{
  "defaultTarget": {
    "channel": "slack",
    "targetId": "C123456789"
  },
  "channels": {
    "fake": {
      "enabled": true,
      "targets": [
        { "targetId": "local-hitl", "label": "Local HITL" },
        { "targetId": "development", "label": "Development" }
      ]
    },
    "slack": {
      "enabled": true
    },
    "whatsapp": {
      "enabled": false
    }
  }
}
```

### Default target

Chosen during `hitl-mcp setup`. Used whenever `ask_human` / `notify_human` omit `target`.

```json
{
  "defaultTarget": {
    "channel": "slack",
    "targetId": "C123456789"
  }
}
```

Or:

```json
{
  "defaultTarget": {
    "channel": "fake",
    "targetId": "local-hitl"
  }
}
```

The meaning of `targetId` is owned by the adapter. For Slack it is the channel ID (e.g. `C…`).

For Slack App creation, Socket Mode, and required tokens, see [slack.md](./slack.md).

### Runtime override

Agents may pass a per-call `target`. That override:

- applies only to that call
- does **not** rewrite `config.json`
- leaves the next call (without `target`) on the saved default

## Credentials

Path: `~/.hitl-mcp/credentials/<provider>.json`

Credentials are stored separately from configuration. Files are written with restricted permissions when the OS allows it (`0600`).

A future release may prefer OS secure storage (keychain) behind the same `CredentialStore` / `SecureStorage` interfaces.

HITL does **not** create user accounts. There is no email, password, or centralized identity.

## Setup command

```bash
hitl-mcp setup
```

Flow:

1. Detect existing configuration
2. Ask which channel/provider to use
3. Authenticate that provider
4. Discover available targets
5. Let you select a default target
6. Save config locally
7. Store provider credentials/session as required

Re-run setup anytime to change the default target or configure another provider.

## What is never stored

- pending requests
- request / correlation IDs
- questions and answers
- conversation history
- agent state
- approval / audit history
