Spec ID: SPEC-JINI-REGISTRY-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c834cdb121e1a8257c62bf6d556c2c28a626d84babb2274028505087632b1bca
spec_mode: reverse_spec

# Behavior Contract: @jini-ai/registry

## Listing, search, version resolution

Static reads parse entries with protocol schemas and silently omit invalid entries. A missing/nonarray entries envelope produces an empty list. List preserves valid manifest order, hides yanked entries by default, matches publisher case-insensitively, requires every requested tag, and accepts entries matching any query term.

Search applies tag inclusion, honors `includeYanked`, matches any lowercased whitespace-delimited term across name/title/description/tags/capability summaries/publisher, scores the matched-term fraction, sorts descending score then ascending name, and defaults to 100 results. An empty term set yields score zero. Protocol schema validation applies before filtering.

Resolve matches entry names case-insensitively and returns null for absent/unresolvable/yanked entries. An entry-level yank blocks all its versions. Version-level yanks block the selected version. Resolution supports exact versions, dist-tags, `latest`, caret, and tilde; it is not a complete semver-range parser (no comparator sets, wildcards, or OR expressions). Caret ranges respect zero-major/minor bounds; tilde stays in the base major/minor; prereleases require a matching prerelease base tuple. Ranges select the highest non-yanked candidate in `entry.versions`; an empty versions list is not used as a synthesized range candidate.

Default selection uses latest tag, then top-level version, then first non-yanked version. Selected source/ref/integrity/digest/deprecation prefer version-level fields over entry fields. An absent source returns null even if a distribution archive exists. `manifest(name, version)` returns the full entry after successful resolution, not just a selected version manifest.

Doctor inspects raw entries rather than the schema-filtered set and returns issues instead of hiding malformed manifest/entry values. It checks name, source/archive, license, capabilities, and entry-level yank reason; it is not exhaustive wire-schema validation or signature admission.

## Persistence and mutations

Database construction idempotently ensures its table and loads existing rows. Every inherited read takes a fresh full-table snapshot ordered by name. Corrupt stored JSON or schema-invalid rows throw, including during construction and doctor. Publish validates its request before writes; dry run does not mutate. Upsert replaces the whole entry JSON at `(backend_id, name)` and does not merge versions. Direct `upsertRegistryEntry` performs no validation.

Database yank holds an IMMEDIATE transaction across read and write. It returns `ok: false` with warnings for missing entry/version, marks the matched version with timestamp/reason, and additionally marks the top-level entry when yanking its current version. Repeated yanks can update timestamps; they are not an exact no-op.

GitHub construction reads the manifest once; the instance retains that snapshot. Publish and yank create pull requests rather than committing changes into the instance's read snapshot. Paths and branches are deterministic; names must be lowercase vendor/name and versions safe single identifiers. Yank rejects selected control characters in the reason. Explicit dry-run publish or a missing mutation callback returns `dryRun: true`; a missing callback adds a warning. Yank without that callback also returns a dry-run result.

The API client writes blobs, tree, commit, branch, then pull request sequentially. A branch-create 409/422 triggers a forced branch update; an already-existing-PR 422 triggers lookup/reuse of the open PR. These recoveries do not make the whole operation transactional or side-effect-free on retry. Each fetch uses the platform QUICK timeout (15 seconds); there is no total-operation deadline or automatic backoff. Response decoding happens after fetch resolves.

## Signature verification boundary

Verification is separate from configured `trust`; a cryptographically verified restricted backend remains restricted. Missing roots/signatures and unsupported `cosign`, `minisign`, or `custom` kinds return unverified outcomes. Only github-oidc is implemented. It checks CA chaining/signatures, allowed issuer metadata, certificate validity at the self-reported signing time, optional certificate SAN identity allowlist, and SHA-256 signature of the canonical payload.

Payload is `name@version:digest`, preferring top-level integrity, top-level manifestDigest, distribution integrity, distribution manifestDigest, then empty digest. It does not cover every manifest field or automatically bind the separately selected version record. Entry verification returns the first success or last failure. Backends report the outcome; they do not refuse an unverified resolved entry. Consumers enforce admission.

No network trust-root discovery, transparency-log inclusion proof, independently trusted timestamp, revocation check, or raw OIDC JWT validation is supplied. Source code documents these scope limits.

## Tool catalog

Ensure creates the base table plus external-content FTS5 table if absent; it does not seed or rebuild an existing table. Reseed deletes/reinserts the complete catalog and rebuilds FTS inside one transaction. Duplicate IDs, unserializable schemas, or SQL errors abort that transaction. Direct external table changes require FTS maintenance by the host.

Search tokenizes to lowercase ASCII alphanumeric words, joins them with FTS OR, weights IDs 6 and descriptions 1, orders by bm25 rank, and returns score as negative rank. Default limit is 10; the function does not validate/clamp the supplied limit. Empty token input returns no hits. Describe returns null when absent and parses stored schema JSON. Root/content search and catalog search are independent APIs.

## Resolved comment/test mismatches

`src/static-backend.ts` now describes GitHub's single snapshot loaded in `create`. The search test title now describes exclusion when no term matches; a multi-term regression case pins acceptance of a partial match with its matched-term fraction. Any-term matching remains the contract because scoring partial matches is part of the existing search behavior.

Evidence: public source listed in `api.spec.md`, backend/version/trust/client tests and catalog SQLite tests. No tests were executed. The package does not install registry content, execute tools, implement consumer authorization, or own a UI.

## Builder lifecycle and ports

The universal builder snapshots descriptors, rejects duplicate IDs before allocation, classifies sources with host policy and restores authored descriptions after search. Enrichment defaults on, including doc2query. Live overview rereads the source; search snapshots remain fixed until the host constructs/rebinds another. SQLite reseeds its shared table, so separate snapshots need separate storage. GitHub uses the required core HTTP client; no implicit global fetch is selected.
