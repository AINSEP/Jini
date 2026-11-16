---
"@jini-ai/ui": patch
---

Add `useBoundedStatusPoll` and `useOptimisticStoredValue` to `@jini-ai/ui/panel-kit`: a bounded self-scheduling status poll, and a stored value that changes on the spot and drops its optimistic copy once a re-read agrees.
