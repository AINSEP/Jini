---
"@jini-ai/admin": minor
---

`DockHeader` takes a required `conversationTools` prop (`DockConversationTools | null`): the host injects extra conversation-switcher props (list-view hooks, pinning, row ticking), a row filter, and an accessory mounted beside the switcher. `KitConversationListProps` gains the matching optional `hooks` (opaque `KitConversationListHooks`), `selectable`, `selectedIds`, `onTogglePin` and `onSelectionChange`, so a host's switcher receives them instead of binding fixed defaults.
