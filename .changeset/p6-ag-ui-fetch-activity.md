---
"@jini-ai/chat": minor
---

`createAgUiFetchAgent` takes an optional `{ abortController, onBytes }` so a host can own cancellation and see byte activity (heartbeats and partial frames) for its idle policy. The returned handle is typed as the new `AgUiFetchAgent`. A resume with an unrecognized resolved payload is now no answer instead of falling through.
