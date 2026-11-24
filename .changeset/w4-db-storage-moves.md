---
"@jini-ai/core": minor
"@jini-ai/cms": minor
"@jini-ai/db": minor
"@jini-ai/platform": minor
"@jini-ai/oauth": patch
---

Storage/platform extraction (w4-db): new `@jini-ai/core/keyset-cursor` (moved from `@jini-ai/cms/core`, which no longer exports `encodeKeysetCursor`/`decodeKeysetCursor`/`KeysetPosition` — import them from core); new `@jini-ai/cms/routing/site/reserved-paths`, `@jini-ai/cms/media/site/access-evidence`, `@jini-ai/cms/publish/content/sql/baseline-repo`, `@jini-ai/cms/publish/transfer/sql/bundle-repo`, `@jini-ai/cms/publish/transfer/sql/backstop-audit-repo` (host injects `tableExists`); new `@jini-ai/db/recovery/{drift,journal-kernel,journal-schema,journal-repo.sql}` (restore-points repo takes an optional `errorRedaction` from the host) and `@jini-ai/db/watermark/kernel` (host injects the watermark table name); `@jini-ai/platform/secrets/credential-sets` gains the store-vault guards; `@jini-ai/oauth` error/registry headers carry the moved host rationale (docs only).
