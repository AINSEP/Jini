Spec ID: SPEC-JINI-ANALYTICS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b99c671cd6702b04a307c05262470a00ad27e642b5f1df90fe1810bbe2109fcf
spec_mode: reverse_spec

# State Contract: @jini-ai/analytics

LocalBufferSink stores every accepted hit in process memory, retaining references without TTL/dedup/capacity eviction. all returns an insertion-order array copy; list returns the newest entries first with limit default 50/max 500. A durable sink must be provided separately. Type declarations for aggregate/session/event rows do not create database tables or workers.

Analytics daily salt and session IDs derive from caller root seed, scope, UTC-date/time window, and injected hash context. No session store is maintained. Changing seed/context changes identities. Hook transformations are trusted and not revalidated before storage.

Normalized hits retain workspace/time/kind/path/referrer/UTM/coarse classifications, visitorHash, sessionId and optional event data. Raw IP/UA are transient ingest inputs. List/all clone arrays, not hit objects; mutation of retained hit references is visible. Neither root seed nor derived salt is persisted by the package. Initial hits bypass ingest policy.
