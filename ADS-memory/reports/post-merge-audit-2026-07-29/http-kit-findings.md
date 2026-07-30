# packages/http-kit — post-merge audit findings to verify and fix

Source: independent OpenAI Codex (gpt-5.6-sol, high reasoning) peer review of the production-source
diff for `packages/http-kit` between `9cb4ffc50` (base) and `085c4799a` (merge of
`feat/agentic-capability-layer` into `main`), run as two dispatches (split by file, not by concern)
whose findings are merged below. Codex reproduced most of these against the built package rather
than relying on static reading alone (see each item). Three of these have been independently
spot-verified by the coordinating human/session already (marked below); the rest have not — treat
every unmarked one as a hypothesis to confirm against current source, not a given fact.

## BLOCKING

1. **Bearer auth is bypassed behind a same-host reverse proxy — `api-security-middleware.ts:124`.
   ALREADY SPOT-VERIFIED, REAL.**
   The loopback short-circuit checks `req.socket.remoteAddress`, not `X-Forwarded-For` (that part
   is deliberate and correct). But any reverse proxy running on the same host as the daemon — an
   extremely common deployment (nginx/caddy on the same box proxying to a backend bound to
   `127.0.0.1`) — makes every externally-originated, proxied request's socket address `127.0.0.1`,
   so bearer auth is skipped entirely for all traffic through that proxy. This contradicts the
   code's own comment, which states a reverse proxy "must always forward the real bearer itself."
   Requests without an `Origin` header also pass the origin guard around line 272. Reproduced: a
   loopback request with a configured token and no `Authorization` header reached the handler.

2. **Unexpected exceptions are returned verbatim, including on unauthenticated probes —
   `adapter.ts:58`, `health.ts:109`.**
   The adapter serializes `Error.message` into a public 500 response. Reproduced with `/api/ready`:
   a readiness error containing `sqlite failed at /srv/secret/data.db` was returned unchanged.
   Health routes mount before security middleware, so this is an unauthenticated information leak,
   and it defeats the same protection for any route whose dependency throws outside its own guard.

3. **Attachment capabilities can be claimed by two runs — `attachments.ts:601`.**
   `claimedRunId` is checked, then two filesystem operations are awaited, and only afterward set at
   line 636. Concurrent claims can both pass the check. Reproduced against the production store with
   mocked filesystem operations: claims for `run-A` and `run-B` both fulfilled with the same real
   path — violating the documented exactly-once guarantee.

