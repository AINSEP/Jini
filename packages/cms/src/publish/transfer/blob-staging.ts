import { createHash } from "node:crypto";

/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 6.
 *
 * Pure helpers for the blob pre-flight routes (`blobs/probe`, `blobs/:sha`). Kept separate from the
 * route handlers so the security-critical property below has a direct unit test that needs no
 * Express request/response, no `BlobStorePort`, and no auth harness.
 *
 * ## The property this file exists to hold
 *
 * `BlobStorePort.putIfAbsent` (`@jini-ai/cms/media`'s `ports.ts`) does NOT verify that the bytes it
 * is given actually hash to the `sha256` it is told — it only uses that string to derive the
 * storage key (`computeBlobStorageKey`) and writes an create-only object there. Read directly:
 * `blob-store.fs.ts`'s `putIfAbsent` opens `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}` with
 * `O_CREAT|O_EXCL` and writes whatever bytes it was handed — it trusts its caller's `sha256`
 * completely. In this feature, the sha IS the identity (baselines, `PackedEntity.requiredBlobs`,
 * `blobManifest` all address a blob by its claimed hash) — accepting bytes that do not actually
 * hash to their claimed sha256 would let a caller poison content-addressed storage: a later reader
 * asking "do you have blob X" would get `true` for bytes that are not actually X. The PUT route
 * MUST call {@link bytesMatchSha256} and refuse a mismatch BEFORE ever calling `putIfAbsent` —
 * `putIfAbsent` itself will not catch it.
 */

/** Lowercase 64-hex-character shape a sha256 digest must have. Rejects anything else (wrong
 *  length, uppercase, non-hex) before it is ever used to build a storage key or a DB row — the
 *  route-layer input-shape gate the interface routes to this file's real check. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Whether `value` has the shape of a lowercase hex-encoded SHA-256 digest. Shape-only — does not
 * verify any relationship to actual bytes; see {@link bytesMatchSha256} for that.
 *
 * @complexity O(1) (fixed-length regex).
 */
export function isValidSha256Hex({ value }: { value: string }, _optional = {}): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

/**
 * Hashes `bytes` with SHA-256, lowercase hex — the same digest shape used everywhere else a sha256
 * is stored or compared in this feature (`content-hash.ts`'s own `contentHash` uses the identical
 * `createHash("sha256")...digest("hex")` shape, for the same "one canonical form" reason).
 *
 * @complexity O(n) in `bytes.length`.
 */
export function sha256Hex({ bytes }: { bytes: Uint8Array }, _optional = {}): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The security check this file exists for (see file header): does `bytes` actually hash to
 * `claimedSha256`? Case-insensitive on the claimed side (a peer's client is not guaranteed to send
 * lowercase), always compared against this module's own lowercase {@link sha256Hex} output.
 *
 * @complexity O(n) in `bytes.length` (one hash pass).
 */
export function bytesMatchSha256(required: { bytes: Uint8Array; claimedSha256: string }, _optional = {}): boolean {
  return sha256Hex({ bytes: required.bytes }) === required.claimedSha256.toLowerCase();
}

/**
 * Resource-bounds cap (Programmer skill 5a4) for `blobs/probe`'s request array — an unbounded
 * `shas[]` would let one request force an unbounded number of `blobStore.exists()` calls. Chosen
 * generously above any real bundle's blob count (this feature's own local corpus is 54 posts,
 * ~1 KB average body — plan §6 item 7) while still being a real, enforced ceiling rather than
 * "assume the caller is reasonable".
 */
export const PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS = 2000;
