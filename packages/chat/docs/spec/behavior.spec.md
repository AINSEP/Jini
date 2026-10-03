Spec ID: SPEC-JINI-CHAT-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1a960ae2aaa9e29f595493db6d07558b51215124373b2ad1b3f99edeaa6f4381
spec_mode: reverse_spec


# Behavior contract: @jini-ai/chat

## Transcript and rendering rules

- WHEN assistant content is reconstructed, the core shall join rendered text steps using `ASSISTANT_STEP_SEPARATOR = '\n\n'`; the legacy reconstruction helper preserves its separate compatibility rule. Compaction shall merge adjacent text events without moving other events.
- WHEN repeated tool-use IDs occur, deduplication shall preserve the first occurrence and drop later tool-use duplicates without moving other events. Tool status shall prioritize an explicit result, then an active stream, then successful completion; an ended unsuccessful run without a result shall render an error.
- WHEN a pinned todo's owning run ends, remaining `in_progress` items shall become `stopped` in the projection rather than continue displaying active work.
- WHEN question markup is parsed, the parser shall accept both `question-form` and `ask-question`. Invalid complete forms shall return null; partial parsing shall attempt streaming recovery. Color validation shall reject CSS injection rather than accept arbitrary CSS text.
- WHEN artifact markup appears inside markdown code contexts, the artifact scanner shall avoid treating that example as a live artifact. Recovery/HTML validation shall return explicit absence or `{ok:false, reason}` rather than claim every fragment is a valid standalone document.
- The core shall perform no network request, model invocation, authorization, file write or UI mounting. HTML parsing/validation shall not establish that content is safe to execute; the host owns rendering isolation.

## Scoped storage guarantees

- The SQL store shall copy `scopeId`, `ownerKind` and `ownerId` at construction and include all three predicates in ordinary reads/writes. Unknown and foreign-owned conversation IDs shall be indistinguishable: null records, empty message arrays/pages, or no-op mutation.
- WHEN creating an already-used global conversation ID, the store shall report `conflict`; create shall not silently replay an earlier create.
- WHEN a generated rename races a manual rename, the generated update shall include a non-manual predicate in SQL. Rename defaults to manual; create defaults to null title and fallback title source.
- WHEN appending an existing message ID in its original conversation, the store shall update content/events/attachments/run fields in place, preserving position, role, agent identity and creation time. A collision in another conversation shall return null and shall not update that foreign message.
- The append operation shall take a per-conversation kernel lock within a kernel transaction and reread its result there. The host's outer transaction shall also cover the store operation. This is not a last-writer fence: a later authorized save can overwrite terminal content unless the host supplies settlement ordering.
- The compatibility list shall order by updatedAt descending; compatibility messages shall order by stored position ascending. Paged conversations shall use updatedAt descending, UTF-8 ordinal ID ascending; paged messages shall use position ascending, ordinal ID ascending.
- WHEN paginating, the store shall query at most limit+1 rows and emit nextCursor only when a continuation exists. Limits default to 50 and must be integers 1..200. Cursors shall bind version/read kind/owner scope/conversation and be rejected before data access when malformed or reused across bindings. The maximum encoded cursor length is 8192 characters.
- Pages shall be live keyset views, not snapshots. Deleting an anchor does not invalidate its continuation. Recency changes between requests can change membership.
- Expiry shall affect only explicit maintenance: ordinary reads do not hide expired rows. Maintenance shall delete at most an integer 1..500 conversations (default 500) whose non-null expiresAt is <= supplied finite now. Cascades depend on host schema/foreign-key configuration.
- Malformed persisted event/attachment JSON shall be omitted when projecting the message instead of making the entire transcript unreadable. SQL adapters shall not open, close, migrate or reconfigure kernels at construction. Explicit schema helpers shall execute their DDL only when called.

## UI and browser behavior

- WHEN a newer run operation supersedes a previous one, hooks shall ignore old-generation callbacks. Unmount/reset/replacement shall abort the old subscription. Explicit cancel shall also request host cancellation, including when the run ID arrives after cancellation.
- `useConversation` shall capture initialMessages at mount. A host switching conversations shall remount or update messages deliberately; changing the initialMessages array identity is not a reset API.
- WHEN a renderer registration is overwritten, its old unregister handle shall not delete the newer registration. Tool/ext renderer names are case-sensitive; latest registration wins. Artifact renderer registration shall prepend, so the newest matching renderer wins.
- WHEN attachment upload is enabled, the uploader shall preserve file order with default concurrency 2, validate 20 MiB/file, 10 files/turn, 50 MiB/turn, and abort a call after 30 seconds by default. Reservations shall include overlapping calls sharing a batch ID. Successful partial uploads shall receive best-effort DELETE cleanup after failure; cleanup failure is not a guarantee of immediate removal. Batch accounting retains at most 100 IDs and expires after one hour.
- WHEN an MCP UI call is relayed, the helper shall POST `{toolName, params}` to `/api/mcp-ui/tool-calls` by default, use same-origin credentials, parse JSON or preserve text, and abort after 30 seconds. It shall not authenticate the user, validate tool policy, or provide an allow-list; those are endpoint responsibilities.
- The frontend bridge shall use a dedicated EventSource and response POSTs. A bind token shall be treated as authority distinct from the public session ID. close() shall release the stream; a host shall explicitly wire its transport to carry the ready token when creating a run.

## Registry and CSS ownership

Artifact renderers select the newest registered matching renderer. The reference CSS is exported for opt-in loading and is not auto-applied. Comments now agree with these behaviors.

Evidence: core parser/tool/todo tests; React hook/registry/upload tests; store isolation, parity, paging and transaction contracts. This specification records inspected source behavior, not an executed verification result.

Decision rationale: [Queued page actions are consumed before execution](../decisions/DR-001-single-shot-page-actions.md), [Streaming adapters close message boundaries on interruption](../decisions/DR-002-stream-interruption-boundaries.md).

Decision rationale: [Human surfaces survive reconnect with honest status](../decisions/DR-003-human-surface-rehydration.md).

## Dedicated streaming and embed rules

Run-frame translation preserves error-before-success precedence, tool/UI correlation, ordered compaction and paragraph boundaries; malformed frames fail softly where declared. AG-UI closes text/reasoning before tool calls and on host termination; its legacy reducer is independent of saved-chat reduction (partial tool input becomes custom extension, media is not TOOL_CALL_RESULT).

Finalizers deduplicate watches by run ID and ignore nonassistant/terminal/statusless/external runs. Checkpoints cannot overtake a terminal row because the host ledger owns atomic first-terminal-write semantics. Streams reconnect under the configured bound; exhausted/interrupted runs settle using host notices. Fetch-SSE transport sends one POST per run, settles/cancels once, releases readers and ignores frames after end; it supplies no reattachable server state.

Session storage fails softly on serialization/storage failures, clears corrupt envelopes as a whole, validates before returning, trims oldest messages to bounds, and deletes a queued action before delivery; failed deletion prevents delivery. Page-action URL policy applies before queue/navigation/effects. Restored replies are marked processed before mounting, so they cannot repeat navigation. New terminal assistant directives run once per message ID. Reset requires confirmation when messages exist, clears storage and remounts the pane; navigation can be explicit proposal or policy-admitted auto action.
