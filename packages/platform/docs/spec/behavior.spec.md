Spec ID: SPEC-JINI-PLATFORM-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a179301976219eef581b04d1d09191b1e10c0c70fbc5420740e7ea159961d454
spec_mode: reverse_spec

# Behavior Contract: @jini-ai/platform

## Commands, processes, paths, and environment

Command invocation wraps Windows bat/cmd executables through ComSpec and returns direct command/args elsewhere. Package-manager invocation prefers npm_execpath, uses the current Node executable for JS entry files, and otherwise uses corepack pnpm. Neither helper executes the returned invocation.

Proxy merging applies sources in order, normalizes case variants, prefers lowercase within a source, skips undefined values, and sets NODE_USE_ENV_PROXY when endpoints exist unless explicitly configured. Native discovery supports macOS/Windows and returns an empty overlay for unsupported systems or command failures; command timeout is 2000 ms. Discovery does not configure a proxy server.

Stamp reading supports flag=value and flag value. Command-string parsing splits whitespace without shell-quote parsing. Normalization failures on reading return null; matching/generation can propagate normalizer errors. Background spawn defaults detached and unrefs the child; logged spawn returns a referenced ChildProcess. Both wait for the spawn event. Liveness treats ESRCH as dead and other signal-probe errors as alive.

Process-tree collection includes roots and descendants, deduplicates, and sorts numeric PID descending. It does not produce a topological ordering. Stop excludes the current PID and deduplicates input, sends SIGTERM, polls up to 5000 ms, then SIGKILL and polls up to another 5000 ms; non-ESRCH signal errors propagate. No descendant discovery is performed inside stop.

Buffered execution defaults to 120000 ms and 1 MiB output buffer. Native callback failures are returned with ok false/error/code, trimmed stdout/stderr. Invalid arguments can still reject through the Promise executor. On POSIX, `execCommandViaLoginShell` actually invokes the selected shell with `-c` and exports process.env.PATH; it does not request login profile loading. Windows uses direct execFile.

Home expansion recognizes leading bare/prefixed `~`, `$HOME`, and `${HOME}`; it does not perform general environment interpolation. Toolchain discovery returns candidate paths, with detected version directories sorted newest first; it does not ensure every candidate exists or modify PATH.

Resource-root configuration must fall under supplied safe bases or throws. Checks are lexical, not a realpath sandbox. CLI path prefers configured paths then resolves the caller's package. Data-dir override is resolved, created, and checked writable; default path is returned without those checks. Sandbox import roots must be absolute; enabled import access is checked against canonicalized allowed roots and the existing ancestor of the candidate. An empty allowlist denies imports. Invalid mode strings throw; missing mode is disabled. Runtime env is an overlay and does not enforce OS/process isolation. Disabled runtime returns the input env object unchanged.

## Filesystem primitives and guarded reading

`pathContains` compares resolved paths lexically, includes equality, and does not detect symlink escape. `resolvePathWithin` requires a strict descendant and canonical path agreement; it returns null for root equality, escape, or incompatible input path spelling. Neither function opens files.

Atomic copy creates parents and a temporary sibling; existing destinations are rejected unless overwrite is true. A same-path copy is a no-op returning the existing size and replaced true. Overwrite renames directly over the destination, keeping the old file readable until replacement and preserving it when rename fails. No race-safe no-clobber or crash-durability guarantee is supplied.

Removal defaults recursive, uses force, and returns failure text instead of throwing. Missing-path removal reports success. Log tail reads the whole file, filters empty lines, and returns the last 80 by default or an empty list on errors; its returned-line limit is not an input-byte ceiling.

Object-based atomic writes preserve prior permission bits or use 0600 for an absent destination. Native temporary creation is exclusive, chmod precedes rename, and chmod/rename failure triggers best-effort cleanup. Other stat failures occur before writing. File fsync precedes rename and parent-directory fsync follows it. Async writers optionally create parents. Temporary ownership is established by exclusive creation before cleanup. JSON is pretty-printed and unserializable top-level values are rejected.

Env transforms replace/read only the first exact `KEY=` line. Upsert preserves other lines and returns a trailing newline. They neither parse shell syntax nor escape supplied values.

Guarded reader requires explicit root/rules/positive limits. It denies absolute/NUL/empty paths, root escapes, symlink escapes, denied requested/effective segments and filenames, with normalization for case, trailing dot/space, and alternate-stream suffixes. Text reads require a regular file, enforce the byte bound on metadata and actual bytes, and reject NUL in the sniff window. Binary reads retain arbitrary bytes and enforce caller maxBytes during streaming. These path checks precede opens; they do not promise an atomic race-free filesystem sandbox.

