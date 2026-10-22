Spec ID: SPEC-JINI-SQLITE-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5b13b98f6b51f2c1ec32239ac1a9773262866fbff44639ee383618ca5cefc4d2
spec_mode: reverse_spec

# SQLite compatibility state contract

The facade owns no connection, singleton, queue, timer or cache. Borrowed event-log close({}) is a no-op; all operations must finish before the host closes db. Host kernels/handles own transaction context and pragmas. Server's legacy acquisition singleton is not part of this entry.

Durable owner state is event-log counters/entries (jini_event_log_runs/jini_event_log_entries), owned transcript rows (ai_chats/ai_chat_messages), host-provisioned legacy conversations/messages/agent_sessions and catalog/FTS tables. Concerns bootstrap independently; import is inert. IF NOT EXISTS does not migrate changed columns. Event-log counters survive retention; drop resets run identity. Cap changes apply on append. Transcript expiry is readable until swept; manual title provenance and telemetry finalization latches persist. Session metadata has no TTL. Catalog snapshots require explicit reseed.

There is no periodic vacuum, run retention scheduler, encryption, schema repair or distributed owner supervision. Canonical lifecycle: [daemon](../../../daemon/docs/spec/state.spec.md), [chat](../../../chat/docs/spec/state.spec.md), [db](../../../db/docs/spec/state.spec.md), [registry](../../../registry/docs/spec/state.spec.md).

