Spec ID: SPEC-JINI-UI-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:60dbce55ea4f98df8bf20702d50967229db75234f7d0a9559d20fc0f1fbf0fdb
spec_mode: reverse_spec


# State contract: @jini-ai/ui

## Ownership and persistence

State is scoped to the named provider, hook, registry, document or process below. There is no package-wide durable store. Prop-owned data remains consumer state; callbacks/ports decide persistence. Public fake ports are fixtures. Browser storage adapters and locale/auth ports are explicit mechanisms, not a promise to synchronize all package features.

## Provider query cache

`FetchQueryProvider` constructs one isolated cache per mount/environment identity. Changing its environment object creates a new cache. Structural primitive keys share entries inside that provider; providers never share a cache singleton. A new entry has undefined data, null error, internal pending status and no request. Public pending is exposed as loading.

| Event | Entry state / effect |
|---|---|
| Enabled read or loader load | Fresh hit resolves existing data; otherwise one pending promise per key and isFetching true. |
| Successful read | Publishes data, null error, success, isFetching false and clock timestamp. |
| Failed read | Retains data, publishes normalized error/error status/isFetching false; promise rejects original failure. |
| Forced refetch | Bypasses freshness; shares pending initial read without data, otherwise supersedes existing background request. Older callers follow the newer result. |
| Replacement | Increments replacement counter, installs authoritative cache value/success/time. Older successful read returns replacement value; old rejection can still publish error. |
| Prefix invalidation | Marks matching entries invalid; active observer forces refresh with the same initial/background distinction. |
| Observer/subscriber removed | Idle eviction begins only after no listeners/observers/pending request remain. |
| Provider cleanup | Removes focus/visibility listeners and cancels eviction timers. It does not abort requests. Effect replay can reactivate the same cache. |

Default staleTime is 10000ms. Idle retention is at least 300000ms or the largest declared staleTime for that entry. Non-finite retention schedules no eviction. Retention resets from the scheduling event, not the last successful fetch. Focus refetch is opt-in and only for stale enabled observers; visibility becoming visible invokes the same check.

No serialization, disk/session storage, request timeout, maximum entry count or user/tenant partition is built in. Consumers encode data scope in keys and remount scopes when identity changes. Loader peek reads current cached data without fetching/subscribing.

The provider accepts an optional connectivity/focus environment, defaulting to browser signals. Offline reads wait for reconnection with isFetching false; stale active reads refresh on reconnect. Disposal unsubscribes the environment and cancels timers but does not reject offline waiters or abort requests. Mutations run directly without connectivity waiting. Successful undefined query data rejects; failed reads mark entries invalidated for the next load.

Mutations start idle, then pending, then latest success/error. Reset advances generation and returns idle; unmount suppresses React settlement updates. Every successful mutation can still invalidate cache even when its visible settlement is superseded.

Evidence: `src/features/panel-kit/fetch-query/cache.ts`, `adapter.react.tsx` and `__tests__/fetch-query.test.tsx`.

## Write lanes and settlement generations

Each `useSerialWrites` instance owns a lane-tail map. Default lane and each string key are independent; task execution waits for prior tail, releases in finally, and removes an idle lane only if no newer tail replaced it. Queued tasks survive unmount until their promises settle. No maximum queue length, timeout, abort/dispose or persistence exists. A task awaiting a new task in its own lane can deadlock; callers must avoid that dependency.

`useSettlementGeneration` owns an integer starting at zero and one stable handle. `next()` increments; only equality with current counter is current. Unmount does not invalidate already captured handles. `useAsyncAction` owns saving/error only and has no lane or generation; overlapping operations can settle its state out of order.

Dirty guard derives state from current/original JSON on each render. It registers beforeunload only while dirty and removes its listener during cleanup; it neither saves drafts nor owns navigation.

Evidence: `src/features/panel-kit/hooks/` source and tests.

## Confirmation store and early messages

Confirmation factory owns a Map for its lifetime. Mint lazily sweeps expired entries, copies the binding and stores summary/expiry under digest(raw token). Redeem deletes a found entry before checking expiry/binding; failure consumes it. size lazily sweeps and returns pending unexpired count. Default TTL is 300000ms. No background sweep, size cap, durable storage or shutdown method exists. Loss of the store requires fresh confirmation. Default storage holds raw tokens; digest adapter may substitute a hash.

Random-token collision is not checked; injected token/digest sources must avoid collisions. TTL is not range-validated. Expiry is `expiresAtMs <= now()`, so equality is expired. The returned successful PendingConfirmation is an object reference, not a frozen copy.

Early buffer owns backlog and a subscriber Set. With no subscribers push appends and trims one oldest item past the default 200 cap; with subscribers push broadcasts without backlogging. First subscriber drains backlog, later subscribers see future messages only. Its disposer removes that handler. It has no persistence or TTL; callback exceptions propagate and can interrupt delivery.

Evidence: `src/features/mcp-ui/{confirmation-store.ts,early-message-buffer.ts}` and tests.

## MCP host session

The hook starts awaiting-ready with null size and null teardownAcknowledged. Session identity is sessionKey or HTML. Changing that identity or ready deadline restarts the watchdog; component wrapper keys AppRenderer by sessionKey or HTML.