Listing skips symlinks, denied names, and default node_modules/.git/dist directories. It bounds depth, walked entries, and result count; sorts returned relative filenames; and sets truncated when a bound is hit. Missing directories return an empty list. Relative filenames are relative to the chosen listing start directory.

## Durable JSON

Reads distinguish missing from unreadable and retain corrupt text when reading succeeded but parsing failed. Writes create parents, pretty-print to a PID-named temp file, fsync that file, then rename. No directory fsync, automatic lock, mode preservation, or cross-file transaction exists. Call `withLock` explicitly around shared writes.

Locks use exclusive creation and a PID/random ownership token. Defaults are 5000 ms wait, 10 ms poll, 30000 ms stale age. Dead-PID or stale-age locks may be broken even when an old owner is still running. Release removes only a matching ownership token. Native synchronous sleeping blocks the thread. Critical callbacks must be synchronous; returning a Promise releases the lock before that work completes. The source records a residual race between concurrent stale-lock breakers.

Quarantine renames to `.corrupt-<nowMs>`, reports the move, and returns true; missing files also return true. Rename failure reports and returns false without overwriting the original. Reporting-port failures can propagate. Salvage tries at most 1000 detected element boundaries by default, newest first, appending inferred closers; absence of a parsable prefix returns undefined.

## HTTP and asset caching

Fetch-with-timeout combines caller and timeout signals. It wraps a fetch rejection as FetchTimeoutError only when the timeout fired and the caller signal did not. Original network/caller-abort failures propagate. The timer signal still belongs to the returned Response's underlying fetch, but the wrapper returns at headers and cannot reclassify later body-read failures. It performs no URL admission, response-byte cap, retry, or status rejection.

HTTP readiness polls until any 2xx, bounds each fetch to remaining time, and sleeps 150 ms after a failed attempt. Total elapsed time can exceed the configured deadline by the trailing polling sleep/scheduling delay; timeout zero issues no fetch. Bodies are not consumed or schema-checked.

Guarded HTTP requires a nonempty user agent and positive policy time/byte bounds. Each hop validates scheme, rejects URL credentials, resolves addresses, rejects any nonpublic answer when private-address denial is enabled unless the exact hostname is dev-allowlisted, and pins the first admitted address. Empty resolution fails. Allowed schemes are consumer policy; callers should configure HTTP(S) for the native transport.

Default user agent is added only when no case-insensitive user-agent exists. The client follows redirects only for GET, up to maxRedirects, validating/pinning every hop and stripping authorization/cookie on cross-origin hops. At the redirect limit it returns the redirect response. Manual returns it; error rejects it. Other methods never auto-follow. Optional rateLimit fields are not enforced.

Socket inactivity is min(request idle/legacy timeout, policy connectTimeoutMs). A separately supplied totalDeadlineMs covers resolution and request/redirect chain via the clock signal; without it, DNS has no overall deadline. Effective decoded-body cap is min(request cap, maxResponseBytes, maxDecompressedBytes). Truncation is returned with flags. Native transport retains Host/TLS identity while dialing the pinned IP, decodes gzip/deflate/br, and has a 100 MiB absolute fallback ceiling. Slow active transfer can exceed the idle timeout without failure.

`guardedFetch` defaults to redirect error and refuses flagged truncation. It preserves byte bodies and repeated cookies, removes content-encoding/content-length after decoding, and suppresses body for HEAD/204/205/304. It returns a Response without promising populated Response.url from the client's finalUrl.

Asset cache accepts selected HTTP(S) media extensions. It rejects invalid schemes/credentials/localhost/private literal IPs and validates DNS answers at connection time through the supplied undici dispatcher. A custom fetch must honor that dispatcher to preserve the guard. Redirects are refused. Defaults are 64 MiB and 15000 ms; declared and streaming lengths are capped. Content type accepts image/video/audio or extension fallback. Disk-write failures still serve fetched bytes.

Completed cache reads precede new network validation and byte-limit enforcement; the cache directory is trusted host-owned state. There is no expiration/pruning/global disk quota or cache-close API.

## Downloads, signing, and blob storage

Managed downloads require an owned empty/new store or valid ownership sentinel, safe bucket/filename, HTTP(S) URL, and valid SHA-256/SHA-512 checksum. Same-target identical identities share one in-process task; a conflicting active identity is refused. Cross-process locks refuse live holders and recover abandoned holders. Partial downloads resume with range/validator checks or restart from zero; checksum is verified before promotion. Completed matching bytes are reused.