4. **OpenAI and Anthropic proxy routes retain a DNS-based SSRF gap — `model-proxy.ts:205`.**
   Arbitrary `baseUrl` values are forwarded at lines 628 and 656. Unlike the Azure/Google/Ollama
   runners, the OpenAI and Anthropic runners use only a synchronous literal-host check, not the
   available DNS-resolving guard. A hostname that resolves to e.g. `10.0.0.5` therefore passes and
   can expose an internal endpoint. Reproduced with mocked fetch: both runners issued requests to
   the supplied hostname; the DNS-resolving guard correctly rejected the same hostname when mapped
   to `10.0.0.5` (proving the guard exists and works — it's just not wired into these two runners).

5. **Malformed base64 silently overwrites storage with corrupted bytes — `connectors.ts:288`.**
   The parser only checks for a non-empty string, then `Buffer.from(..., 'base64')` decodes
   permissively. Reproduced: `dataBase64: "!!!!"` parsed successfully and invoked `storage.put` with
   a zero-byte buffer.

6. **The payment boundary accepts negative and fractional cents — `connectors.ts:375`.
   ALREADY SPOT-VERIFIED, REAL.** `amountCents` is only checked with `typeof === 'number' &&
   Number.isFinite(...)` — no positivity or integer check. Reproduced/confirmed: `-125.5` reaches
   `payments.charge()` unchanged. Should require a positive safe integer.

7. **A malformed memory-index PUT clears the index — `memory.ts:265`.**
   Missing, non-object, or wrongly-typed `index` input becomes `''` and is persisted. Reproduced:
   `{typo: "intended content"}` successfully called `writeIndex` with an empty string. Clearing
   should require an explicit `{index: ""}`.

8. **`raw-sse.ts:64` listens to the wrong event for client disconnects.**
   `IncomingMessage`'s `close` event indicates the request completed, not necessarily that the
   underlying connection disconnected (true as of Node 16+). For a bodyless SSE `GET`, this can
   immediately invoke `close()`, end the response, and unsubscribe the stream. Affects `run-stream`
   and every other `createSseResponse` consumer. Confirmed against the documented Node.js HTTP
   contract; a full socket-level reproduction was blocked by the audit sandbox's `listen()`
   restriction — you should be able to reproduce it directly since you have a real environment.

9. **`raw-sse.ts:67` ignores response backpressure and has no bounded queue.**
   Both event and keepalive writes disregard `res.write() === false`. A slow client can accumulate
   arbitrary buffered data, producing a memory-exhaustion DoS. Reproduced with a response whose
   `write()` always returned `false`: all 100,000 sends were still written and the connection
   remained open. Notably weaker than the bounded, drain-aware implementation already in `sse.ts` —
   look at that file for the pattern to match.

10. **`remote-run-events.ts:188` reflects every recorder failure as a public `409 CONFLICT`.**
    The catch covers storage failures and other unexpected exceptions, not only terminal-run
    conflicts. Reproduced with a recorder throwing `sqlite failed at /srv/private/runs.db;
    token=bridge-secret` — the complete message, including the path and secret, was returned to the
    caller as a conflict. Only a typed terminal-state conflict should become 409; other failures
    need a generic `INTERNAL_ERROR` (see `api-security-middleware.ts`'s pattern, SEC-005) plus
    server-side correlation logging instead of echoing the raw error.

11. **`xai.ts:357` has a concurrent OAuth-start race that can destroy a successful listener.**
    Two starts can both pass the initial `stopListener()` check. If request B installs its listener
    while request A is still awaiting listener creation, then A fails, A's catch calls
    `stopListener(sharedRef)` and stops B's listener — but B has already returned success to its
    caller, so its callback endpoint is now dead. Reproduced: the second request returned `ok`,
    followed by the first request's catch clearing the shared ref and invoking the successful
    listener's `stop()`. Serialize starts, or use generation/ownership checks so a request only
    stops its own listener.

12. **`xai.ts:650` has no deadline for the xAI search request or response body.**
    A stalled upstream can hold the HTTP request and its resources indefinitely. This is especially
    conspicuous because `research.ts` in this same merged diff explicitly carries a timeout through
    both `fetch` and body consumption for this exact failure mode — use that as the template. Static
    finding, not reproduced by Codex; add an abort deadline that stays armed through
    `text()`/`json()`.

## NON-BLOCKING (fix only if small/obviously correct; otherwise just note in your report)

- `active-context.ts:109` describes caller-specific focus but maintains one daemon-wide pointer.
  Either scope it per client/session or document it as server-global.
- `db-ops.ts:255` silently treats any unrecognized `quick` value as `false`; reject values other
  than `0`/`1`/`false`/`true`.
- `model-proxy.ts:394` does not abort provider work when the SSE client disconnects, potentially
  continuing billed requests after the client is gone.
- `workspace-root.ts:81` promises an absolute root but accepts `"."`, relative paths, and whitespace
  unchanged. Enforce a trimmed, absolute path.
- `terminals.ts:107` and `terminals.ts:244` validate dimensions inconsistently: create accepts
  non-finite/negative/fractional numbers; resize additionally coerces `null`, booleans, and numeric
  strings. Require bounded positive integers consistently across both.

## What to do

For each finding: read the actual current source at the cited file:line and confirm or refute it
yourself, independently — even the two marked "already spot-verified," re-confirm them too, don't
just trust the note. If it's a false positive, say exactly why and don't change the code. If it's
real: write a FAILING TEST FIRST that reproduces it (in the relevant existing test file, following
that file's own conventions), confirm it fails against current unfixed code, THEN implement the
minimal correct fix, THEN confirm the new test passes and the package's full test suite has zero
regressions. No fix without a preceding red test. This is 12 findings across one package — pace
yourself; a partial, well-verified pass with a clear report of what's left is much more valuable
than a rushed pass through all 12.

Full working conventions, branch naming, and report format are in the top-level task prompt you
were given alongside a pointer to this file — follow those.
