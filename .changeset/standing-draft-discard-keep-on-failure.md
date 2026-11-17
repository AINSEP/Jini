---
"@jini-ai/ui": patch
---

`clearStandingDraft` takes `{ keepOnFailure: true }`: the recovered-draft Discard button keeps the banner and the local copy until the server confirms the discard, so a failed discard no longer hides a draft that is still there.
