Spec ID: SPEC-JINI-AGENTIC-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:cc94b28e2d77b751424a808bab932a4e131dae5ed436e7f61630097e5dbfe9f5
spec_mode: reverse_spec


# Agentic behavior contract

## Capability and page controls

- When validating input, the core shall check required fields for `undefined`, declared top-level types/enums, and forbidden extra fields. It does not implement full JSON Schema validation or recursively validate nested values.
- When no session exists, capability filtering shall retain only server-surface capabilities. With a session it returns the supplied list. Filtering is not an authorization check.
- When executing a page tool, the executor shall reject unknown tools or invalid input before dispatching to the driver. Navigation shall require an exact id from the driver's page list.
- When highlighting, omitted/invalid duration shall resolve to 3000 milliseconds, capped at 15000. Selection defaults to selected. Stateful element projection is optional and limited to the first 50 elements; the element list itself is not bounded to 50.
- When observing a write, the executor shall collect before/after state and await optional driver settling. It does not impose a timeout on driver methods or prove that a business operation succeeded.
- When exposing field state or filling fields, guards shall refuse sensitive types/autocomplete values and suspicious names/labels. Fill additionally refuses nontext, readonly and disabled fields. State projection withholds values without a safe field description and editable text that could contain field values.
- When normalizing labels, the core shall remove control/bidirectional characters, collapse whitespace and truncate to the requested limit (default 200). These labels remain untrusted content, not instructions.
- When validating handles, the core shall allow lowercase alphanumeric segments separated by single hyphens, within 1–128 characters. Subhandle concatenation and list-handle construction do not independently enforce the complete grammar/length; consumers must validate final handles.
- When building list handles, the core shall slug ids and choose suffixes to avoid duplicates in input order. Slugless ids use positional fallbacks; stability depends on input order and collision context.

## Protocol projections

- When constructing WebMCP tools, names shall match `[A-Za-z0-9_.-]{1,128}`. Execution shall validate input before any confirmation request.
- When a capability requires confirmation, execution shall refuse if no handler exists or its result is not exactly `true`. Other capabilities do not automatically ask for confirmation. The shipped page capabilities do not set that flag.
- When projecting AG-UI tools, the schema field shall be `parameters`. Result serialization shall preserve strings and encode other outputs as JSON; unserializable outputs become an error message rather than throwing serialization errors.
- When encoding GenUI events, unsupported runtime events shall return `null`. The encoder shall correlate tool results with pending calls and clear pending calls on run end. Consumers must isolate encoders per run; run id stamping does not namespace its internal map.
- When recognizing JSON-RPC, guards shall require valid single-message shapes, version `2.0`, compatible ids and exclusive request/response fields. Builders create envelopes; they do not authenticate origins, deduplicate ids or perform transport handshakes.

## DOM adapter boundary

The current `createDomPageDriver` has a duplicate-binding defect and cannot be relied on as callable source. The following describes its implemented branches once that construction defect is repaired: private subtrees are excluded from discovery and actions; a duplicate handle cannot resolve to a unique action target; page attribution follows the nearest marker unless a fixed current page is supplied. Highlight markers restore prior styling and successive highlights replace their timer. Settling races animation-frame completion with a 120 ms timer. Consumers own frame/transport trust and DOM lifecycle.

## A2UI parsing and interpretation

- When parsing agent messages, parsers shall require version `v1.0` and exactly one recognized message key. Zod validates recognized envelopes; wire components allow their catalog-specific props.
- When creating a surface, the interpreter shall require matching catalog id and an unused surface id. Component validation is per component: valid entries apply even when another entry yields a validation error. Repeated component ids overwrite earlier entries.
- When resolving functions, the resolver shall require registration, allowed calling side and an implementation. It catches synchronous implementation errors; implementations returning promises are not awaited.
- When updating data, pointer assignment shall clone the traversed path; `null` deletes object properties or splices arrays. Empty pointer and `/` both address the root. Invalid write pointers return the original document; invalid reads return not-found. This is not full RFC JSON Pointer behavior for the empty-key path.
- When flattening trees, traversal shall be iterative preorder with ancestry-cycle detection and explicit missing-node entries. The 50,000-node cap may add one truncation sentinel; pending traversal memory is not a fixed bound.
- When applying a well-formed message, the interpreter shall notify subscribers synchronously, including no-op/error dispatches. A listener exception propagates after state may already have changed.
- When accepting action responses, the interpreter shall remove matching pending actions, apply successful values at their response path, and discard error values. Unknown action responses are no-ops. Deleting an unknown surface produces a validation error.

`surfaceProperties` and `sendDataModel` are accepted but do not implement a full surface-properties/data-model transport. Stored check rules are not automatically evaluated by action construction. The lab catalog is a subset. No renderer, DOM component set, theme, transport, async-function execution, persistent surface store or complete protocol implementation is supplied.

## Skill installation

- When validating uploads, validation shall require one skill markdown file with YAML name/description, approved normalized paths/extensions, no duplicate paths, bounded file count and bytes, valid UTF-8 text without NUL, and matching image magic for supported assets. It does not execute uploaded scripts or decode images.
- When reading archives, the reader shall bound compressed bytes (8 MiB), entries (256, including directories), single file bytes (1 MiB), and expanded bytes (8 MiB); actual size must match the declared size. The opened archive shall be closed even on rejection.
- When downloading GitHub skills, the downloader shall accept a restricted HTTPS repository/tree URL, pin a resolved 40-character commit, refuse truncated trees/nonregular files, and enforce file/byte limits. Network requests share a 30-second abort signal and refuse redirects; there is no retry policy. A single response has a 16 MiB bound.
- When installing, the installer shall validate/fetch before entering its per-workspace mutation queue. Within one installer instance, operations on the same resolved workspace root shall serialize, and one failure shall not poison subsequent queued operations.
- When installing, the installer shall refuse an existing tool identity, stage files with exclusive creation and mode 0600, then rename into place. Staging cleanup runs in `finally`. This is not a cross-process lock or an atomic transaction covering the post-change callback.
- When enabling/disabling, the installer shall replace the state file using a temporary file/rename. Repeated settings still write and signal a change. Uninstall of an unknown skill rejects.
- When a mutation finishes, `onChanged` shall be awaited. Its failure rejects the operation after the filesystem mutation has committed; callers must inspect state before retrying.
- When using the Node filesystem adapter, bounded reads shall use no-follow file opening and verify a regular file. Layout validation is lexical; it does not establish a realpath/symlink sandbox for every ancestor or operation.

## Live registration

- When replacing live tools, stable delegates shall dispatch through the latest active slot; inactive tools shall disappear from wrapped `list`/`has`, deny policy checks and reject handlers through the host error factory.
- When determining change, replacement shall compare JSON-serialized descriptors. Handler/policy changes alone can return `false`; descriptor updates use assignment and may retain removed properties. Registry registration failures can leave partial changes.
- When refresh calls overlap, the refresher shall coalesce them into a shared promise and clear that promise after success/failure. Middleware shall await refresh and forward failures to `next`.

These modules supply no durable registry, uploaded-code execution sandbox, cross-process installer coordination, HTTP endpoints, application permissions, default YAML/archive parsers or filesystem root provisioning.
