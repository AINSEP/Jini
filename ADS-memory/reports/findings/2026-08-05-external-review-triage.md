# External code-review triage — 2026-08-05 (Jini side)

Verification of the Jini findings raised by an external AI reviewer. Full cross-repo triage,
including the Tovu findings and the verdict table, lives in
`Tovu/ADS-memory/reports/findings/2026-08-05-external-review-triage.md` — this file is the Jini
copy so the deferred items are visible from this repo.

Source reports (written by the reviewer, not by this session):

- `ADS-memory/reports/audits/2026-08-01-saturday-code-security-review.md`
- `ADS-memory/reports/audits/2026-08-02-03-sunday-monday-code-security-review.md`

## Fixed in this session

- **`packages/agent-runtime/src/providers/openai-chat.ts`** — `runOpenAiCompatibleRequest` used the
  default `redirect: 'follow'`, so a guard-passing endpoint could `302` the request into blocked
  address space with the provider auth headers attached. Now `redirect: 'error'`, matching
  `model-catalog.ts`, which already did this. The reviewer located this at
  `connection-guard.ts:198` and attributed it to both callers; `model-catalog.ts` was never exposed.
- **`packages/admin/src/server/composio/file-lock.ts`** — removed a vestigial `statSync` in the
  EEXIST branch whose ENOENT escaped the function during an ordinary lock handoff. Reproduced
  before fixing; regression test in `__tests__/stores.unit.test.ts` fails without the fix.
- **`packages/ui/src/features/mcp-ui/surfaces/form.ts`** — added an in-flight `pending` flag shared
  by submit and cancel. `setBusy` only disables action buttons, and the Enter handler is bound to
  controls that stay enabled, so a held Enter key issued one `tools/call` per keydown repeat.
  `confirmation.ts` was checked and is button-only, so it does not share this hole.
- **`packages/vibecoding/src/core/history.ts`** — `undo`/`redo` now peek and move only after a clean
  replay; `restore` records its entry before replaying. A mid-replay throw previously stranded the
  entry in neither stack, leaving partial writes unreachable through the history API. Three
  fault-injection tests added, all proven to fail without the fix.

### Third batch (2026-08-05)

- **`packages/daemon/src/delegated-tool-bridge.ts`** — `emitSurface` spread `emission.payload` LAST,
  over the bridge's own `type` and `toolUseId`, and then cast through the closed `RunAgentPayload`
  union. A handler could emit a well-formed `tool_result`/`mcp-ui` event on a channel it was never
  given, correlated against a *different* call. Reserved keys are now stripped from the payload
  before the merge — stripped rather than merely re-ordered, because `correlationFor` returns `{}`
  for channels that carry no `toolUseId`, so spread order alone would still let one be smuggled onto
  those. Matches `SurfaceEmission.payload`'s own doc ("merged into the emitted event BESIDE `type`").
  Note the existing comment defending the cast reasoned only about an *unknown* channel; the forged
  *known* channel was outside what it considered.
- **`packages/chat/src/react/components/A2uiSurfaceCard.tsx`** — added a monotonic attempt ref so
  only the latest `onAgentAction` delivery may write `deliveryFailureNotice`. `onAgentAction` is
  host-supplied and its promises need not settle in call order, so an older click's failure could
  repaint over a newer successful one. Regression test proven to fail without the guard.
- **`packages/vibecoding/src/core/history.ts`** — the reviewer's item 3 is the same defect as the
  second batch's history finding, already fixed above. The "three failing durability tests" they
  observed were the new regression tests added here, seen during a window in which the fix was
  temporarily reverted precisely to confirm those tests catch it. The suite is green (22/22).

### Fourth pass (2026-08-05) — the deferred items, now closed

- **`packages/ui/src/features/media-providers/`** — clear-then-reload resurrection fixed with a
  tombstone. `mergeDaemonProviders` gained `dropProviderIds`; `useMediaProvidersTab` records a
  cleared id there until a write carrying the deletion succeeds, and releases it on rollback so a
  tombstone cannot outlive its clear. The merge now reads `providersRef.current` at response time
  instead of the request-time snapshot — `localBeforeMerge` is kept only for the migration decision,
  which is genuinely a question about pre-fetch state. Chosen over `mutatedSinceLoad` because a
  clear issued BEFORE a reload starts is not "mutated since load" and that ticket would have missed
  it. Regression test proven to fail without the tombstone.
- **`packages/ui/src/features/asset-grid/`** — overlapping flushes serialized rather than guarded.
  Re-checking `pendingDelete` after the await was tried first and is **insufficient**: whichever
  pass applies a delete clears that set, so by the time the fetching pass resumes there is nothing
  to re-check against. A `flushing`/`rerun` pair now allows one pass at a time and coalesces
  requests raised during one, which reorders the delete to land after the merge instead of before
  it. Same reasoning `useMediaProvidersTab`'s `persist` uses. Cost: a mid-pass event applies one
  window later. Regression test proven to fail without it.
- **`packages/agent-runtime/src/providers/connection-guard.ts`** — the rebinding gap is now
  documented in `validateBaseUrlResolved`'s own doc rather than left implicit, including what would
  actually close it and why that is not reachable from this package (see below).
- **`packages/server/src/builtin-features.ts`** — `ANONYMOUS_DELEGATED_PRINCIPAL`'s doc rewritten
  (it named the wrong mechanism, see below) and the resolver fallback now warns once at composition
  instead of being taken silently.

## Still NOT fixed — DNS rebinding, and why

