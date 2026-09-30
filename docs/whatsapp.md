# WhatsApp channel

HITL-MCP talks to WhatsApp through a **local multi-device session** on your
machine via Baileys.

## Warning

This integration uses an **unofficial** WhatsApp Web client library. That can
violate WhatsApp's terms of service and risk account restrictions. Prefer a
**non-primary** number for experimentation, keep traffic human-scale, and do not
treat this as a production messaging platform.

## Prerequisites

1. A WhatsApp account you can link as a companion device
2. Node.js 20+
3. HITL-MCP installed and built

## Configure HITL-MCP

```bash
npm run setup
# or: node dist/index.js setup
```

1. Choose **WhatsApp**
2. Pick a link method:
   - **qr** — scan the QR code in WhatsApp → Linked Devices
   - **pairing** — enter your phone digits and use the pairing code in WhatsApp
3. Select a default target:

   1. **Use my account** — your linked WhatsApp account, shown as `Name (jid)`
   2. **Paste a group invite link** — `https://chat.whatsapp.com/...`
   3. **Detect by message** — send `Hi hitl` in the target chat/group; HITL shows `Name (jid)` and asks to confirm
   4. **Enter a raw JID** — HITL resolves the display name automatically

Setup then sends a short greeting to the chosen target so you can confirm delivery.

Session files live under `~/.hitl-mcp/credentials/whatsapp-auth/`. A small pointer
JSON is stored via the credential store.

| Manual JID examples | Example `id` |
|---|---|
| Direct chat | `15551234567@s.whatsapp.net` |
| Direct chat | `123456789012345@lid` |
| Group | `1203630...@g.us` |

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

HITL correlates WhatsApp replies with **quote replies**:

1. First `ask_human` / `notify_human` posts a root:
   `*assistant* Started working on {label || id}`
2. Later HITL messages in the same MCP session quote that root
3. Reply by **quoting** the HITL question or the opener
4. The adapter maps the quoted message id → session root → `replyToMessageId`
5. HITL resolves the matching pending request; if several wait on the same root, the oldest wins
6. The pending request is removed from memory

Outbound HITL text is prefixed with `*assistant*`. Your phone replies are accepted when they quote a HITL message; echoes of HITL’s own outbound sends are ignored.

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
    "channel": "whatsapp",
    "id": "15551234567@s.whatsapp.net"
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

## Troubleshooting

| Symptom | Check |
|---|---|
| No chats in setup | Wait for sync, or paste a JID |
| QR missing | Use a TTY terminal; try pairing mode |
| `ask_human` times out | Reply by **quoting** the HITL message |
| Connection flaps / 515 after QR | Expected once after linking; HITL restarts the socket |
| `device_removed` / 401 | Stale session. Setup wipes local auth — remove the linked device on your phone, re-run setup, scan once. One HITL process per session |
| Logged out / auth errors | Re-run setup and link the device again |

## Security & data boundary

- Local session credentials
- Runtime HITL state stays in memory and disappears when the process exits
- Prefer a secondary number; treat linked-session files like private keys
