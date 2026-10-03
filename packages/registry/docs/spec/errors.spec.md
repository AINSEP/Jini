Spec ID: SPEC-JINI-REGISTRY-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1a082c153cf737538394622a2d472307e294674741dab35538bec7f8c1553aa3
spec_mode: reverse_spec

# Error Contract: @jini-ai/registry

## Thrown failures

The package defines no public error class or canonical thrown error codes. Plain Errors, protocol schema errors, Node errors, and SQLite driver errors propagate. No automatic retry policy exists.

| Source | Condition | Caller action |
|---|---|---|
| List/search | Filter/query fails the protocol schema | Correct the query; handle schema validation failure |
| Publish | Invalid wire request; GitHub unsafe name/version | Correct the entry before repeating a write |
| GitHub yank | Unsafe name/version or forbidden control characters in reason | Correct values; reject traversal/control content |
| Database construction/reads/yank | `Corrupt registry_entries row (...)` for invalid JSON or wire shape | Repair/quarantine the persistent row; retrying the same read cannot fix corruption |
| SQLite table/write/FTS operations | Driver SQL/constraint/busy errors; schema serialization throws | Preserve transaction rollback; resolve schema/driver/lock/serialization cause |
| GitHub manifest read | 404, path is a directory/non-file, no inline base64 content, invalid decoded JSON, non-JSON response | Verify ref/path/permissions; split oversized manifests or supply a different client |
| GitHub mutation | No token, missing base ref, malformed response without required SHA/URL, non-2xx API response | Correct credentials/ref; inspect remote partial writes before retry |
| Fetch | Platform `FetchTimeoutError(url, timeoutMs)` or original fetch/network failure | Retry only when operation semantics permit; each request uses 15000 ms |
| Describe | Stored catalog input-schema JSON cannot parse | Repair stored schema, not the query |

GitHub error messages generally include `(HTTP <status>)`, not a structured status/code field. Consumer clients may throw their own errors. A mutation failure can follow successful blob/tree/commit/branch writes and is not rolled back.

## Returned diagnostic outcomes

| Outcome/code | Meaning | Caller action |
|---|---|---|
| `resolve` / version resolver returns null | Missing, yanked, unsatisfied range, or no usable source | Select another version/source; distinguish through listing/doctor |
| Database yank `{ ok: false, warnings }` | Entry/version absent | Reconcile the caller's inventory |
| Publish/yank `dryRun: true` with warning | No mutation callback available | Provide a mutation-capable client before treating it as published |
| Signature `{ verified: false, reason }` | Missing/unsupported signature, root, issuer, signing time, invalid chain/key/signature, disallowed SAN identity | Apply fail-closed consumer admission; never treat configured trust as proof |
| Doctor `malformed-manifest`, `malformed-entry`, `invalid-name`, `missing-source`, `missing-yank-reason` | Error-severity health issues | Correct raw manifest data; `ok` is false |
| Doctor `missing-license`, `missing-capabilities` | Warning-severity missing metadata | Enrich entry metadata; warnings alone keep `ok` true |

Valid typed malformed certificates/signatures yield returned failures rather than exceptions. This is not a promise that arbitrary untyped JavaScript values cannot throw. There is no caller-safe sanitization of driver/API error messages.

Evidence: `src/static-backend.ts`, `database-backend.ts`, `github-backend.ts`, `github-client.ts`, `trust.ts`, catalog adapter; tests read only.

## Builder lifecycle and ports

Builder duplicate IDs and empty enrichment/classification configuration throw Error; search limits that are negative or not safe integers throw RangeError. SQLite factory rejects an invalid ISO build timestamp with RangeError. Descriptor/enricher/classifier/clock/store/HTTP failures propagate. There is no builder retry or error normalization.
