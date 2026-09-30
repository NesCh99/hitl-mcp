# Architecture

HITL-MCP is a local-first, ephemeral communication bridge between an AI agent and a human.

## Separation of concerns

```text
AGENT
→ owns task state, reasoning, context and orchestration

HITL CORE
→ owns ephemeral human communication and correlation

CHANNEL ADAPTER
→ owns provider-specific communication

CONFIG
→ owns persistent user preferences

CREDENTIAL STORE
→ owns persistent provider authentication

NOTHING ELSE
```

## Request path

```text
ask_human / notify_human / configure_hitl
        ↓
   HitlManager
        ↓
  [configure_hitl] SessionPrefsStore (ephemeral per chat)
        ↓
  [ask / notify]
  if session disabled → soft skip (no send)
        ↓
  resolve Target
    (explicit override → session channel → config.defaultTarget → targets by channel)
        ↓
  ChannelManager.getAdapter(channel)
        ↓
  ChannelAdapter.sendMessage(id, text)
        ↓
  [ask_human only]
  PendingRequestManager (in-memory Map)
        ↓
  wait for IncomingMessage correlated by replyToMessageId
        ↓
  resolve promise → return to agent → delete pending entry
```

## Data categories

### Persistent configuration (allowed)

- named targets (`targets`, one per provider channel)
- default channel (`defaultTarget`)
- enabled providers
- provider configuration / IDs
- local preferences
- optional project overrides in `<workspace>/.hitl-mcp/config.json`

Stored globally in `~/.hitl-mcp/config.json`, optionally merged with a project file.

### Persistent credentials (allowed)

- Slack tokens / app credentials
- WhatsApp local session data
- other provider credentials

Stored under `~/.hitl-mcp/credentials/`, separated from config and from runtime state.

### Ephemeral runtime state (never persisted)

- pending requests
- request IDs
- agent / MCP connection context
- questions and responses
- message correlation mappings
- timeouts
- agent task state
- per-chat HITL prefs (`/hitl.off`, `/hitl-channel.*`)

When the MCP process exits, all pending requests and session prefs disappear. That is intentional.

## Target model

Core uses a single abstraction:

```ts
interface Target {
  channel: ChannelType; // which adapter
  id: string;           // destination inside that provider
}
```

Core does **not** model conversation, chat, room, channel, or group as separate concepts. Those are provider-specific and belong in adapters.

## Correlation

Preferred mechanism: the provider's native reply / thread relationship, exposed as:

```ts
IncomingMessage.replyToMessageId
```

Example:

1. HITL sends a question → outbound `messageId = msg-123`
2. Human replies to that message
3. Adapter maps the event with `replyToMessageId = msg-123`
4. `PendingRequestManager` resolves the matching in-memory request

Adapters own how provider reply links map onto `replyToMessageId`.

## Multiple agents / connections

Each pending request includes a temporary `connectionId` for the MCP connection / execution context.

```text
Agent A → MCP connection A → pending A1
Agent B → MCP connection B → pending B1
```

Responses route by outbound message correlation. When a connection closes, all of its pending requests are rejected and removed from memory.

## Channel adapters

Adapters own:

- authentication
- connection
- target discovery
- send / receive
- provider IDs
- reply / thread mapping
- sender identity
- event format translation → `IncomingMessage`

HITL core keeps provider details inside adapters.

## MVP shape

```text
MCP stdio
+ HITL Core
+ PendingRequestManager
+ Correlation
+ Configuration
+ FakeChannelAdapter
+ Tests
```

Supported channels: Slack and WhatsApp.
