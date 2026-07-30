---
"@jini-ai/chat-react": minor
---

Make the chat-pane transcript readable from outside the component — a must-have for an AI (or an
e2e harness) verifying that commands it gave the pane (create a form, add a user, change a
permission) actually happened.

Before this, `<ChatPane>` fully encapsulated its conversation state: `useConversation()`'s
`messages` never left the component, `ChatPaneProps` had no callback that reported the live message
list, and the rendered transcript (`MessageList`/`MessageRow`/`ToolCard`) carried zero
`data-agent-element` tags — unlike every other interactive surface in this app's reference pages.

- `ChatPaneProps.onMessagesChange?: (messages: ChatMessage[]) => void` — fires with the full message
  array on every change, mirroring the existing `onActivityChange` pattern. Each `ChatMessage`
  already carries its `events` array (`tool_use`/`tool_result`), so a subscriber gets complete,
  structured tool-call data for free — no DOM parsing needed.
- `data-agent-element="chat-transcript"` (role `list`) on the message-list container, and
  `data-agent-element="chat-message-<id>"` (role `region`) on every message row, so `page.*` DOM
  tools can enumerate the transcript the same way they read everything else in this app.
- `ToolCard` now wraps whatever it renders (any of its dozen built-in card variants, or a host's own
  custom-registered renderer) in one `data-agent-element="tool-call-<use.id>"` (role `region`)
  element — added at the single dispatch point every branch already funnels through, so no
  individual card variant's own markup changed. The collapsed-by-default accordion detail (args/
  result JSON) sits inside this tagged element, not gated behind expanding it: `textContent` (what
  the `page.*` DOM driver actually reads) is layout-agnostic, so the full detail is readable whether
  or not anything has been clicked open.
