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
ask_human / notify_human
        ↓
   HitlManager
        ↓
  resolve Target  (explicit override → else defaultTarget)
        ↓
  ChannelManager.getAdapter(channel)
        ↓
  ChannelAdapter.sendMessage(targetId, text)
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

- default target
- enabled providers
- provider configuration / IDs
- local preferences

Stored in `~/.hitl-mcp/config.json`.

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

When the MCP process exits, all pending requests disappear. That is intentional.

## Target model

Core uses a single abstraction:

```ts
interface Target {
  channel: ChannelType; // which adapter
  targetId: string;     // destination inside that provider
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

Fallback correlation (if a provider lacks reliable reply links) must stay inside the adapter. Core never requires users to type request IDs.

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

HITL core has **no** Slack- or WhatsApp-specific knowledge.

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

Slack (Socket Mode) is supported. WhatsApp is scaffolded.
