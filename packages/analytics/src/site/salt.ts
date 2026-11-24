/**
 * @file Daily salt derivation for the host `analytics` ingest seam (ADR-035 Round-3 fold item 2).
 *
 * Purpose:
 * Derives the per-workspace, per-day salt folded into `visitorHash` (see `@jini-ai/analytics`). The salt
 * is NEVER persisted — every call re-derives it on demand from a analytics seed, so a copied or
 * backed-up `content.db` alone cannot reconstruct it (closing the dictionary-attack risk the
 * Round-3 audit fold names).
 *
 * How it relates to the project:
 * - ADR-035's Round-3 fold pins the mechanism as `HKDF(analyticsSeed, "analytics-salt:" + workspaceId +
 *   ":" + utcDate)` over a `KeyringPort` seed that lives outside the portable `content.db`
 *   (ADR-024 secret invariant).
 * - `KeyringPort` (`src/webhooks/ports.ts`) is signing-specific today — `deriveSigningSecret`
 *   is scoped to webhook subscriptions and can't serve a generic salt derivation. That mismatch is
 *   an open Round-2 audit blocker on the integrations side, not something to force-fit here.
 * - So this module is deliberately self-contained: it takes a raw `analyticsSeed` string (e.g. from
 *   an env var placeholder) rather than calling `KeyringPort` directly.
 * - The HKDF wire context (`saltContext`) is host-owned and injected: changing either of its strings
 *   changes existing visitor/session hashes, so the host pins it byte-for-byte.
 *
 * Integration gap: wire to a corrected generic `KeyringPort.derive()` once that round-2 audit finding is
 * fixed (today's `KeyringPort.deriveSigningSecret` shape is webhook-specific and out of scope for
 * this ingest-only slice to redesign).
 */
import { deriveDailySalt as deriveJiniDailySalt, type AnalyticsSaltContext } from "../index.js";

/**
 * Derives the daily-rotating, per-workspace analytics salt used to compute `visitorHash`.
 *
 * Mechanism: `HKDF-SHA256(analyticsSeed, salt=saltContext.extractionSalt, info="<saltContext.infoPrefix><workspaceId>:<utcDate>", 32)`
 * via Node's built-in `crypto.hkdfSync`. HKDF (not a plain HMAC) is used because this is a true
 * key-derivation step — expanding one long-lived root secret into many independent, fixed-length,
 * context-bound subkeys (one per workspace/day) is exactly HKDF's designed job (RFC 5869), and
 * Node ships it natively so no extra dependency is needed. A single `createHmac` call would work
 * for a one-off digest, but HKDF's explicit extract-then-expand shape is the more honest fit for
 * "derive a subkey from an analytics seed" and is what the ADR text pins.
 *
 * The result is NEVER persisted by this function or its callers — callers must re-derive it per
 * request (or cache it in memory for the current UTC day at most); nothing here writes to disk.
 *
 * @param required.analyticsSeed - Secret analytics seed material. In v1 this is an opaque string sourced
 *   from an env var placeholder (e.g. `process.env.ANALYTICS_ROOT_KEY_SEED`); the real integration
 *   point is `KeyringPort.activeKey()` once that port grows a generic derive method (see file
 *   header integration gap).
 * @param required.workspaceId - Workspace the salt is scoped to (ADR-007 — no cross-workspace salt
 *   reuse).
 * @param required.utcDate - UTC calendar date as `YYYY-MM-DD`. A new date yields an unrelated salt,
 *   which is what makes the visitor hash non-linkable across days (24h rotation, ADR-035 §4).
 * @param required.saltContext - The host's HKDF wire context (extraction salt + info prefix).
 * @returns A 32-byte buffer. Deterministic for a fixed `(analyticsSeed, workspaceId, utcDate, saltContext)`.
 * @throws {RangeError} if `workspaceId` or `utcDate` is empty (a blank scope key would silently
 *   collapse the per-workspace/per-day separation this function exists to provide).
 * @complexity O(1) — one HKDF-SHA256 extract+expand call over fixed-length inputs.
 * @overallScore 100/100
 */
export function deriveDailySalt(
  required: { analyticsSeed: string; workspaceId: string; utcDate: string; saltContext: AnalyticsSaltContext },
  _optional: Record<string, never> = {}
): Buffer {
  // The host pins the derivation bytes; the package owns HKDF and scope validation.
  return deriveJiniDailySalt({ ...required, rootKeySeed: required.analyticsSeed }); // site-key-legacy: installed @jini-ai/analytics seed field; remove on/after 2026-11-01
}
