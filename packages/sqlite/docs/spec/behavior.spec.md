Spec ID: SPEC-JINI-SQLITE-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:3b04dd3ee5d133a60836718386bd4f586f858ad179eb2e2fc7b8b9c24aec9065
spec_mode: reverse_spec

# SQLite compatibility behavior contract

The facade re-exports owner implementations without wrappers, hidden acquisition, driver selection or authorization. Server acquisition/bootstrap/backend selection/project composition are outside its current surface. Public calls preserve the owners' object arguments; row-value parsers remain positional.

Event-log construction validates a nonnegative safe-integer retention cap (default 2000), creates schema and borrows the connection. Append atomically creates run state, checks options.dedupeKey against retained entries, inserts, advances the persistent per-run cursor and evicts oldest entries. Zero retains counters but evicts all entries. Dedupe expires with its retained row. Replay is ascending, strictly after the cursor, and reports retained gaps. Null starts at retained beginning; Number(cursor) validation accepts numeric spellings such as empty/exponent strings. Unsupported JSON does not promise faithful round trips. Drop removes entries/counter and permits a new sequence from 1.

Owned chat transcripts enforce immutable scope/owner predicates; misses for foreign and absent rows are indistinguishable. Message append and ordering use the host kernel transaction; expiry is removed only by explicit privileged maintenance. Legacy message/conversation/session calls have no owner predicates and require host authority. Stream-event append deduplication is consecutive only and needs host writer serialization.

Catalog reseed replaces rows and FTS atomically; search uses ASCII terms combined with OR and inverted BM25 (id weight 6, description weight 1). Search defaults to 10 without low-level limit validation. Discovery never authorizes/executes tools. Inspection tolerates SQL/stat failures; integrity reports contain issues rather than repairing storage. Host driver/pragmas determine durability and cascades.

Canonical behavior: [daemon](../../../daemon/docs/spec/behavior.spec.md), [chat](../../../chat/docs/spec/behavior.spec.md), [db](../../../db/docs/spec/behavior.spec.md), [registry](../../../registry/docs/spec/behavior.spec.md). No runtime checks were executed.

