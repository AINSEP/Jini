---
"@jini-ai/daemon": minor
---

Every route pack answers a 500 with plain words (what failed and what to do) and the request ID instead of `an internal error occurred`, and the default 500 log line carries the error class only; the host `onInternalError` sink still receives the original error, now with `logSource`. New: `registerAttachmentLookupRoutes(required, { onInternalError })`, `createFrontendControl`'s `session.onInternalError`, and `runId` on `RemoteRunEventInternalErrorContext`. The xAI sink now receives the raw upstream error (no longer pre-redacted), so it must redact before storing. The delegated-tools default fault text is `DELEGATED_TOOL_FAULT_MESSAGE`. **Host action:** if a client or test matched `an internal error occurred`, match the error code `INTERNAL_ERROR` instead; a host xAI `onInternalError` sink must do its own redaction.
