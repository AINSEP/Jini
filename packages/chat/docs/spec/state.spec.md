Spec ID: SPEC-JINI-CHAT-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:2ae197014ea833c697d7fafff3f73bb8c34d909cff984453f0eafc5fae76ff02
spec_mode: reverse_spec


# State contract: @jini-ai/chat

## Durable history

An owner-scoped SQL store binds one immutable `{scopeId, ownerKind, ownerId}` for its lifetime. The host owns the database, migration policy, foreign-key configuration, clock and ID generation. Construction borrows the exact kernel; no connection or transaction context is recreated.

| State | Creation/update | Persistence/removal |
|---|---|---|
| Conversation | Host ID; null title/fallback source; clock timestamps; optional expiry | `ai_chats`; explicit scoped delete or privileged expiry sweep |
| Message | Host ID; monotonically assigned conversation position; JSON events/attachments | `ai_chat_messages`; same-ID upsert preserves position and immutable insertion fields; parent cascade requires host FK enforcement |
| Page cursor | Encoded last sort tuple plus owner/read/conversation binding | Caller-held, versioned, unsigned continuation; conveys no authority and holds no DB snapshot |
| Legacy conversation/message | Synchronous legacy schema and DbRow projections | Separate `conversations`/`messages` tables; no automatic conversion into ai_* history |

A manual title blocks generated replacement. Updating content is not an append-only transcript or a terminal-state fence. The SQL projection stores the fields in its schema; `resumable` and `lastRunEventId` belong to separate run state and are not round-tripped by this adapter. No automatic retention task runs; a privileged host schedules sweepExpired.

## React state and caches

`useRunStream` begins with `{runId:null, status:'idle', events:[], error:null, toolInputDeltas:{}}`. Start/reattach creates a new generation and controllers. Events produce streaming state; done supplies finalEvents; errors retain error state. reset returns to idle and detaches; cancel records intent and requests stop. Tool-input fragments are live-only, not durable history.

`useConversation` owns an optimistic user/assistant message array and scroll intent. Initial messages are a mount-time snapshot; transport status/replay restores eligible interrupted runs. Persistence requires a host store/transport. The hook does not itself write a database.

Composer drafts and attachment metadata are cached per conversation. The private caches retain at most 50 conversations, use sessionStorage when available, tolerate unavailable storage and do not persist File bytes. Attachment-preview source caching retains at most 50 File references in memory. No cache grants permission to read an attachment; preview URLs/files remain host-authorized.

`useLatestOperation` tokens invalidate stale async writes when a newer operation starts or the hook unmounts. RendererRegistry is instance-local and ordered newest first. Tool/ext renderer registries are module-global maps, with overwrite-safe unregister handles and explicit clear functions; they do not survive a process/page reload.

The frontend bridge owns its EventSource, ready promise, chat listeners and a bounded invocation-ID replay guard. close releases the source. Its token is ephemeral; persistence/reconnection of run identity belongs to the host. Attachment uploader accounting is per factory instance, bounded to 100 batch IDs with a one-hour TTL; it reserves quota before requests and rolls it back on failed calls.

The public artifact parser owns an incremental buffer and open artifact state per instance; feed/flush return lazy generators that the caller must consume. Create a parser per independent stream. The package supplies no durable parser checkpoint or cache supervisor.

Evidence: store source and transaction/paging contracts; useRunStream/useConversation tests; composer-draft and attachment-preview cache tests; registry/bridge tests. No runtime checks were executed for this specification.

## Embed and finalizer lifecycle

Each finalizer owns current run watches, checkpoints and reconnect work; idle({}) waits for current watches. Durable status/message atomicity belongs to RunLedger, not the watcher. Fetch-SSE runs own controllers, event buffers/listeners and reader lifetimes; settling/canceling clears them without persistent server replay.

An embed owns open/messages, a pane reset key, pending proposal and processed-message IDs. Session ports persist only bounded open/transcript state and one action. Unmount clears highlighting; reset clears processed IDs and local proposal. Page-action controllers retain one highlight/listener/timer, protect against stale timers/descendant animation events and use host motion policy. Remount for a new session/agent; changing a port does not reinterpret mounted initial state.
