Spec ID: SPEC-JINI-INTEGRATIONS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:dfce91972ae47dffce9c33ab704d7bbbc8b3f08163ee4960547129f6f3b45bf3
spec_mode: reverse_spec


# Behavior Rules: Integrations

## Credentialed requests

- WHEN making a credentialed request, the package shall validate label/method/headers/body before resolving credentials, constrain the parsed URL to the saved base origin or exact additional-origin strings, then load schemes, send once, audit, and redact the response.
- The package shall accept GET/POST/PUT/PATCH/DELETE, require HTTP/HTTPS absolute URLs without embedded credentials, reject caller Authorization/Cookie/Host/Proxy-Authorization headers case-insensitively, and reject bodies over 1,000,000 UTF-8 bytes. The transport timeout supplied is 10,000 ms.
- WHEN choosing authentication, the package shall use the first matching self-describing rule with a nonempty suffix, else Basic for a truthy username, else Bearer. Scheme parsing requires schemaVersion 1, at most 32 rules, unique lowercase-hyphenated ids, and nonempty HTTP-token prefix/scheme fields at most 64 characters.
- WHEN returning a response, the package shall remove cookie/auth response headers and any header containing a secret, replace exact secret substrings in bodies, and redact truncated secret-prefix tails of length at least four. Tokens shorter than eight characters cause the whole body to be withheld. `buildAuthorizationHeader` deliberately returns secret material and must be treated as private transport data.
- WHEN probing credential validity, the package shall GET the saved origin root once, classify 2xx as valid, 401/403 as invalid, everything else as unreachable, and return no response body. A transport rejection is audited with status zero and returns unreachable. Unlike the general request path, this catch does not preserve egress-refusal identity.
- WHEN a general request's transport fails, the package shall audit status zero, rethrow a host-recognized egress refusal unchanged, or throw a redacted transport error. Validation, resolver, registry, audit and diagnostic-mapper failures are not uniformly converted to transport errors.

No decryption/storage implementation, default scheme/plugin loader, approval UI, principal authorization, response-size cap, DNS pinning, retry, or redirect logic is supplied here. Transport adapters own egress, cancellation, body bounds and credential stripping across redirects. Labels are checked for nonblank content but retained without trimming.

## Webhook subscriptions and deliveries

- WHEN creating/updating subscriptions, the package shall trim labels/target URLs, require HTTPS and host target approval, and trim/deduplicate nonblank topics preserving first occurrence. Creation starts active with signing version 1. Disabled subscriptions cannot pause or resume; deletion soft-disables and retains history.
- WHEN enqueuing events, the package shall consult matching subscriptions, skip an existing event id for the same subscription, insert a delivery, then save its envelope. The repo must select active subscriptions and atomically enforce uniqueness; the scan and envelope write are not a single package-owned transaction.
- WHEN processing deliveries, the package shall claim once and process claimed rows sequentially. The repository must atomically claim due pending/failed rows, change them to delivering, and increment attempts before returning them. Worker scheduling and abandoned-claim recovery belong to the consumer.
- WHEN applying hooks, the package shall use ascending priority, chain replacement envelopes, and refuse to send on a false `send` or thrown hook. This refusal is recorded as an unsuccessful attempt and can retry/dead-letter; it does not create a canceled state.
- WHEN dispatching, the package shall require an active subscription and saved envelope, JSON-serialize the final envelope, sign that exact body, and POST it with supplied header names. Any 2xx succeeds; other statuses, lookup/signing/transport/hook failures fail the attempt. Repository outcome-write failures reject the batch and can leave later claimed rows unprocessed.
- WHEN an attempt fails, the package shall dead-letter when the claimed attempt count is at least maxAttempts; otherwise it shall schedule equal-jitter retry. Backoff is `round(step/2 + random()*step/2)` with `step = min(6 hours, 5 minutes * 2**(attempts-1))`. Consumers must provide meaningful positive attempt counts and bounded random values; no argument-range validation enforces those assumptions.
- WHEN verifying a signature, the package shall check a finite nonnegative replay tolerance, compare timestamp distance inclusively, and accept any matching candidate HMAC using timing-safe byte comparison. Body bytes are not parsed or normalized. Unknown header fields are ignored; the last timestamp field wins. This time window is not a nonce replay store.

| Setting | Default / bound | Enforcement |
|---|---|---|
| Pause flag | true | Subscription operation |
| Batch size | 20 | Passed to repo; not validated locally |
| Request timeout | 10,000 ms | Passed to HTTP port |
| Delivery attempt limit / `MAX_DELIVERY_ATTEMPTS` | 8 | Compared against repo-returned count |
| `DEFAULT_SIGNATURE_TOLERANCE_SECONDS` | 300 seconds | Caller must explicitly pass tolerance to verification |

The package does not rotate subscription secrets, store root keys, host a receiver, supply production repositories, authorize actors, schedule retries, guarantee exactly-once network delivery, or guarantee atomic row/envelope persistence. `previousSecretVersion` and `signedWithVersion` are record fields without automatic rotation/update logic in these orchestrators.

