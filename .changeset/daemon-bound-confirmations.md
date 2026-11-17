---
"@jini-ai/daemon": minor
---

`@jini-ai/daemon/surface-exchanges` adds `createBoundConfirmations` (single-use, owner-checked, capped human confirmation exchanges bound to one execution) and `createBoundConfirmationGate` (an `ExecutionDelegate` that binds an approval to a policy snapshot revision and the exact input digest, re-validated after the click and before the handler).
