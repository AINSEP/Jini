/**
 * @file Vendor-neutral contract for updating a deployed site to a newer release from the site itself.
 *
 * Every platform (a hosted deploy, a desktop-made site, a self-hosted box) supplies the same four
 * ports; `runSiteUpdate` owns the safety order (owner approval, backup, migration readiness gate,
 * apply, live check, rollback). Nothing here touches the network: adapters do.
 */
import type { IdGenerator } from '@jini-ai/core/primitives';
import { UNAVAILABLE_ERROR_ID } from '@jini-ai/core/errors/reporter';

/** Options every port call accepts. */
export interface SiteUpdateCallOptions { signal?: AbortSignal | undefined }

/** One published release as a feed reports it. `notes` is plain text the owner reads. */
export interface SiteRelease { version: string; notes: string }

/** What `checkForUpdate` reports when a newer release exists. */
export interface SiteUpdateAvailable { latest: string; notes: string }

/** The approved move. `fromVersion` is the version kept to roll back to. */
export interface SiteUpdatePlan { fromVersion: string; toVersion: string; notes: string }

/** Result of the migration readiness gate. `reason` is plain words shown to the owner. */
export type MigrationReadiness = { status: 'ok' } | { status: 'blocked'; reason: string };

/** Result of the post-deploy live check. */
export type SiteUpdateVerification = { status: 'healthy' } | { status: 'unhealthy'; reason: string };

/**
 * The owner's explicit OK for one specific target version. There is no default and no "always":
 * a token for another version is refused, so an approval can never be replayed onto a later release.
 */
export interface SiteUpdateApproval { kind: 'owner-approval'; approvedBy: string; toVersion: string }

/** Where the newest release is announced. */
export interface ReleaseFeedPort {
  latestRelease(required: Record<string, never>, optional?: SiteUpdateCallOptions): Promise<SiteRelease | null>;
}

/** Makes a restorable backup of the running site before anything changes. */
export interface SiteBackupPort {
  createBackup(required: { fromVersion: string }, optional?: SiteUpdateCallOptions): Promise<{ backupId: string }>;
}

/** Options of {@link MigrationReadinessPort.check}: the backup just captured and the version it was taken of. */
export interface SiteUpdateReadinessOptions extends SiteUpdateCallOptions {
  backupId?: string | undefined;
  fromVersion?: string | undefined;
}

/** Answers whether stored data is ready for `toVersion` (pending migrations, incompatible schema). */
export interface MigrationReadinessPort {
  check(required: { toVersion: string }, optional?: SiteUpdateReadinessOptions): Promise<MigrationReadiness>;
}

/** The platform side: find, plan, deploy, check and undo an update. */
export interface SiteUpdatePort {
  checkForUpdate(required: { runningVersion: string }, optional?: SiteUpdateCallOptions): Promise<SiteUpdateAvailable | null>;
  planUpdate(required: { runningVersion: string; update: SiteUpdateAvailable }, optional?: SiteUpdateCallOptions): Promise<SiteUpdatePlan>;
  /** Triggers the platform deploy and waits until it has landed. `summary` says what the platform did. */
  applyUpdate(required: { plan: SiteUpdatePlan; backupId: string }, optional?: SiteUpdateCallOptions): Promise<{ summary: string }>;
  /** Checks the live site actually serves the new version and works. */
  verifyUpdate(required: { plan: SiteUpdatePlan }, optional?: SiteUpdateCallOptions): Promise<SiteUpdateVerification>;
  /** Puts `to` (the kept previous version) back live; `backupId` lets the adapter restore data too. */
  rollback(required: { to: string; backupId: string }, optional?: SiteUpdateCallOptions): Promise<void>;
}

/** The live check an adapter runs after the new version is up: does the site work on `expectedVersion`? */
export interface SiteHealthPort {
  check(required: { expectedVersion: string }, optional?: SiteUpdateCallOptions): Promise<SiteUpdateVerification>;
}

/** Puts the site's stored data back from a backup made by {@link SiteBackupPort}. */
export interface SiteDataRestorePort {
  restore(required: { backupId: string }, optional?: SiteUpdateCallOptions): Promise<void>;
}

export type SiteUpdateStep = 'approval' | 'backup' | 'readiness' | 'apply' | 'verify' | 'rollback';
export type SiteUpdateStepStatus = 'done' | 'refused' | 'blocked' | 'failed' | 'skipped';
export type SiteUpdateOutcome = 'updated' | 'refused' | 'blocked' | 'aborted' | 'failed' | 'rolled-back' | 'rollback-failed';