## Media request and dispatch rules

- WHEN looking up models/providers, the catalog shall return the first exact id match or null; audio model listing defaults to music. Catalog inclusion and provider integrated flags do not guarantee a renderer for every surface/model.
- WHEN registering capability data, later entries for the normalized id shall replace earlier entries. Normalization trims and strips a leading `aihubmix-`; the registry retains capability object references.
- WHEN evaluating default media policy, the package shall deny execution. Explicit enabled mode allows unspecified/empty allowlist dimensions; a nonempty model allowlist denies missing or blank models. The dispatch engine itself does not call policy.
- WHEN building video requests, the package shall choose explicit family before inferred seedance/wan/veo/generic family, switch to an available reference wire model, snap supported numeric durations with first-listed ties, and permit only capability-listed passthrough parameters. This pure builder performs no fetch or filesystem write.
- WHEN generating through the engine, the package shall validate surface/model/audio kind against its static catalog, snap video lengths/audio durations to published constants with warnings, construct context, resolve credentials, and dispatch. It shall prefer a matching custom-image credential override for an OpenAI image request, then the shared adapter registry, then the static route fallback.
- IF no renderer exists, THEN generation shall throw unless allowStubFallback is explicitly true. Stub fallback shall be labeled with usedStubFallback; renderer/auth/transport errors do not trigger a stub fallback.
- WHEN dispatching a vendor adapter, the package shall run its credential guard, build the request, perform one generation fetch, then invoke its parser even on non-2xx. Parsers can perform additional asset/network requests. The generic round-trip timeout is ten minutes; asset fetches use two minutes. Returned asset URLs are resolved/checked and fetched with redirects forbidden. DNS validation is not connection-time DNS pinning.
- WHEN validating media base/asset URLs, the current guard shall permit loopback literals/hostnames and resolved loopback addresses, and treat lookup failure as non-blocking. It blocks its listed private/link-local ranges but is not a public-internet-only guard. The host must enforce stricter egress policy when required.

| Setting | Default / bound |
|---|---|
| Image/video aspect | `1:1` / `16:9` |
| Audio kind / speech format | music / mp3 |
| Stub fallback / `DEFAULT_MEDIA_EXECUTION_POLICY` | false / `{ mode: 'disabled' }` |
| `VIDEO_LENGTHS_SEC` | 3, 5, 8, 10, 15, 30 |
| `AUDIO_DURATIONS_SEC` | 5, 10, 15, 30, 60, 120 |
| Staging directory / age | `.media-attachments` / 24 hours |
| Staging path count / external-file cap | 50 / 100 MiB |
| `DEFAULT_GRACE_MS` / slow-adapter grace | 4000 / 0 ms |
| `DEFAULT_MAX_ATTEMPTS` / `DEFAULT_DEADLINE_MS` | 60 / 15 minutes |
| `DEFAULT_POLL_INTERVAL_MS` | 5000 ms |
| `DEFAULT_PERSIST_RETRY_DELAYS_MS` | 50, 150, 400 ms after the initial write attempt |

- WHEN staging, the package shall reject unsafe directory names, symlink staging directories, unresolvable supplied upload roots, or excessive input count. Missing/malformed paths and unauthorized external paths are skipped. Existing files inside cwd are returned directly without the external-file size cap; only authorized external copies are size-limited. Pruning occurs opportunistically on nonempty stage calls.
- WHEN starting a polling operation, the package shall persist the submitted row before contacting the vendor and keep the submit running after the grace result returns. Signers re-resolve credentials for each submit/poll. Store failures after a successful submit are retried; exhausted retries leave a submitted crash gap.
- WHEN ticking polls, the package shall claim rows sequentially, check deadline before attempt cap before network, fence outcome writes by lease owner, and release leases in finally. Transport/parser errors stay pollable; explicit vendor failure terminates. A custom fetchImpl must provide its own timeout because it bypasses the built-in timeout helper.

Media generation does not automatically create tasks, run a poll scheduler, store output files, authorize owners, moderate content, charge budgets, or execute third-party catalog-only integrations. The host owns context restoration, durable store choice, polling cadence, credential lifecycle, transport controls and output persistence. There is no universal response-byte cap across renderer parsers.

## Recovery and transport limitations

Recovery enumerates nonterminal rows through zero-duration `claimDue` leases with a maximum timestamp; coordinate it with active workers. Staging throws when an external path requires an absent or unresolved uploadRoot, but skips advisory paths rejected by containment. Audio response `audio_length` is milliseconds; 500 formats as 0.5 seconds. Dispatch works on resolved media references; filesystem staging is a separate adapter. ElevenLabs consumes promptInfluence. `buildAuthorizationHeader` deliberately returns the credential-bearing transport header; redacted-result guarantees apply to request/verification results.

Evidence: current credential, webhook, staging, operation-runtime and response-parser source; no tests were run.

Decision rationale: [Webhook endpoints have independent bounded retry state](../decisions/DR-001-independent-webhook-retries.md).
