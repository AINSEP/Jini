---
"@jini-ai/agent-plugins": minor
---

Add `@jini-ai/agent-plugins/admin-surfaces/node` with `createIssuedSignInCollector({ admitHttp })`: the per-request registry of sign-in links issued during one admin-surface action (the receiving half of `onSignInIssued`), keeping https links and host-admitted http links only.
