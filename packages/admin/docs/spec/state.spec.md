Spec ID: SPEC-JINI-ADMIN-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e3928347094a7eaa25d55a3d9b47d20b6d65bf07875c016070a2fba7f0046bb4
spec_mode: reverse_spec


# Admin state and lifecycle contract

## Purpose and ownership

This package owns React session, preference and editor state plus a shallow entity registry. It does not own a persistent backend store, request cache, queue, token ledger or worker. Evidence: `src/react/shell/use-admin-shell-session.ts`, `use-admin-theme.ts`, `src/react/hooks`, `src/react/entities/use-entity-{read,edit}.ts`, EntityList and component hooks; their tests were inspected without execution.

## Session gate

```ts
type AdminShellSessionState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: AdminShellSession }
  | { status: 'error'; error: unknown };
```

| Event | Transition / lifecycle |
|---|---|
| Mount or changed context/port identity | checking; install invalidation subscription and start read |
| Read resolves null | anonymous |
| Read resolves session | authenticated |
| Read rejects | error, with original value |
| refresh | checking then read outcome; no-op after unmount or during current pending logout |
| logout | checking, then anonymous on success or error on rejection; older reads cannot restore principal |
| Host invalidation | anonymous immediately; increment generation to retire earlier reads |
| Newer request / different owner | Discard older completion; expose checking synchronously for mismatched context/port |
| Unmount | Unsubscribe, retire unresolved reads; saved callbacks become no-ops |

Reads have no timeout and are not canceled in the adapter. The last current generation wins; state suppression is not network cancellation. Keep context and port identities stable between meaningful scope changes. No session is serialized by this package; cookies/tokens live in the consumer adapter.

## Preferences and appearance

| State | Initialization | Persistence / teardown |
|---|---|---|
| Sidebar rail | Read injected storage once. Missing/read failure uses defaultCollapsed false; stored `1` is collapsed, any other existing value expanded | Toggle writes `1`/`0` best-effort. Listen for matching storage key; removal restores configured default. Unsubscribe on unmount. Default key `jini-admin-sidebar-rail-collapsed` |
| Nav sections | Read one JSON object map of booleans; drop nonbooleans; malformed/missing/read failure becomes empty map. Missing label defaults open | Toggle writes complete map best-effort. Matching storage event re-reads storage; removal clears map. No automatic repair write. Default key `jini-admin-nav-sections` |
| Color-scheme preference | Controlled colorScheme wins; otherwise saved choice for user/workspace, else system | Injected synchronous store reads on user/workspace/store change; writes only on explicit setPreference. No storage events. Scope is userId plus sorted workspace entries. Without user id, no durable write |
| Theme effects | With theme/environment, apply palettes/fonts; with environment, set data-color-scheme | Restore prior CSS/attributes on cleanup. Subscribe to OS color changes only for system; unsubscribe on cleanup. UI dependency reference-counts font leases |

Rail and section keys are read on first render only. Changing storageKey on a mounted hook redirects writes/listeners without loading the new key. These hooks do not add user/workspace scope automatically; consumers select isolated keys. Storage-event sync coordinates tabs, but concurrent full-map writes are not merged. In-place workspace mutation is not a supported update signal.

Appearance returns undefined without an environment. Controlled setPreference still writes/calls the host callback but cannot replace the controlled prop. Preference reads/writes can throw. Effect cleanup restores a captured target snapshot; concurrent writers to the same CSS target need host coordination.

## Entities

- Registry creation validates before publishing, preserves Object.entries registration order, then shallow-freezes a null-prototype map. Ports and descriptors remain owned/mutable by the consumer. A changed registration set requires a new registry/screen registry identity; there is no register/unregister method or persistence.
- Diagnostic erasure creates fresh wrappers per lookup when enabled; it stores no rows or violation history. Without diagnostics it returns the original object.
- Entity read state is bound to load callback and scope identity. A changed scope masks prior data immediately and starts a new read; unmount/cleanup prevents late state updates. Adapter requests continue in the background.
- List cursor history starts with `{cursor: null, offset: 0}`; Next pushes returned cursor and actual rows consumed, Previous pops and re-fetches. Entity, limit or resolved port change resets history. Reload loses history; no page cache is retained.
- Editor state contains draft, raw JSON text/error flags and mutation kind `save | remove | null`. Entity/id changes remount; port/registry changes create a new scope. Read completion builds only declared fields over draft defaults. Unsaved edits are not persisted or protected by a leave warning.
- A synchronous busy flag suppresses repeated mutations and field edits while pending. Current successful save navigates to returned row detail; remove navigates to list. Scope change/unmount suppresses late navigation. It does not cancel an already-started backend write or guarantee exactly-once mutation.
- Failure clears current pending state and exposes a generic failure, retaining editable form data. Updating with undefined asks the adapter to clear optional values; the adapter owns wire encoding and persistent semantics.

## Transient component state

ConfirmButton starts disarmed; first click arms, second click disarms before callback. Blur, Escape and outside mousedown disarm. Pending/disabled blocks activation. Armed listeners are removed on disarm/unmount. There is no expiry timer or persistence.

ConfirmDialog is controlled and intended to stay mounted while open changes. Its hook retains refs, unique title id and opening trigger for focus restoration; it stores no operation outcome. Native cancel never bypasses the controlled open prop.

RowMenu's hook holds open/position/activeIndex and refs; scroll/resize/outside listeners exist only while open. Sidebar tooltip is transient and cleared on rail changes. These hook lifecycles are implemented, but the public Sidebar/RowMenu callers currently have mismatches described in behavior.spec.

The shell mobile drawer starts closed, closes on route-path change, Escape or backdrop, and is independent of desktop rail persistence. An authenticated assistant slot stays mounted while closed via hidden; session gating unmounts it, so no assistant continuity across logout/checking is promised. DataTable sort is controlled by its parent, not stored internally. The HTML editor's mount-lifetime state belongs to the UI dependency; this wrapper stores or saves no HTML.