| Trigger | State |
|---|---|
| First size callback before settlement | ready; stores reported size |
| Deadline without size | timed-out |
| Client error before settlement | errored |
| requestTeardown while ready | Sends best-effort teardown, then torn-down |
| requestTeardown outside ready | No-op |
| Late size after settlement | Updates size; does not change settled state |

Default ready deadline is 4000ms. DEFAULT_TEARDOWN_TIMEOUT_MS is exported compatibility data, not an enforced acknowledgment deadline. Teardown acknowledgment always remains null. Session effects clear watchdog timers on cleanup; there is no persisted handshake or tool transaction ledger.

Evidence: `src/react/mcp-ui/{useMcpUiHost.ts,McpUiHost.tsx}` and tests.

## Iframe keep-alive pool

Provider owns entries keyed by caller string and a set of active keys. Attach creates or reuses the iframe, records last-use time and appends to active host. Release marks inactive and moves the iframe into a hidden parking container that remains mounted in the provider DOM. Park/unpark preserve the node identity; the pool does not promise that arbitrary iframe scripts cannot notice reparenting.

Default maxMounted is 5. Limit enforcement on release chooses least-recently-used parked entries; active entries are never evicted by LRU. More than five active entries may therefore exist. Explicit evict can remove active entries; predicate eviction defaults parked-only unless includeActive. Unknown release/evict is harmless. Provider cleanup removes all entries.

Without provider, each hook gets a fallback pool: release destroys instead of parking, no LRU cap is enforced, and matching eviction includes active entries. The generic fallback attach method can hold multiple keys despite comments describing a single-entry pool. No state survives provider lifetime.

Evidence: `src/features/iframe-pool/{types.ts,rules.ts,react/components/IframeKeepAliveProvider.tsx,react/hooks/useIframeKeepAlivePool.ts}`.

## Registries and A2UI

Interactive and artifact registries retain their input arrays; list returns them as readonly. Register creates a new registry after removing matching id and appending replacement. There is no dispose, persistence, subscription or automatic mutation of an existing registry.

An A2UI interpreter is supplied by `@jini-ai/agentic/a2ui`; the UI package re-exports its factory/type. It owns per-surface component maps, data models and pending actions in memory. Host applies agent messages, reads snapshots and transports returned renderer messages. Root hook subscribes on mount and unsubscribes on cleanup. Its root-reference snapshot can miss descendant-only/data-only updates; do not treat the UI tree as a complete interpreter-state subscription.

Evidence: UI registry and A2UI adapter/hook/renderer source; interpreter source in the dependency package.

## Feature caches and browser history

`createAsyncCommitGuard(): AsyncCommitGuard` starts revision zero. `begin()` increments and returns it, `capture()` returns current revision, `invalidate()` increments, legacy `isCurrent(revision)` checks equality. Consumers invalidate both optimistic write start and settlement to reject reads that overlap either moment; the guard does not cancel transport or persist state.

Browser history hook loads scope-keyed history through `BrowserHistoryStoragePort`, reloads on scope change, and debounce-saves on state change (default 140ms). clearHistory immediately saves an empty list; cleanup cancels pending debounce without flushing. Wired variant uses browser localStorage with SSR guards; a custom port defines other persistence semantics. Browser navigation stacks, selectors, expanded rows, drafts and per-feature detail caches otherwise live in mounted hooks and follow their injected ports.

Lexical mention parsing caches its token trie in a WeakMap keyed by the mention array reference. Supply a new array when entities/tokens change; mutating an existing array is not detected. No durable index or cache flush API exists.

Syntax highlighting shares a module-level lazy highlighter promise and a 128-entry insertion-order cache keyed by resolved light/dark, language and code. Cache hits do not promote recency. Unsupported language returns an empty string; highlighter-load rejection remains cached in the promise. Theme resolution uses data-theme or system preference (server default light), independently of the admin theme's data-color-scheme attribute. No public reset/dispose or persistence exists.

## Locale, theme and observers

Root locale provider reads initialLocale once; otherwise resolves supported persistence/system/fallback during browser initialization. `setLocale` updates local state then calls optional persistence synchronously. Document lang/dir synchronization is an effect without restoration. Renderer-subpath i18n has dictionary-only state/context; it does not subscribe to root locale.

Theme application leases font links per injected document and captures target values/name. Disposer is idempotent and restores captured state. Multiple themes sharing a font keep a package-owned link until last lease releases; pre-existing links are retained. Application does not persist user choice or install system-change listeners.

Web observability has a module-level installed flag: repeated install returns a no-op disposer, first disposer best-effort tears down observers and permits a later install. Individual browser observers no-op when unsupported. Stuck-run watch map uses runId; start replaces prior timer/state, progress reschedules until stuck, terminal clears and may report recovery. Default stuck threshold is 300000ms. There is no persisted run registry.

Editor state lives in mounted peers: HTML editor loads initial content/protection/canvas styling once, flush commits current RTE session before caller save/unmount; RichTextInput uses a Lexical editor plus controlled text/mention callbacks; SketchEditor reports scene/save/export through host callbacks. None is a persistence store.
