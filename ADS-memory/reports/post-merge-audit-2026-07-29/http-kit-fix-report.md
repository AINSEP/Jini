# packages/http-kit — post-merge audit fix report

**Branch:** `fix/post-merge-audit-http-kit-2026-07-30`
**Date:** 2026-07-30
**Findings source:** `http-kit-findings.md` (independent OpenAI Codex gpt-5.6-sol peer review)
**Scope:** all 12 BLOCKING findings verified. **11 real and fixed, 1 refuted as a false positive.**

Every fix followed the required discipline: a failing test written first, confirmed red against the
unfixed code, then the minimal fix, then confirmed green with the full suite re-run. No fix was
landed without a preceding red test.

---

## Environment note (read first)

The task prompt's build instruction was necessary and correct: `pnpm install --frozen-lockfile &&
pnpm -r build` from the repo root before anything else. Both ran clean.

**One pre-existing test failure exists on `main` and still exists on this branch, unrelated to any
finding:**

```
× createDiskAttachmentStore > rejects a file replaced by a different file of the same size after registration
  → promise resolved "{ attachments: [ … ] }" instead of rejecting     (attachments.test.ts:553)
```

Cause: this container's overlayfs **reuses inode numbers**. The test deletes a file and writes a
same-size replacement, expecting `isUnchangedAttachment`'s dev/ino identity check to notice a new
inode. Verified directly:

```
inode before 1884274 after 1884274 REUSED=true
```

So the store's check is correct and the test is correct; the filesystem simply does not give the
test the distinct inode it needs. This is an environment artifact, **not** a code defect and **not**
introduced by this branch. It was present in the baseline run before any edit.

Baseline (clean `main`, post-build): **1242 passed, 1 failed (37 files).**

---

## Validation actually observed

All output below was seen on this branch after the final edit — not assumed.

| Command | Result |
|---|---|
| `packages/http-kit` → `pnpm test` | **1278 passed, 1 failed (37 files)** — the single pre-existing inode failure above. **+36 net new tests, zero regressions.** |
| `packages/http-kit` → `pnpm typecheck` | **exit 0**, no output |
| `packages/agent-runtime` → `vitest run` | **98 files, 1851 passed, 1 skipped, 0 failed** |
| `packages/agent-runtime` → `pnpm typecheck` | **exit 0**, no output |
| repo root → `pnpm guard` | **exit 0** — `[guard] ok — self-test passed (checks proven against known-bad fixtures) and zero violations found in packages/.` |

---

## Dependency touched outside `packages/http-kit`

**Finding 4 (SSRF) could not be fixed from inside `http-kit`.** The vulnerable code is in
`@jini-ai/agent-runtime`'s provider runners, which `http-kit` lists as a direct dependency and calls
via `runOpenAiToolTurn` / `runAnthropicToolTurn`. `model-proxy.ts` only forwards `baseUrl`; the guard
decision lives in the runner. The change there is two lines of real change plus comments — swapping
the already-present synchronous guard for the already-present DNS-resolving one, exactly as the
Azure/Google/Ollama runners in the same directory already do. No new API, no signature change.

Files: `packages/agent-runtime/src/providers/openai-chat.ts`,
`packages/agent-runtime/src/providers/anthropic-messages.ts` (+ their two test files).

---

## Per-finding verdicts

### 1. Bearer auth bypassed behind a same-host reverse proxy — REAL, fixed

`api-security-middleware.ts:127` short-circuits on `isLoopbackPeerAddress(req.socket.remoteAddress)`.
Reading the socket rather than `X-Forwarded-For` is correct and deliberate — it stops a spoofed
header *granting* the exemption. But a reverse proxy on the same host terminates the client's
connection and opens its own from loopback, so every externally-originated request through it arrives
with a loopback socket address and skips the bearer check entirely. Confirmed by reading the source;
the code's own comment only addresses the XFF-spoofing case, not this one.

**Fix.** Two parts, both minimal:
- The exemption is withheld from any request carrying a proxy forwarding header (`x-forwarded-for`,
  `x-forwarded-host`, `x-forwarded-proto`, `forwarded`). A proxy adds these; a desktop-UI/local-CLI
  caller does not. The header's *value* is still never read — presence only ever **removes** a
  privilege, so a forged one costs the forger the exemption and gains them nothing.
- A new `trustLoopbackPeers?: boolean` dep (default `true`, preserving documented behaviour) lets a
  host drop the exemption outright.

**Honest limitation, stated rather than papered over:** a proxy configured to strip its own
forwarding headers still presents as an indistinguishable local peer. Nothing observable at the
socket separates those two cases, so that deployment must set `trustLoopbackPeers: false`. This is
documented at the check. The header heuristic closes the common default-nginx/caddy case; the flag
closes the rest.

**Tests** (`api-security-middleware.test.ts`): 4 parameterised forwarding-header cases → 401; a
proxied request *with* a valid bearer still passes; `trustLoopbackPeers: false` gates loopback.
Red: 5 failed. Green: 53/53.

### 2. Unexpected exceptions returned verbatim — REAL, fixed

`adapter.ts` serialized `e.message` into the public 500 body. This catch is the last-resort handler
for *unanticipated* exceptions — precisely the ones carrying filesystem paths, connection strings and
credentials. The unauthenticated-reachability claim also checks out: `health.ts`'s probes are in
`OPEN_PROBE_PATHS` and exempt from the bearer gate, so getting a readiness dependency to throw leaks
its message to an unauthenticated caller.

**Fix.** SEC-005, matching the pattern already used by `connectors.ts`/`delegated-tools.ts`: a generic
`'an internal error occurred'` plus a `requestId` correlation id, with the real exception routed to a
new optional `AdapterContext.onInternalError` sink (defaulting to `console.error`).

**Two existing tests asserted the leaking behaviour** (`adapter.test.ts` `message: 'boom'`,
`daemon-status.test.ts` `message: 'boom'`). Both were rewritten to assert redaction — they encoded
the defect. The replacements assert on the response *not containing* a planted path/credential, not
merely on the error code, plus that the sink receives the real error with a matching correlation id.
Red: 4 failed. Green: 24/24.

### 3. Attachment capabilities claimable by two runs — REAL, fixed

`attachments.ts` checked `claimedRunId`, then awaited `lstat` + `realpath`, and only assigned
`claimedRunId` afterwards. Being single-threaded is no protection — `await` is exactly where a second
`claim()` gets its turn. Reproduced: two concurrent claims for one attachment both fulfilled.

**Fix.** Split into a synchronous reserve pass (check and assign with no `await` between them) and an
async validate pass, with a rollback that releases **only this call's own reservations** so a loser
can never revoke the winner's claim. The original "a rejected claim leaves nothing half-claimed"
guarantee is preserved and separately tested.

**Tests:** two concurrent claims → exactly one fulfilled, one rejected with
`attachment-unknown-or-claimed`; plus a rollback test (a mixed-batch rejection must leave the first
attachment re-claimable). Red: the race test showed *2 fulfilled*. Green: 58/59 (the 1 is the
pre-existing inode failure).

### 4. OpenAI/Anthropic DNS-based SSRF gap — REAL, fixed (in `agent-runtime`)

Confirmed exactly as described: `azure-chat.ts`, `google-messages.ts`, `ollama-chat.ts` and
`model-catalog.ts` all use `validateBaseUrlResolved` (DNS-resolving); `openai-chat.ts` and
`anthropic-messages.ts` used only the synchronous `validateBaseUrl`, which inspects the literal
hostname string. A hostname resolving to `10.0.0.5` passed.

**Fix.** Both switched to `await validateBaseUrlResolved(..., defaultDnsLookup)`. Both call sites were
already inside `async` functions, so no signature changed.

**Tests** (`openai-chat.test.ts`, `anthropic-messages.test.ts`): `node:dns` mocked so only registered
hosts resolve (unregistered ones reject, which the guard deliberately treats as "allow", leaving every
pre-existing test's behaviour untouched). Each suite gets a blocked case and an allowed case — the
allowed case matters, or the "fix" could be a blanket denial.

Red is worth recording precisely: both failed with `Cannot read properties of undefined (reading
'ok')`, i.e. **`fetch` was actually invoked** against the private-resolving hostname. Green: 43/43.
Full `agent-runtime` suite afterwards: 1851 passed, 0 failed.

### 5. Malformed base64 silently overwrites storage — REAL, fixed

`Buffer.from(x, 'base64')` never throws; it skips what it cannot decode. `connectors.ts` checked only
for a non-empty string, so `"!!!!"` decoded to zero bytes and was written over whatever was at that key.

**Fix.** A strict well-formedness check: alphabet only, at most two trailing pad characters, length a
whole multiple of 4, at least one data character. **Tests:** 5 rejection cases (bad alphabet, trailing
data after padding, non-multiple-of-4 length, padding-only, whitespace) plus an acceptance case for
padded and unpadded valid input. Red: 5 failed.

### 6. Payment boundary accepts negative and fractional cents — REAL, fixed

Confirmed: `typeof === 'number' && Number.isFinite(...)` only. `-125.5` reached `payments.charge()`.

**Fix.** `Number.isSafeInteger(amountCents) && amountCents > 0`. `isSafeInteger` also rejects
magnitudes past exact JSON round-tripping, which at a money boundary should not be guesswork.
**Tests:** negative fractional, negative integer, zero, fractional, beyond-safe-integer — plus an
acceptance case for `1`. Red: 5 failed.

### 7. Malformed memory-index PUT clears the index — REAL, fixed

Confirmed: `typeof body.index === 'string' ? body.index : ''` meant a misspelled field
(`{ typo: "…" }`), a non-string value, or a non-object body all **succeeded** and wrote an empty
document over the caller's entire memory index, returning 200.

**Fix.** `index` is now required and must be a string. Clearing remains supported but must be asked
for explicitly with `{ index: "" }` — which no typo produces.

**Three existing tests asserted the destructive behaviour** ("parse defaults to an empty string
when index is missing/non-string", etc.). They were rewritten to assert rejection, with a separate
test pinning that an explicit `{ index: "" }` clear still works. Red: 3 failed.

### 8. `raw-sse.ts` listens to the wrong event for client disconnects — **FALSE POSITIVE**, no code change

The audit could not reproduce this (its sandbox blocked `listen()`). This environment can, so it was
tested directly against a real `http` server and real client sockets on Node v22.22.2:

| Scenario | `req` `'close'` fired? |
|---|---|
| Bodyless `GET`, response left open, client stays connected | **No** — still unfired after 700ms idle; fired only at 706ms when the server itself called `res.end()` |
| `POST` with a fully-sent, unread body, response left open, client connected | **No** — identical result |
| Real client disconnect (`socket.destroy()`) | **Yes**, at 102ms |

`IncomingMessage`'s `'close'` fires when the request/response cycle ends or the connection drops —
not when a bodyless request merely finishes arriving. That is exactly the cleanup signal
`createSseResponse` wants. `run-stream` and other consumers are not affected. **No code change made.**

Two real-socket regression tests were added anyway (one proving the stream survives a live idle
client, one proving disconnect is still detected). A fake `EventEmitter` request agrees with either
behaviour, so only a real socket can hold this contract — these would have caught the bug had it
been real.

### 9. `raw-sse.ts` ignores backpressure, no bounded queue — REAL, fixed

Confirmed: both `send` and the keepalive ignored `res.write()`'s return value. A client that stops
reading accumulates unbounded buffered data — a memory-exhaustion DoS reachable by anyone who can
open a stream. `sse.ts`'s `createSseChannel` already had the correct bounded, drain-aware machine.

**Fix.** A queue with a `DEFAULT_MAX_QUEUED_SSE_MESSAGES = 1000` cap (mirroring `sse.ts`'s
`DEFAULT_MAX_QUEUED_SSE_EVENTS`, so the two SSE primitives do not disagree), a `pump()` that respects
`write() === false`, a `'drain'` listener, and connection drop on overflow. Keepalive pings go
through the same queue, so there is no second path bypassing the bound.

**Tests:** stalls on backpressure rather than writing; flushes in order on `'drain'`; drops the
connection past the default cap; honours an explicit `maxQueuedMessages`; keepalive does not
accumulate while stalled. Red: 5 failed. Green: 18/18.

**Knock-on, disclosed:** adding `res.on('drain')` broke 23 tests in `run-stream.test.ts` and
`frontend-sessions.test.ts` whose `res` fakes had no `.on`. Those fakes were made `EventEmitter`s —
which is *more* faithful, since the real `ServerResponse` is one and `sse.ts` already calls
`res.on('drain')` unguarded. No production code was weakened to accommodate a fake, and no assertion
was relaxed. Both files: 41/41 after.

### 10. `remote-run-events.ts` reflects every recorder failure as a public 409 — REAL, fixed

Confirmed: `toRemoteEventError` turned *any* throw into `CONFLICT` carrying `error.message` verbatim.
A storage fault carrying a path and a token was returned to the caller intact, and a server fault was
mislabelled as a client-resolvable conflict.

**Fix.** The outcome is decided by the run's **actual state**, not by the exception's text: run gone →
`NOT_FOUND`; run terminal → `CONFLICT` with a message *constructed here* from data this module owns
(so even a misattributed error cannot smuggle text out); anything else → SEC-005 `INTERNAL_ERROR`
plus correlation id, real error to a new `onInternalError` sink.

Message-sniffing on `emit`'s wording was deliberately rejected — it breaks silently the next time
that string is reworded. **Residual, documented in code:** a genuine storage fault coinciding with an
already-terminal run reports `CONFLICT` rather than `INTERNAL_ERROR`. That is a rare wrong status
code, not a leak; nothing is echoed either way.

**One existing test asserted the leak** (a bare string rejection becoming `CONFLICT` with that string
as its message). Rewritten to assert it reaches the sink instead. **Tests:** planted path+secret never
appears in the response and the response `requestId` matches the sink's `correlationId`; same for
`tool-result`; and a real terminal-run conflict is still `CONFLICT` and must *not* call the sink.
Red: 3 failed. Green: 32/32.

### 11. `xai.ts` concurrent OAuth-start race destroys a successful listener — REAL, fixed

Confirmed by reproduction. Two starts interleave across `await stopListener` / `await
startCallbackListener`: both clear the shared ref, B installs its listener and returns `ok`, then A's
failure path calls `stopListener` on the shared ref and stops **B's** listener. B's caller already
holds an authorizeUrl whose callback endpoint is now dead, so sign-in hangs with nothing to diagnose.

**Fix.** Starts sharing one `listenerRef` are serialized through a `WeakMap`-keyed promise chain
(`WeakMap` so discarded deps do not leak an entry). The stored link is made non-rejecting so an
unhandled rejection cannot escape or poison later starts. Stop-then-start becomes the indivisible
step it always read as.

**Test:** two concurrent starts where the first loses the race and then fails → exactly one succeeds,
`listenerRef.current` is the good listener, and `goodListener.stop` was never called. Red:
`expected null to be { address: … }` — the ref had been nulled. Green: 68/68.

### 12. `xai.ts` has no deadline for the search request or response body — REAL, fixed

Confirmed: `callXaiSearch` passed no `signal` and had no timer. A stalled upstream pins the handler,
its socket and the caller's connection indefinitely.

**Fix.** `research.ts`'s template applied: one `AbortController` armed before `fetch` and **kept armed
through body consumption**, cleared in a `finally`. A new `searchTimeoutMs` dep defaults to
`DEFAULT_SEARCH_TIMEOUT_MS = 30_000`, matching `DEFAULT_TAVILY_TIMEOUT_MS`. Aborts are reported as a
timeout rather than a generic failure.

**Tests:** a request that never responds, and — separately — a response whose **body** never arrives,
which is the case a deadline armed only around `fetch` would miss entirely. The second asserts
`bodySignal.aborted === true`, which is what actually distinguishes the two designs. Red is
distinctive: both tests hung to vitest's own 5000ms timeout, which is the defect itself. Green: 70/70.

---

## NON-BLOCKING findings — noted, not fixed

Per the findings file's own instruction ("fix only if small/obviously correct; otherwise just note").
None were changed; all five were left alone so this branch stays reviewable as a security fix set,
and each is a behaviour change that deserves its own decision:

- `active-context.ts:109` — daemon-wide focus pointer vs. per-caller. Needs a scoping decision, not a patch.
- `db-ops.ts:255` — unrecognized `quick` values silently treated as `false`. Tightening this is an API break for any existing caller sending e.g. `"yes"`.
- `model-proxy.ts:394` — provider work not aborted on SSE client disconnect (potentially billed). Real and worth doing; it is a non-trivial lifecycle change, not a small one.
- `workspace-root.ts:81` — accepts `"."`, relative paths and whitespace despite promising an absolute root.
- `terminals.ts:107` / `:244` — create and resize validate dimensions inconsistently.

**Recommendation:** `model-proxy.ts:394` is the one with a real cost attached (billed provider work
continuing after the client is gone) and should be scheduled next.

---

## Summary

| # | Finding | Verdict |
|---|---|---|
| 1 | Reverse-proxy bearer bypass | REAL — fixed (+ documented residual) |
| 2 | Verbatim exception in 500 | REAL — fixed |
| 3 | Attachment double-claim race | REAL — fixed |
| 4 | OpenAI/Anthropic DNS SSRF | REAL — fixed *in `agent-runtime`* |
| 5 | Malformed base64 accepted | REAL — fixed |
| 6 | Negative/fractional cents | REAL — fixed |
| 7 | Malformed PUT clears memory index | REAL — fixed |
| 8 | `raw-sse` wrong disconnect event | **FALSE POSITIVE** — empirically refuted, no code change |
| 9 | `raw-sse` no backpressure/bound | REAL — fixed |
| 10 | Every recorder failure → 409 with raw message | REAL — fixed (+ documented residual) |
| 11 | xAI OAuth-start race | REAL — fixed |
| 12 | xAI search has no deadline | REAL — fixed |

**Nothing was left undone within the 12 BLOCKING findings.**

Six existing tests across four files were rewritten because they asserted the defective behaviour
(`adapter.test.ts` ×2, `daemon-status.test.ts` ×1, `memory.test.ts` ×3-worth, `remote-run-events.test.ts`
×1). Each rewrite is called out in its finding above and in the commit message. No test was deleted
to make a fix pass, no assertion was weakened, and no branch was removed rather than covered.
