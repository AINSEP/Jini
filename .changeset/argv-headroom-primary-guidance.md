---
"@jini-ai/agent-plugins": patch
"@jini-ai/agent-runtime": patch
---

Automatic plugin preflight now inlines the primary guidance for argv-bound adapters when it fits the host's remaining argv headroom (`maxPromptArgBytes`), and falls back to the deferred load pointer otherwise. `resolveArgvPromptBudget` is exported so hosts can compute that headroom with the same platform rule the launch guard uses.