/** One line of the step log, in the order the steps ran. */
export interface SiteUpdateStepLog { step: SiteUpdateStep; status: SiteUpdateStepStatus; detail: string }

export type SiteUpdateErrorCode = 'invalid-version' | 'invalid-image-tag';

/** A plain-words failure whose message starts with its `ERR-` id. */
export class SiteUpdateError extends Error {
  readonly code: SiteUpdateErrorCode;
  readonly errorId: string;
  constructor(required: { code: SiteUpdateErrorCode; errorId: string; detail: string }) {
    super(`${required.errorId}: ${required.detail}`);
    this.name = 'SiteUpdateError';
    this.code = required.code;
    this.errorId = required.errorId;
  }
}

/** Options of {@link compareSiteVersions}. */
export interface CompareSiteVersionsOptions {
  /** Mints the `ERR-` id for an invalid version; without it the reserved unavailable id is used. */
  ids?: IdGenerator | undefined;
}

interface ParsedVersion { core: [number, number, number]; prerelease: string[] }

const CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
const NUMERIC_IDENTIFIER = /^\d+$/;

const isIdentifier = (part: string): boolean => IDENTIFIER_PATTERN.test(part);

/**
 * Splits semver 2.0 text into its core and prerelease identifiers, or null when the shape is wrong.
 * Accepts a leading "v" (release tags are often "v1.2.3"). Build metadata after "+" is checked and
 * then dropped, because semver says it carries no precedence.
 */
function splitVersion(version: string): { core: string; prerelease: string[] } | null {
  const [main = '', build, ...extra] = version.replace(/^v/, '').split('+');
  if (extra.length > 0 || (build !== undefined && !build.split('.').every(isIdentifier))) return null;
  const dash = main.indexOf('-');
  if (dash === -1) return { core: main, prerelease: [] };
  const prerelease = main.slice(dash + 1).split('.');
  return prerelease.every(isIdentifier) ? { core: main.slice(0, dash), prerelease } : null;
}

/**
 * Says whether text is a semver version that {@link compareSiteVersions} accepts, without throwing.
 *
 * @param required.version - Candidate text, e.g. `1.2.3` or `v1.2.3-rc.1`.
 * @returns true for a valid version.
 * @complexity O(n) in the length of the text.
 */
export function isSiteVersion(required: { version: string }, _optional: Record<string, never> = {}): boolean {
  const parts = splitVersion(required.version);
  return parts !== null && CORE_PATTERN.test(parts.core);
}

function parseVersion(required: { version: string; ids?: IdGenerator | undefined }): ParsedVersion {
  const parts = splitVersion(required.version);
  const match = parts ? CORE_PATTERN.exec(parts.core) : null;
  if (!parts || !match) {
    const errorId = required.ids?.newId() ?? UNAVAILABLE_ERROR_ID;
    throw new SiteUpdateError({ code: 'invalid-version', errorId, detail: `"${required.version}" is not a version number like 1.2.3.` });
  }
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: parts.prerelease };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  // Semver: numeric identifiers always sort below alphanumeric ones.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
  // A release without a prerelease tag outranks any prerelease of the same core (0.7.3-next.2 < 0.7.3).
  if (left.length === 0 || right.length === 0) return Math.sign(right.length - left.length);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareIdentifier(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return Math.sign(left.length - right.length);
}

/**
 * Orders two semver versions.
 *
 * @param required.left - First version, e.g. `0.7.3-next.2`.
 * @param required.right - Second version.
 * @returns -1 when left is older, 0 when equal in precedence, 1 when left is newer.
 * @throws SiteUpdateError (`invalid-version`) naming the bad input, message prefixed by its `ERR-` id.
 * @complexity O(n) in the number of prerelease identifiers.
 */
export function compareSiteVersions(required: { left: string; right: string }, _optional: CompareSiteVersionsOptions = {}): -1 | 0 | 1 {
  const left = parseVersion({ version: required.left, ids: _optional.ids });
  const right = parseVersion({ version: required.right, ids: _optional.ids });
  for (let index = 0; index < 3; index += 1) {
    const order = Math.sign(left.core[index]! - right.core[index]!);
    if (order !== 0) return order as -1 | 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease) as -1 | 0 | 1;
}
