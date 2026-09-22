# Channels

Communication providers are plugged in through the `ChannelAdapter` interface.

```ts
interface ChannelAdapter {
  readonly type: ChannelType;
  authenticate(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTargets(): Promise<ListedTarget[]>;
  sendMessage(targetId: string, message: string): Promise<SentMessage>;
  onMessage(handler: (message: IncomingMessage) => void): void;
}
```

`ListedTarget` extends `Target` with an optional `label` for setup UIs. Core routing still uses only `{ channel, targetId }`.

`ChannelManager` registers adapters and routes by `ChannelType`. It does not own tasks, persistence, or pending-request state.

## Fake

`FakeChannelAdapter` exists for development and testing. Core tests use it exclusively (no network).

```bash
hitl-mcp setup
# choose Fake (development / testing)
```

## Slack (Socket Mode)

Location: `src/channels/slack/`

Working end-to-end:

- User’s own Slack App (no centralized HITL bot)
- Local Socket Mode via `@slack/socket-mode` + `@slack/web-api`
- Target discovery for public/private channels the bot has joined
- `ts` → `messageId`, `thread_ts` → `replyToMessageId`
- Credentials via existing `CredentialStore`

See the full guide: [slack.md](./slack.md)

| File | Role |
|---|---|
| `slack-adapter.ts` | Socket Mode adapter |
| `slack-auth.ts` | Credential schema + redaction |
| `slack-events.ts` | Event → `IncomingMessage` |
| `types.ts` | Injected client interfaces for tests |

## WhatsApp (scaffold)

Location: `src/channels/whatsapp/`

Not registered in the running app yet. Planned later: local session auth, targets, send/receive — without storing message history.

## Adding a new channel later

1. Implement `ChannelAdapter` under `src/channels/<name>/`
2. Keep provider-specific IDs and events inside the adapter
3. Register with `ChannelManager` in `createApp`
4. Extend setup credential collection if needed
5. Do not teach HITL core about the provider
