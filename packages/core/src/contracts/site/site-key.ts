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
 * `GET .../system/site-key`'s `state` field — the one union both the host's server route (its
 * `siteKeyState`) and the admin client type that field with. Written as a literal union here
 * because a contract module carries no runtime values; the host keeps the runtime list (and a
 * parity test that pins it to this union), so the two can never silently drift apart. Keep both
 * edited together.
 *
 * - `"active"` — a valid key resolves, and either nothing is stamped in the site's metadata file yet
 *   or the stamped site-key fingerprint matches the resolved key's own fingerprint.
 * - `"missing"` — no source resolves to usable material, and this site's store holds no data
 *   that only a site key could decrypt or verify.
 * - `"missing-with-data"` — no source resolves, but this site's store (any storage kind, or its
 *   sealed storage secret) DOES hold such data — a materially more urgent banner than plain
 *   `"missing"`: something the operator saved is stuck behind a key that no longer resolves.
 * - `"mismatch"` — a valid key resolves, but its fingerprint differs from the site metadata's own
 *   stamped fingerprint — the physical key file was substituted for a different one after the
 *   stamp was written (the ensure-site-key "mismatch" outcome, surfaced here independently for the
 *   read path).
 * - `"invalid"` — a source was found (env var set, or a key file present) but its content fails hex
 *   validation.
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

/**
 * What `useSiteKey` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same shape as `access-tokens-port.hooks.ts`/`other-credentials-port.hooks.ts`.
 * No rotate/replace (see `SiteKeyTab.tsx`'s own header); the last three methods are the locked
 * site's recovery ("Paste your old site key", "Start fresh").
 */
export interface SiteKeyPort {
  status(): Promise<AdminSiteKeyStatus>;
  /** The raw key value, on demand — see `lib/api.ts`'s `revealSiteKey` doc. */
  reveal(): Promise<AdminRevealedSiteKey>;
  /** Throws (an `ApiError`) on a 409 refusal — see `lib/api.ts`'s `generateSiteKey` doc for the
   *  outcomes and codes. */
  generate(): Promise<AdminGeneratedSiteKey>;
  /** See `lib/api.ts`'s `importSiteKey`. Throws an `ApiError` on a refusal. */
  importSiteKey(required: { siteKey: string }, optional?: Record<string, never>): Promise<AdminImportedSiteKey>;
  previewStartFresh(): Promise<AdminSiteKeyStartFreshPreview>;
  /** See `lib/api.ts`'s `startFreshSiteKey`. Throws an `ApiError` on a refusal. */
  startFresh(required: { confirm: string }, optional?: Record<string, never>): Promise<AdminStartedFreshSiteKey>;
}
