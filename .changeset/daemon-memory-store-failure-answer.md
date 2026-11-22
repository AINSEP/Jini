---
"@jini-ai/daemon": minor
---

Owner decision DM-MEM: when a memory store call throws (tree-node update, index write, config write, entry create, update, delete), the route answers `500 INTERNAL_ERROR` with one fixed sentence and a request ID instead of `400 BAD_REQUEST` carrying the store's own message (which could hold a filesystem path or driver text). The real error goes to the host's sink (`MemoryHttpDeps.onInternalError`, new, with `MemoryInternalErrorContext`; the routes take the host's reporter as `MemoryRouteDeps.reportInternalError`) under the same ID. The store's one expected refusal, `note not found`, still answers 404.