Default attempts are 3 with no delay/backoff and no built-in network deadline. The first task's fetch/headers/attempt settings govern joined callers. Caller abort cancels only that caller's wait and progress subscription; the transfer can continue and complete after abort, including a pre-aborted first caller. Progress callback exceptions are not isolated. Copy-and-clear verifies output, refuses different existing bytes, and defers cleanup while copy leases remain. Prune defaults to 24-hour age and returns warnings; it is explicitly called, not scheduled.

SigV4 signs supplied canonical method/path/query/body/header inputs and mutates headers with authorization/date/content hash/optional session token. Host is the caller's responsibility. No credentials lookup, request send, retry, or egress check occurs.

Local blobs overwrite writes, delete missing files idempotently, reject traversal in read/write/delete/stat paths, and return null from stat on native failure/non-file. Its list method joins namespace directly and has no matching namespace validation. Paths are lexical; symlink confinement and atomic writes are not guaranteed. S3 checks required options, signs each request, uses virtual hosting by default and path style for custom endpoints. Fetch failures may propagate unwrapped; no built-in deadline/retry/byte bound is applied. List follows at most 1000 pages and can return a partial result at that ceiling.

## Secrets and credential sets

Root-key parsing trims hex and rejects empty/nonhex/odd-length/under-32-byte material; longer valid material is accepted. HKDF-SHA256 outputs 32 bytes with consumer salt and purpose/scope info. Invalid present env material never falls back to file. Key loading is lazy and cached; activeKey reports a handle without reading/validating the root. Defaults permit file fallback/automatic generation. Explicit generation uses exclusive 0600 creation and never overwrites; automatic missing-file generation lacks that exclusive guard.

AES-256-GCM uses a fresh 12-byte nonce and a 16-byte tag appended to ciphertext, both base64 encoded. Key derivation uses fixed sealer purpose/scope and supplied keyId. Unsupported algorithm, corrupt tag, wrong key/salt/AAD fail. AAD formatting is colon-joined without escaping; consumers must choose unambiguous parts and preserve historical salt/AAD/key material for stored ciphertext. There is no rotation/old-key lookup beyond the supplied keyring's derivation behavior.

Memory credential repo enforces label uniqueness within workspace/vendor, keeps at most one default after writes, promotes the lexically latest updatedAt when deleting a default, and silently ignores account-label updates for absent IDs. Update can insert an absent row; IDs are Map keys rather than separately uniqueness-guarded inserts. Returned row objects/sealed values are not deep-cloned. This repo neither seals plaintext nor validates authorization/timestamps.

## Mail

Mail gate requires durable readiness for production notification lane; only exact interactive bypasses it. Omitted/unrecognized lanes default notification. Local mode bypasses readiness. Purpose alone does not select lane. Capability name is sourceContext.module. The gate passes results/options through and implements no outbox, suppression, deduplication, or tenant matching. Delivery availability checks only driver != console.

SMTP advertises no idempotency/webhook feedback, maxBatchSize 1, attachments supported. It still sends an arbitrary batch sequentially without a batch-size guard. Adapter does not enforce send-option timeout or dedup keys; native transport connectionTimeout is set only by factory option. Successful acceptance uses injected clock; SMTP failures return classified results, including caught clock failures. Credentials/transport configuration are supplied by the consumer.

## Resolved comment mismatches and evidence

- `src/shell.ts` now documents preservation of a non-login PATH; profile loading remains the host's responsibility because login profiles can hide command shims.
- `src/terminal.ts` now shares an in-flight loader Promise; successful loads remain cached and failed attempts permit retry.
- `src/terminal.ts` now measures retained output and flush thresholds in UTF-8 bytes. Trimming still keeps the newest event even when it exceeds the bound.
- `src/process.ts` now documents descending numeric PIDs without promising child-first order; numeric PID order is not a process-tree order.
- `src/fs.ts` now replaces the destination directly with rename, closing the missing-file window and preserving the old bytes on rename failure.

Evidence: public modules named in `api.spec.md`, root primitive tests, guarded timeout/body-byte tests, pinned sealing tests, atomic failure tests, mail gate/SMTP tests. This document is based on static reading; no tests or processes were run.

Decision rationale: [Unknown mail purposes take the restrictive delivery lane](../decisions/DR-001-purpose-scoped-mail.md), [Outbound HTTP inherits guards from one injected client](../decisions/DR-002-guarded-egress.md).


Shared locks are non-reentrant. Reclaim requires a dead local owner or elapsed stale budget plus matching inode/device; bytes/mtime/path identity are rechecked before removal. Release requires token plus inode/device. Infinity disables age stealing. A residual check-to-unlink race exists without conditional filesystem unlink. Durable JSON passes its own 5000/30000/10 ms policy. Atomic failures before rename preserve the destination; directory fsync can reject after new bytes are visible.
