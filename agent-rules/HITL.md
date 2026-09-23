# HITL-MCP agent rules

Use these rules whenever HITL-MCP tools are available.

## Vision

1. Keep the human aware from start → finish (`notify_human`)
2. Ask only **tiny** questions in the channel (`ask_human`)
3. For anything important or long, notify them to open the **agent chat**

## Progress

```text
notify_human({ message: "Started: refactor auth middleware", label: "auth middleware" })
… work …
notify_human({ message: "Done: auth middleware refactored; tests pass" })
```

## When to ask vs notify

| Need | Tool | Human responds in |
|---|---|---|
| Yes/no, A/B, one-line fact | `ask_human` | Channel thread |
| Long read, design choice, review | `notify_human` | Agent chat |

```text
ask_human({ question: "Use Redis or in-memory cache?" })

notify_human({
  message: "Needs your decision in the agent chat: API versioning strategy. Open the chat to reply."
})
```

## Example flow

```text
notify_human({ message: "Started: ship release notes", label: "release notes" })
ask_human({ question: "Include the beta section? (yes/no)" })
→ channel: "yes"
notify_human({ message: "Review the full draft in the agent chat before I commit." })
→ human replies in agent chat
notify_human({ message: "Done: release notes committed" })
```
