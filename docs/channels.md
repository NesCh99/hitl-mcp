# Channels

Communication providers plug in through the `ChannelAdapter` interface.

```ts
interface ChannelAdapter {
  readonly type: ChannelType;
  authenticate(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTargets(): Promise<ListedTarget[]>;
  sendMessage(targetId: string, message: string, options?: SendMessageOptions): Promise<SentMessage>;
  sendPlainMessage(targetId: string, message: string): Promise<SentMessage>;
  onMessage(handler: (message: IncomingMessage) => void): void;
}
```

`ListedTarget` extends `Target` with an optional `label` for setup UIs. Core
routing uses `{ channel, targetId }`.

After `hitl-mcp setup` selects a default target, it calls `sendPlainMessage` with
a short greeting so you can confirm delivery.

All outbound HITL messages are prefixed with `**assistant**`.

`ChannelManager` registers adapters and routes by `ChannelType`.

## Fake

`FakeChannelAdapter` is for development and testing.

```bash
hitl-mcp setup
# choose Fake
```

## Slack

Location: `src/channels/slack/`

- Local Socket Mode via `@slack/socket-mode` + `@slack/web-api`
- One Slack thread per MCP connection
- Target discovery for channels the bot has joined
- Session root `ts` → correlation; `thread_ts` → `replyToMessageId`
- Credentials via `CredentialStore`

Full guide: [slack.md](./slack.md)

| File | Role |
|---|---|
| `slack-adapter.ts` | Socket Mode adapter |
| `slack-auth.ts` | Credential schema + redaction |
| `slack-events.ts` | Event → `IncomingMessage` |
| `types.ts` | Injected client interfaces for tests |

## WhatsApp

Location: `src/channels/whatsapp/`

- Local multi-device session via `@whiskeysockets/baileys`
- One conversation root per MCP session
- Target discovery from live chat metadata and setup helpers
- Quoted message id → correlation
- Credentials via `CredentialStore` + local auth directory

Full guide: [whatsapp.md](./whatsapp.md)

| File | Role |
|---|---|
| `whatsapp-adapter.ts` | Baileys adapter |
| `whatsapp-auth.ts` | Credential schema + redaction |
| `whatsapp-events.ts` | Event → `IncomingMessage` |
| `types.ts` | Injected client interfaces for tests |

## Adding a new channel

1. Implement `ChannelAdapter` under `src/channels/<name>/`
2. Keep provider-specific IDs and events inside the adapter
3. Register with `ChannelManager` in `createApp`
4. Extend setup credential collection if needed
