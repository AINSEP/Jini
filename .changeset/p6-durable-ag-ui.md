---
"@jini-ai/chat": minor
---

Bind an AG-UI start to the durable chat lifecycle through an opt-in `durableLocalCli` binding on `AgUiClientPorts` (`prepareRunInput`, `readAcceptedRun`, `followAcceptedRun`, `cancelAcceptedRun`). A bound start runs the same Local CLI preparation as a direct start, resolves with the canonical accepted run ID, follows saved checkpoints instead of replaying the delivery segment, and cancels the canonical run once on explicit Stop. Detaching (unload) closes only the reader. Without the binding, AG-UI behavior is unchanged.
