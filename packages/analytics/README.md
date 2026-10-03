# `@jini-ai/analytics`

Standalone visitor analytics for marketing applications. Apache-2.0; ESM; no CMS dependency.
The Node entry exports ingestion/normalization, event-prop validation, daily salts, hash ports,
storage contracts and a process-local buffer sink. Core owns its shared ID/time/JSON contracts.

Hosts supply configuration, storage, workspace scope, privacy bounds, host resolution and the
HKDF salt context. `ingestHit({ input, deps }, { hooks, hash })` normalizes before accepting a
record; `normalizeIngestContext({ input, dailySalt }, { hash })` applies the same privacy policy.
`deriveDailySalt({ rootKeySeed, workspaceId, utcDate, saltContext })` keeps the host's explicit
salt/info prefix so the derivation bytes do not change during migration. Never persist a daily
salt beside analytics data. `LocalBufferSink` is process-local and advertises no durability.

This capability is independent of CMS content: any marketing, website or other application may
supply the ports. The move from the former platform analytics entry preserves behavior and tests.
