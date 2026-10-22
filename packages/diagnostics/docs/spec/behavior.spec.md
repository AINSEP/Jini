Spec ID: SPEC-JINI-DIAGNOSTICS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:7884cc787398d6198bbe3ef9c6a639c5e91e9002f5f00b13f5d827aa8d724577
spec_mode: reverse_spec


# Diagnostics behavior contract

## Bundle collection and redaction

- Collection shall preserve input order while reading sources concurrently. Read/redaction failures shall become null-content entries with zero bytes and a string error. Byte counts for successful files describe the original read buffer, not the redacted content.
- JSON redaction shall recursively replace nonempty string values whose keys match token/password/secret/key/dsn/authorization/cookie, and redact other strings as text. Invalid JSON shall fall back to text redaction. This is a heuristic, not a guarantee of detecting arbitrary secrets.
- Text redaction shall process HTTP auth schemes, secret query parameters, then bare assignments. Username masking applies only when a supplied username has more than one character and matches supported home-path forms.
- An archive shall be fresh for each export. Source entries precede `summary/manifest.json` and `summary/machine-info.json`; unreadable entries receive a `; file unavailable: ...` placeholder. Summary contents shall be redacted. Returned manifest/machineInfo objects are the original, unredacted objects; consumers must protect them separately.
- Upstream warnings shall precede per-file warnings without deduplication. Duplicate archive names and filename trust are the host/archive port's responsibility; the collector does not reject them.

## Discovery defaults and precedence

| Setting | Current default or rule |
|---|---|
| Run event logs | Newest modified first; at most 20; 2 MiB trailing read per file |
| Native agent logs | At most 3 newest `.log` files per agent; 2 MiB trailing read; agent order claude, codex, opencode, optional amr |
| CLI home overrides | Explicit trimmed home/config paths win over homeDir/dataDir-derived locations |
| Crash reports | Darwin only; last 7 days; newest first; at most 20; explicit searchDirs wins over home-derived and system directories |
| Node tail reads | Missing or nonpositive tailBytes reads the whole file; positive tails close their descriptor in finally |
| Archive compression | Node adapter: DEFLATE level 6 |
| Download filename | Explicit Date wins over clock; ISO colons/dots become hyphens; milliseconds removed; `.zip` suffix |

Discovery shall skip unreadable directories and failed stats. Agent filenames/run directories must match the safe entry pattern; auth/config JSON and session transcripts are not collected. Discovery option numbers are not range-validated; callers must supply sensible nonnegative counts and integer byte bounds.

## Secret-only policy

Built-in rules shall run in order: private-key blocks, auth/cookie headers, URL credentials, credential/vendor patterns, JWTs, host additional rules, bare bearer tokens, labeled secrets. Patterns are cloned with a global flag. Each replacement increments `redactions`; already-redacted built-in output is idempotent. Host replacements can throw, expand text or violate idempotency; the host owns that policy. Ordinary paths, addresses and prose remain unless they match a secret rule.

## Observability

No endpoint shall produce `{ enabled: false }` without validating identities. A nonblank tracesEndpoint shall win over general endpoint; the latter gains `/v1/traces`. Enabled identities shall be trimmed and nonempty. No environment lookup or global provider registration occurs.

Disabled telemetry shall avoid exporter/provider factory calls and share a frozen no-op tracker. Enabled spans start with method/raw path, finish with method/final route pattern, record HTTP status and mark error only for status >= 500. Completion shall be latched before effects, so repeated end calls are no-ops even after a hook throws. Hook order is tracing, logging, metrics; an earlier exception prevents later effects. Explicit requestId wins over generated ID; negative elapsed time clamps to zero. SDK flushing/shutdown, export retries and HTTP middleware attachment belong to the host.

## Web evidence boundaries and limits

Paths shall be trimmed, gain a leading slash, lose fragments and reject empty/overlong inputs, raw controls or embedded whitespace, backslashes, schemes, protocol-relative paths and literal `..` segments. The limit is 2048 characters on trimmed input. Encoded dot segments are not decoded by this check. Base-path joining shall preserve the registry's basePath. Same-origin comparison uses scheme and effective host/port, returning false for malformed URLs.

The collector shall resolve the host's verified origin before opening a browser, validate paths before applying the five-page cap, and load accepted pages sequentially. Duplicate paths consume separate slots. Invalid/capped skips precede runtime skips in the result. Off-origin final document observations shall be discarded after navigation; this does not prevent the browser from contacting redirect destinations or third-party resources. Hosts requiring connection-time network restrictions must enforce them in their browser port.

| Bound/default | Value and enforcement |
|---|---|
| Accepted pages | 5; excess valid paths reported as page-cap |
| Page navigation | 15,000 ms passed to browser; Chromium adapter uses it for goto |
| Whole call | 60,000 ms checked before each page; no cancellation of an in-flight page, origin lookup, launch or close |
| Visible text | 2,000 characters |
| Cookies / requests | 100 / 200; requests retain earliest attempts |
| Accessibility categories / contrast | 200 per category / 40 samples |
| Accessibility | On unless explicitly false |
| Consent action | None without selector; first matching control clicked once; click timeout min(page timeout, 5,000 ms), followed by 1,500 ms settle |

Chromium contexts shall be ephemeral, verify TLS and permit only GET/HEAD routed requests; aborted methods are still evidence. Cookie values, request bodies/headers and form values are absent from their evidence types. Main document response headers and text can contain sensitive content: the mandatory observationPolicy must redact it. Structure is captured before consent; cookies are captured afterward and share the phase at capture time. `consentTransition.attempted` records selector supply, not successful interaction. Missing selectors/click failures produce notes. Browser-unavailable produces no pages and explicit skips, without inferred evidence. Accessibility capture is observation, with no score or compliance decision.

## DNS and TLS

Input validation shall precede authorization; authorization shall precede network requests. Names shall become lowercase ASCII with one trailing dot removed, at most 253 canonical characters, valid <=63-character labels, at least two labels and nonnumeric suffix. URLs, IPs, ports, whitespace and local/localhost/internal/invalid/test/onion suffixes shall be rejected. DNS owner labels permit underscores; TLS and comparison hostnames do not.

Lookup shall make 1..6 distinct selected queries sequentially (all six by default). Host comparison shall choose a saved independent host: auto-select only one candidate, require explicit selection for multiple candidates, return unknown without DNS when none exists. It shall compare full normalized/deduplicated A and AAAA sets through five queries; CNAME remains observed evidence, not a proof of routing. No expected addresses yields unknown. TLS checks shall leave issuer/expiry null. Resolver and TLS ports own deadlines, transport, authentication and public-network enforcement; this package adds no network timeouts or retries.

Evidence: `sources.test.ts`, `zip.test.ts`, `agent-logs.test.ts`, `secrets-only.test.ts`, observability tests, web-evidence tests and `domain-dns.test.ts` in `src/__tests__/`, read without execution.

Decision rationale: [Build evidence URLs from verified host configuration](../decisions/DR-001-trusted-evidence-addresses.md).
