---
"@jini-ai/daemon": major
---

Tool and delegated-route failures now have one incident owner: the host's error reporter.

- `createAssistantToolExecutor` requires `reporter`. `onFailure`, `ToolFailureRecord` and `safeOnFailure` are removed; `toolFailures` is exactly `{ mintErrorId, redactSecretShapes }`.
- `delegatedToolErrorDisclosure(...).describeInternalError` and `describeDelegatedInternalError` return `{ errorId, message }` instead of a string. A trusted id that the daemon's own tool stack stamped is reused without a second write. Otherwise the failure is recorded once through the same reporter, and a thrown object dedupes with the decorator's record. A breached reporter now throws out of the describer, and the route reports the original failure itself.
- `DelegatedToolsInternalErrorContext` drops `correlationId` and gains `errorId` (set only from the in-process result, never from the request). `DelegatedToolsHttpDeps.describeInternalError` returns `{ errorId, message } | undefined`, and the 500's `requestId` is that `errorId`. A new optional `logger` receives one fixed warning when the describer throws. The route no longer writes to `console` in that case and has no console fallback.
- The retired `onInternalError` route option is removed from the HTTP route deps and optional arguments (`RunHttpDeps`, `DaemonDbHttpDeps`, `DelegatedToolsHttpDeps`, `RemoteRunEventHttpDeps`, `TerminalsHttpDeps`, `ModelProxyHttpDeps`, `ConnectorsHttpDeps`, `ResearchHttpDeps`, `MediaHttpDeps`, `MemoryHttpDeps`, `XaiHttpDeps`, `AttachmentsHttpDeps`, `ToolExecutionRoutesOptional`, and `attachmentLookupRoutes`' second argument). A route incident goes only through the host's injected `reportInternalError`; the model proxy's catch-all no longer forwards `host.context.onInternalError` either. Hosts move their sink into that reporter.
- The model proxy's pre-stream 500 uses the incident owner's words (in reporter mode they carry the `ERR-` id). Stream errors keep `code` = the reporter's id and only the fixed stopped message.

This ships in one coordinated cut with the Tovu T3 migration. The Tovu fixtures `delegated-tool-error-disclosure`, `tool-executor-stack.failure-redaction` and `agent-daemon-server.typed-tools.integration` must move off the removed sinks in that same cut.
