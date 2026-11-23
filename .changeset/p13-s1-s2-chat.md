---
"@jini-ai/chat": minor
---

Add `createViewEscapeKeyPort` to `@jini-ai/chat/react/embed`, a default capture-phase Escape-key port that keeps a confirm-step Escape from closing the host dialog, and `createSafeMarkdownRenderer` to `@jini-ai/chat/vanilla`, which wraps a host's trusted markdown-to-HTML converter, drops off-origin images before insertion and hardens links.
