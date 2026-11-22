---
"@jini-ai/chat": minor
---

BREAKING: `mountEmbedChat` requires `surfaces: ChatSurfaces` in its argument and renders the widget inside `ChatSurfacesProvider`, so the imperative embed mounts the real chat pane. Callers of `mountEmbedChat({ element, widget })` must add `surfaces`.
