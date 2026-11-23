/**
 * @file Site-key wire shapes: the admin's view of the key that seals a site's stored credentials.
 *
 * Types only. The dashboard and the security screens both read these, so they live in one
 * neutral contract instead of two hand-kept copies. The host owns the routes, the key material
 * and the runtime list of states; this module only names the JSON each route returns.
 */

/** Mirrors the host's `resolveRuntimeMode()` closed union — the site key tab's own copy of "is
 *  this a production deployment" (the fact that decides whether the generate action can matter at
 *  all — see `AdminSiteKeyStatus`'s doc). */
export type AdminSiteKeyRuntimeMode = "production" | "local";

/**
 * Mirrors the host's server-side `SiteKeyState` — the 5-state set `GET .../system/site-key`'s
 * `state` field now carries. Hand-declared rather than imported: the server union is not
 * reachable from an admin client. Written as a literal union here because a contract module
 * carries no runtime values; the host keeps the runtime list this type used to be derived from
 * (and the parity test that reads the server source's own union text and checks it against that
 * list), so the two can never silently drift apart. Keep all three edited together.
 */
export type AdminSiteKeyState = "active" | "missing" | "missing-with-data" | "mismatch" | "invalid";

/** Mirrors `GET .../system/site-key`'s response shape (`inspectSiteKeyMaterial`, server-side).
 *  NEVER carries the key value itself — only whether one is active, which of the two possible
 *  sources it came from, and a one-way `fingerprint` a human can use to recognize "same key as
 *  before" across a reload without revealing it. Call the host's explicit reveal action
 *  (`AdminRevealedSiteKey`) for the actual value. */
export interface AdminSiteKeyStatus {
  envVarName?: string;
  reason?: "empty" | "not-hex" | "odd-length" | "too-short";
  active: boolean;
  source: "env" | "file" | "none";
  fingerprint?: string;
  /** `true` when a source was found but is not valid hex — `active` is `false` in this case too. */
  invalid?: boolean;
  /** Where a generated file lives (or would live) — not secret, a fixed filesystem convention.
   *  Always present, even when `source` isn't `"file"`, so a `"none"` status can still say where
   *  Generate would write. */
  keyFilePath: string;
  runtimeMode: AdminSiteKeyRuntimeMode;
  /** The host's site-key state — see {@link AdminSiteKeyState}'s own doc for what it mirrors. */
  state: AdminSiteKeyState;
}

/** `POST .../system/site-key/generate`'s success outcomes: `already-active` (200, a key matching
 *  the site's stamp was already in place, nothing written), `recovered` (200, the stamped key was
 *  found in another source and adopted), `created` (201, no sealed data, a new key minted). */
export type AdminSiteKeyGenerateOutcome = "already-active" | "recovered" | "created";

/** Mirrors `POST .../system/site-key/generate`'s `200`/`201` response shape. Deliberately has NO
 *  `hex` field (sol finding 3-2, 2026-09-16 fix): the admin's `generate()` only ever reads
 *  `fingerprint`/`keyFilePath`/`runtimeMode` from this response, so the server stopped sending the
 *  raw key value here — it had no consumer and was pure exposure. The reveal call
 *  ({@link AdminRevealedSiteKey}) stays the one, explicit, on-purpose call that returns the value;
 *  `AdminSiteKeyStatus` (the plain `GET`) never carries it either. */
export interface AdminGeneratedSiteKey {
  outcome: AdminSiteKeyGenerateOutcome;
  fingerprint: string;
  keyFilePath: string;
  runtimeMode: AdminSiteKeyRuntimeMode;
}

/** `POST .../system/site-key/import`'s 200: the pasted token is now this site's key. `resealed`
 *  counts credentials saved under the key that was in place and moved onto the token. */
export interface AdminImportedSiteKey {
  outcome: "unlocked";
  fingerprint: string;
  keyFilePath: string;
  resealed: number;
  restorePointId?: string;
  runtimeMode: AdminSiteKeyRuntimeMode;
}

/** A webhook whose signing secret changes when the site starts fresh. */
export interface AdminSiteKeyAffectedWebhook {
  label: string;
  targetUrl: string;
}

/** `GET .../system/site-key/start-fresh`: what confirming would do, in one plain sentence. */
export interface AdminSiteKeyStartFreshPreview {
  removes: number;
  affectedWebhooks: AdminSiteKeyAffectedWebhook[];
  detail: string;
  runtimeMode: AdminSiteKeyRuntimeMode;
}

/** `POST .../system/site-key/start-fresh`'s 200. The new key is never in the body. */
export interface AdminStartedFreshSiteKey {
  outcome: "started-fresh";
  fingerprint: string;
  keyFilePath: string;
  discarded: number;
  kept: number;
  restorePointId: string;
  affectedWebhooks: AdminSiteKeyAffectedWebhook[];
  runtimeMode: AdminSiteKeyRuntimeMode;
}

/** Mirrors `POST .../system/site-key/reveal`'s response shape — {@link AdminSiteKeyStatus}
 *  plus the raw value when one is active. `hex` is absent when `active` is `false` (nothing to
 *  reveal). */
export interface AdminRevealedSiteKey extends AdminSiteKeyStatus {
  hex?: string;
}
