---
"@jini-ai/cms": minor
---

Add the three taxonomy merge-term ceremony route specs (`admin-http/routes/taxonomy/merge-plan`, `merge-confirm`, `merge-execute`). Each takes the host's binding of the gated-mutation gateway call as a required dep, so the gateway, hooks and token policy stay host-owned.
