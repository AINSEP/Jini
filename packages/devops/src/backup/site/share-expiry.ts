import { SiteShareRefusal } from "./share-refusal.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The plain-words refusals for an expiry choice; the host owns the wording and injects it. */
export interface ShareExpiryCopy {
  readonly choices: string;
  readonly notHostedHere: string;
  remote(required: { provider: string }): string;
}

/** Host policy and copy for share-link expiry. Every member is REQUIRED: the engine carries no host defaults. */
export interface ShareExpiryHost {
  /** The day counts a new export may choose besides Never (`null`, always accepted). */
  readonly choices: readonly number[];
  readonly copy: ShareExpiryCopy;
  /** The plain-words answer for an expired link (acknowledgement and owner download). */
  expiredMessage(required: { row: { readonly expiresAt?: string | null | undefined } }): string;
}

/** A share destination as far as expiry cares: its provider and (for an own folder) its absolute binding. */
export type ShareExpiryDestination = { readonly provider: string; readonly binding?: string };

/** True when `days` is one of the host's day choices (Never is not a day choice). */
export function isShareExpiryChoice(required: { days: unknown; choices: readonly number[] }, _optional: Record<string, never> = {}): required is { days: number; choices: readonly number[] } {
  return typeof required.days === "number" && required.choices.includes(required.days);
}

/**
 * Refuses an expiry unless the destination is affirmatively this server's own share folder: only this
 * server's token route checks `expiresAt`, so a remote copy (or no recorded destination) would keep
 * serving past the stated date.
 * @throws {SiteShareRefusal} INVALID_INPUT with the host's plain words.
 */
export function requireOwnFolder(required: { destination: ShareExpiryDestination | undefined; copy: ShareExpiryCopy; ownFolderProvider: string; isOwnFolder: (required: { storage: ShareExpiryDestination }) => boolean }, _optional: Record<string, never> = {}): void {
  const { destination, copy } = required;
  if (!destination) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: copy.notHostedHere });
  if (required.isOwnFolder({ storage: destination })) return;
  const message = destination.provider === required.ownFolderProvider ? copy.notHostedHere : copy.remote({ provider: destination.provider });
  throw new SiteShareRefusal({ code: "INVALID_INPUT", message });
}

/**
 * The `expiresAt` a new share records for the owner's choice: `null` (Never) for any destination, or
 * `now + days` (from the injected host clock) for an affirmatively own-folder destination.
 * @throws {SiteShareRefusal} INVALID_INPUT for an unsupported choice or a destination not affirmed as own folder.
 */
export function shareExpiresAt(required: { days: number | null; now: number; destination: ShareExpiryDestination | undefined; expiry: ShareExpiryHost; ownFolderProvider: string; isOwnFolder: (required: { storage: ShareExpiryDestination }) => boolean }, _optional: Record<string, never> = {}): string | null {
  const { days, expiry } = required;
  if (days === null) return null;
  if (!isShareExpiryChoice({ days, choices: expiry.choices })) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: expiry.copy.choices });
  requireOwnFolder({ destination: required.destination, copy: expiry.copy, ownFolderProvider: required.ownFolderProvider, isOwnFolder: required.isOwnFolder });
  return new Date(required.now + days * DAY_MS).toISOString();
}

/**
 * True once a share's own stated expiry has passed. Absent metadata (older rows, peer uploads) never
 * expires: live links never break. A persisted value that does not parse counts as expired for SERVING
 * only, so a damaged row can stop a public link but never extend one; it is not evidence that the
 * artifact may be removed.
 */
export function isShareExpired(required: { row: { readonly expiresAt?: string | null | undefined }; now: number }, _optional: Record<string, never> = {}): boolean {
  const { expiresAt } = required.row;
  if (expiresAt === undefined || expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || required.now >= at;
}