`packages/agent-runtime` carries **zero external runtime dependencies** — its `dependencies` are
`@jini-ai/platform` and `@jini-ai/protocol`, both workspace packages. Pinning the dialled IP needs
either `undici`'s `Agent` with a custom `connect`, or a rewrite of every provider's HTTP call onto
`node:https` with a `lookup` option. Adding a first external runtime dependency to a deliberately
dependency-free package, or replacing its transport, is an architecture decision with its own blast
radius — not a patch. Documented in the guard instead so no caller reads a pass as proof the socket
went where it said.

## Still NOT fixed — delegated-tool route principal (reviewer's item 1)

`packages/server/src/builtin-features.ts:532`, `packages/http-kit/src/delegated-tools.ts:63`

Two of the three claims check out, one is unverified, and the code's own defence of the default is
demonstrably wrong:

- **Confirmed — the contract contradiction is real.** `DelegatedToolsHttpDeps.resolvePrincipal` is
  documented as *"Mandatory — see module doc; there is no safe default identity this package could
  assume on a host's behalf."* `builtin-features.ts:532` then supplies
  `?? (() => ANONYMOUS_DELEGATED_PRINCIPAL)` — exactly such a default. One of the two comments has
  to be wrong, and they should not be allowed to disagree in the tree.
- **Confirmed — `requireSameOrigin` is not an authN control against local processes.**
  `isLocalSameOrigin` returns true for a request with **no** `Origin` header whose `Host` resolves
  to an allowed loopback host (`origin-validation.ts`, the `origin == null || origin === ''`
  branch). That is deliberate for non-browser CLI/MCP clients, but it means the route's only
  identity is whatever `resolvePrincipal` returns.
- **The stated defence is FALSE as written.** `ANONYMOUS_DELEGATED_PRINCIPAL`'s doc claims
  "inertness here comes from every registered tool's own deny-by-default `ToolPolicy`".
  `packages/cms/src/core/tools/registration-kit.ts:445` registers **every** CMS tool with
  `policy: { authorize: () => "allow" }` — a pass-through, documented at line 397 as by design
  because "each tool's permission is evaluated exactly once — inside its domain function ... or by
  the handler's own `requireToolPermission` call". So there is a gate, but it is NOT the one the
  anonymous principal's doc names, and that comment should be corrected regardless of the outcome
  below.
- **TRACED — the reviewer's impact claim is NOT substantiated.** `identity/authorize.ts:144` opens
  with `principals.findById(...)` and returns `{ allowed: false, reason: 'principal_disabled' }`
  when no row comes back. `anonymous-delegated` has no principal row, so every permission-gated tool
  refuses it, fail-closed. "Any local process can invoke a registered tool against any known run"
  does not hold for the CMS tool surface. Downgrade from High.

**Residual risk that IS real:** the protection is the *tool's own* permission check, not the
registry and not this identity. A tool registered by another host with a permissive `ToolPolicy`
**and** no internal permission check would still execute for the anonymous principal. That is the
case the mandatory-resolver contract exists for.

**What was done:** the false comment was corrected (it is the kind of claim a future host would
reasonably rely on when deciding whether their own tool needs an internal gate), and the fallback
now warns once at composition so it is never taken silently.

**What was NOT done, and why:** failing startup when the route is enabled without a resolver is the
right end state but is a breaking change for any host relying on the default — owner's call. Per-run
single-purpose capability tokens and authenticated request context threaded into principal
resolution are an auth-architecture change, not a patch.

## Still NOT fixed — rebinding half of the SSRF finding

`packages/agent-runtime/src/providers/connection-guard.ts:198`. `validateBaseUrlResolved` resolves
the hostname, then `fetch` resolves it again independently — a classic TOCTOU that no preflight
check can close. Closing it needs an IP-pinning dispatcher (a custom `lookup`/agent that dials the
address the guard actually approved). Severity is below the reported High: `baseUrl` here is
operator-configured BYOK provider config, so this guard is defence-in-depth rather than the primary
trust boundary.

## Deferred — need a decision, not a patch

### Provider clears undone by a reload

`packages/ui/src/features/media-providers/react/hooks/useMediaProvidersTab.ts:292`

Confirmed, and worse than reported: **`reload()` alone resurrects a cleared provider**, no
concurrent save required. `clearProvider` deliberately omits the id from `pendingProviderIds`, so it
is absent from `preserveLocalProviderIds`; and `mergeDaemonProviders` (`rules.ts:105`) writes back
`{...daemonEntry}` for every daemon-present id unless preserved *and* `hasRecoverableFields`, which
is false for a deleted entry either way. Separately, `fetchAndReconcile` snapshots
`localBeforeMerge` at request time, so edits made during the flight merge against a stale base —
`mutatedSinceSend` guards the save path, the load path has no equivalent.

Options: a `mutatedSinceLoad` ticket mirroring `mutatedSinceSend`; a `clearedProviderIds` tombstone
set that `mergeDaemonProviders` honours; or re-reading `providersRef.current` at merge time. The
tombstone models a clear most honestly but adds a concept to `rules.ts`'s merge contract.

### Asset resurrection via overlapping flushes

`packages/ui/src/features/asset-grid/react/hooks/useAssetGridLiveUpdates.ts:59`

Confirmed. `flush` nulls `timer` on entry then awaits, and `schedule()` only checks `timer`, so a
second flush can start while the first is still fetching. Flush #1 has already drained
`pendingIngest`, so flush #2's delete has nothing to cancel, and flush #1 merges the deleted asset
back in. Narrow: needs the fetch to outlive `coalesceMs` and to have resolved with the asset before
the delete landed server-side, otherwise the `null` check forces a self-correcting reload.

Options: a `flushing` flag deferring `schedule()` (changes the coalescing contract), or re-checking
`pendingDelete` against `resolved` after the await (needs a decision on suppress-vs-reload).
