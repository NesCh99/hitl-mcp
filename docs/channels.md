# Channels

Communication providers are plugged in through the `ChannelAdapter` interface.

```ts
interface ChannelAdapter {
  readonly type: ChannelType;
  authenticate(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTargets(): Promise<Target[]>;
  sendMessage(targetId: string, message: string): Promise<SentMessage>;
  onMessage(handler: (message: IncomingMessage) => void): void;
}
```

`ChannelManager` registers adapters and routes by `ChannelType`. It does not own tasks, persistence, or pending-request state.

## Fake (MVP)

`FakeChannelAdapter` exists only for development and testing.

It simulates:

- send message
- receive human response
- message IDs
- reply relationships (`replyToMessageId`)
- multiple targets

All core integration tests use this adapter. No external network is required.

Enable via setup (currently the only fully working provider):

```bash
hitl-mcp setup
# choose Fake (development / testing)
```

## Slack (scaffold)

Location: `src/channels/slack/`

Planned MVP behavior for Slack:

- User configures **their own** Slack App (no centralized HITL bot)
- Local **Socket Mode** connection (no public HTTP endpoint)
- Adapter maps Slack events → `IncomingMessage`
- Thread / reply relationship (`thread_ts`) becomes `replyToMessageId`
- Slack channel IDs become `targetId`

Files:

| File | Role |
|---|---|
| `slack-adapter.ts` | Adapter implementation (scaffold) |
| `slack-auth.ts` | App / token authentication |
| `slack-events.ts` | Event → `IncomingMessage` mapping |

## WhatsApp (scaffold)

Location: `src/channels/whatsapp/`

Planned behavior:

- Authenticate the user's own WhatsApp account / local session
- Discover chats/groups as targets
- Send / receive messages
- Map quote/reply relationships when available
- **Do not** store WhatsApp message history

Files:

| File | Role |
|---|---|
| `whatsapp-adapter.ts` | Adapter implementation (scaffold) |
| `whatsapp-auth.ts` | Local session authentication |
| `whatsapp-events.ts` | Event → `IncomingMessage` mapping |

## Adding a new channel later

1. Implement `ChannelAdapter` under `src/channels/<name>/`
2. Keep all provider-specific IDs and events inside the adapter
3. Register the adapter with `ChannelManager`
4. Extend `ChannelType` / config schema
5. Do not teach HITL core about the provider

Discord, Telegram, Teams, email, etc. are intentionally out of scope for the MVP.
