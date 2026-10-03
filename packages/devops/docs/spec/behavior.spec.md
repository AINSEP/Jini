Spec ID: SPEC-JINI-DEVOPS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:dc21a07267e2d0b46da2a5a282f3bc93dbaddbcf72437f2a88021abbbceb3043
spec_mode: reverse_spec


# DevOps behavior contract

## Deployment and guarded transport

The root shall have no effects or callable exports. `publishDeploy` shall select the first target with matching id and forward files/projectName plus optional metadata/responseHeaders exactly once. It does not authorize, validate file payloads, retry, resolve credentials or impose idempotency. Tool registration shall deny every call by default; opting into role gating permits any matching role (default `deploy:publish`). Confirmation and executor timeout remain absent unless supplied. The handler forwards metadata and ignores executor AbortSignal; target work can continue after executor cancellation.

Labels shall use NFKD, lowercase ASCII letters/digits/hyphens, collapse/trim hyphens and apply the caller cap (DNS variant 63). Empty output is valid. maxLength is not range-validated.

Reachability shall normalize bare hostnames to HTTPS, reject unsafe/non-HTTPS URLs before fetch, attach connection-time validating DNS lookup, and request manual redirects. This guard relies on the host transport honoring the supplied dispatcher. A 200..399 response is reachable; no Location is followed. HEAD is first; unsuccessful/nonprotected HEAD is followed by GET. Provider protection is detected only on 401 with the supplied detector. Default single-probe timeout is 8 seconds. The current timer is cleared when fetch returns, before body reading; a stalled response body is not bounded by that timer.

Polling shall normalize/deduplicate candidates in input order, stop on first ready/protected result and otherwise return link-delayed with first candidate/last failure message. Defaults: 60-second poll budget, 2-second interval, label `Deployment provider`. The loop checks time between sweeps; each probe receives the wait timeout, so this is not a hard overall deadline. No candidate returns immediately with an empty URL. Clock/sleep must advance; wait numeric options are not validated.

`redirectGuardInit` shall overwrite redirect to manual without mutating init; `assertNotRedirected` shall reject opaque redirects and all 300..399 responses. Kit use and guard ordering are consumer responsibilities for provider operations.

## Source control

Validation shall precede credential resolution/export. Provider validation runs before generic target validation. Owner/repo must each be one nonblank URL segment of 1..100 characters, exclude controls/separators and differ from `.`/`..`; branch permits `[A-Za-z0-9._/-]`, 1..250 characters; commit message must be nonblank and <=500 raw characters. These generic rules do not implement every provider's branch rules.

Registry loading shall sort catalog packages by pluginId, record refusals, parse inactive descriptors without import, and import only trusted entries. Descriptor schemaVersion must be 1; provider ids are lowercase hyphenated, <=64 characters, distinct within the file; labels nonblank <=100; apiOrigin exact HTTPS origin; module safe relative `.mjs`; maxFileBytes positive safe integer; optional path lists <=20 entries, each <=200 characters. Credential/i18n extensions are host-validated. Duplicate ids across different packages are not rejected; get chooses the first. Snapshots are shallowly frozen, not deeply immutable.

Module operations shall not overwrite declared host facts. API selection prefers exact origin; a sole enabled provider can serve another origin. Reserved folders match case-insensitively at exact/ancestor boundaries; workflow paths are case-sensitive descendant checks. Provider limits/paths are metadata; the package does not enforce them on all writes.

Preview shall make a fresh clean export without credentials/repository effects, return total byte/file counts and up to 50 lexically sorted paths. Commit shall resolve one credential for the requested provider, reject mismatched provider identity, export once and call commitSite once. Route failures precede asset failures. Export bytes remain usable after cleanup; staging cleanup is best-effort and occurs before provider commit. No automatic retry, conflict resolution or distributed transaction is offered.

## Static export

The runner shall validate basePath and positive safe-integer fetchTimeoutMs (default 30,000), prepare output (clean false by default), build manifest, open the actual host app and close it in finally. A session baseUrl must be an HTTP(S) origin without credentials/path/query/fragment. Manifest/preparation/startup/inventory/close errors throw; per-route/asset errors become report entries and collection continues.

Routes shall run sequentially in manifest order. Content routes write `<path>/index.html`; well-known paths preserve filenames; not-found uses host error-page path/status acceptance. Ordinary routes require 200; redirects require 3xx, preferring live Location over manifest target. Unsafe redirect schemes degrade to `#`. HTML security transformation is host-supplied. Written route/asset bytes are retained in reports.

