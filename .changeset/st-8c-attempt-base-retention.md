---
"@jini-ai/chat": minor
---

New subpath `@jini-ai/chat/store/attempt-base-retention`: `createAttemptBaseTrimPolicy({ kernel, now, readerProof }, { minPastDeadlineMs, limit })` and `ATTEMPT_BASE_READERS`. The `attempt-base` retention policy (kind `derived`) clears `assistant_run_attempts.attempt_base_json` for finished runs whose recovery deadline passed at least 7 days ago, at most 500 rows per sweep. It measures only (report-only) unless `readerProof.verifiedReaders` exactly equals `ATTEMPT_BASE_READERS`; `sweep({ now, signal })` takes an optional abort signal. It never writes `events_json` and leaves served messages byte-identical.