Asset discovery shall scan quoted href/src/srcset on raw successful non-error route bodies, restrict prefixes, deduplicate request URLs and follow one CSS url hop. CSS dependencies are fetched without further CSS crawling. URL query variants can map to the same output file; no collision guard exists. Output paths reject decoded traversal, separators/controls/absolute escapes. Base-path rewriting is textual; runtime JavaScript URLs and external URLs are not rewritten. No response-size, route-count or asset-count bound is imposed.

Node writer shall require absolute regular directory ancestry, refuse symlink destinations and use no-follow 0600 writes. Existing output requires explicit clean to remove contents. Ancestor races against hostile concurrent processes require host isolation. Node app factory shall bind loopback on an ephemeral port and close idempotently. Node theme inventory includes only regular files and returns sorted relative paths.

## Agent jobs

Options and unique safe ids shall validate before writes; concurrency must be positive integer, sandbox one of two supported modes, directories absolute and required executable/model/effort/prefix nonblank. Jobs shall be scheduled with at most min(concurrency, jobs.length) workers; result order matches input. There is no job timeout, cancellation API or cross-batch lock.

An existing `<id>.md` shall skip a job. Otherwise logs are cleared and streamed to `.jsonl`/`.err`. Success requires turn.completed, no error/turn.failed event anywhere, and a nonempty final agent_message; process exit code alone neither proves nor disproves success. Malformed lines are ignored. Success writes newline-terminated `.md` and removes `.failed`; failure removes `.md` and writes `.failed`. Artifact write errors can reject the batch. Node runner shall use shell false, prompt stdin, an explicit copied environment, and await both log pipelines; failure kills the child and awaits settled pipelines.

## Packaging

Staging shall plan unresolved/version-conflicting production dependencies before copying. Flattened same-version dependencies can be reused; no rollback of already copied files is provided. Closure checking considers shipped root/nested node_modules only. Packer delegates actual build/pack semantics to its required port. Node copy dereferences package symlinks and rejects overlapping source/destination.

Pruning shall verify every requested native target before removals; universal expands to x64/arm64. Unknown prebuild formats remain; linux accepts linuxmusl. Strip removes declarations regardless of keepScopes, removes maps outside retained scopes, and package coverage directories. Payload inventory is validated before copies. Bundled npm staging validates marker/disjoint roots and rejects nonregular/native inputs before replacing output; file-size accounting uses adapter diskBytes.

ASAR verification shall compare bytes, omit symlinks, report missing prefixes/source/unreadable entries, and fail empty prefix inventories. Quiet-tree checks combine watcher/dirty/moving signals; a quiet sample is not sufficient proof of archive correctness. Moving-path samples use two snapshots separated by required positive interval. Missing freshness timestamps yield no stale result. Import checking traverses literal static imports/re-exports/dynamic imports once through the supplied AST parser and aliases; it cannot prove runtime-computed import closure.

## Checks and local development

Published-types projects shall run sequentially. Local file/workspace/link specs are exempt; devDependencies overwrite same-named dependencies. Links mode detects symlinks only. Compile modes run prerequisites, install into unique scratch, reject installed links, own a nearer scoped shadow directory, compile the real config, and clean only owned shadow/scratch paths. Published mode fails any nonzero compiler result; drift mode subtracts identical whole diagnostics from a valid baseline. Operational/cleanup failure remains failure. Logging errors propagate.

Coverage shall use caller classifiers/roots/floors. Percentages aggregate counters; zero denominators yield 100, but empty measurable scopes fail floors. Merge keeps the greater line-hit image, first on ties, never sums images. Tier evaluation rejects missing/inconsistent records; a known zero-branch file passes both tiers. Base-ref precedence: override > positional > PR base (remote-prefixed when unqualified) > nonzero eventBefore > fallback. Integrity is heuristic: wrapper functions indicate contamination; >=30 DA records with nonzero wrapper-count overlap and no extra counts escalate severe. Severe findings cannot be baselined; source-only re-export barrels can be skipped. Missing readSource preserves evaluation. Disk areas report newly unmeasured paths and require minFilesOnDisk (default 1); declared known gaps remain visible.

Node process runner defaults to 32 MiB output buffer and 300,000 ms timeout. Npm adapter defaults to install with audit/fund/lock/workspaces/scripts disabled. Environment loader requires Node 20.12+; exported environment wins over file values. listenersOn shall reject ports outside integer 1..65535 and return [] for runner failures/nonzero/no output. listenerCommand construction errors propagate. No installed tools, build invocation, process exit, source scan or environment load occurs merely by importing these APIs.

Evidence: current implementations and tests under source-control, static-export, agent-jobs, packaging, deploy, checks and local-dev; inspected without running commands described by these APIs.
