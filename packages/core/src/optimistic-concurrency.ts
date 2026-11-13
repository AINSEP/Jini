/**
 * @file The one optimistic-concurrency vocabulary every editable record shares (refactor pattern
 * "lost updates", 2026-11-13).
 *
 * Why it exists: whole-record saves (PUT routes, `*_update`/`*_set` tools, full-row upserts) wrote
 * whatever the caller sent over whatever was stored, so two editors — or a person and the assistant
 * — silently overwrote each other. Posts, pages, entries, menus and content types already closed
 * this with an integer `version` column, an `expectedVersion` basis and a `409 VERSION_CONFLICT`;
 * each domain spelled its own error class and envelope. This module is that same contract once, so
 * every remaining site applies one pattern instead of inventing a sixth spelling.
 *
 * Deliberately storage- and server-neutral: no query builder, no HTTP framework. A repo reports how
 * many rows its conditional write changed and how to read the live version; a route turns the error
 * into a plain JSON body with whatever server it runs on.
 */
import { ToolInputError } from './tool-input-errors.js';
import type { ModelFacingErrorRule } from './model-facing-tool-errors.js';

/** The machine-readable code every arm publishes for a superseded basis — the same string posts,
 *  entries, menus and content types already send, so existing admin classifiers keep working. */
export const VERSION_CONFLICT_CODE = 'VERSION_CONFLICT';

/**
 * A compare-and-set write lost: the record moved on (or was deleted) after the caller read it.
 * Nothing was written. Resending the same request cannot succeed; re-reading can.
 */
export class RecordVersionConflictError extends Error {
  readonly code = VERSION_CONFLICT_CODE;
  /** Plain-words noun for the record, e.g. `webhook`, `MCP server`. */
  readonly recordKind: string;
  readonly recordId: string;
  /** The version the caller read. */
  readonly expectedVersion: number;
  /** The version stored now, or `null` when the record no longer exists. */
  readonly currentVersion: number | null;

  constructor(
    required: { recordKind: string; recordId: string; expectedVersion: number; currentVersion: number | null },
    optional: ErrorOptions = {},
  ) {
    const now = required.currentVersion === null ? 'it has since been deleted' : `it is now version ${required.currentVersion}`;
    super(
      `This ${required.recordKind} was changed by someone else after you opened it (you had version ${required.expectedVersion}, ${now}). ` +
        'Nothing was saved. Reload it to see the latest version, then make your change again.',
      optional,
    );
    this.name = 'RecordVersionConflictError';
    this.recordKind = required.recordKind;
    this.recordId = required.recordId;
    this.expectedVersion = required.expectedVersion;
    this.currentVersion = required.currentVersion;
  }
}

/**
 * The basis off an untrusted input. `undefined` means the caller did not send one (legacy
 * last-write-wins callers); anything present must be a non-negative integer.
 *
 * Throws instead of coercing: a mistyped `"3"` read as "no basis" would turn a client that believes
 * it is protected into an unguarded overwrite — the exact bug this closes.
 *
 * @throws {ToolInputError} `'<field>' must be a non-negative integer when present`.
 * @complexity O(1).
 */
export function parseExpectedVersion(
  required: { value: unknown },
  optional: { field?: string } = {},
): number | undefined {
  const { value } = required;
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ToolInputError({ message: `'${optional.field ?? 'expectedVersion'}' must be a non-negative integer when present` });
  }
  return value;
}

/**
 * Like {@link parseExpectedVersion} but the basis is mandatory — for assistant write tools, where
 * the model always reads a record before replacing it, so a missing basis is a caller mistake.
 *
 * @throws {ToolInputError} with plain recovery words when missing or malformed.
 * @complexity O(1).
 */
export function requireExpectedVersion(
  required: { value: unknown; readToolId: string },
  optional: { field?: string } = {},
): number {
  const field = optional.field ?? 'expectedVersion';
  const parsed = parseExpectedVersion({ value: required.value }, { field });
  if (parsed === undefined) {
    throw new ToolInputError({ message: `'${field}' is required: call ${required.readToolId} first and pass the record's current version.` });
  }
  return parsed;
}

/**
 * Finishes a conditional write (`UPDATE … WHERE version = :expectedVersion`). Changed rows ⇒ done;
 * none ⇒ re-read the live version (for the message) and throw.
 *
 * @param required.changedRows - What the driver reported (`numUpdatedRows`, `changes`, `rowCount`).
 * @param required.readCurrentVersion - Reads the stored version, `null` when the row is gone.
 * @throws {RecordVersionConflictError} when no row changed.
 * @complexity O(1) plus one read on a miss.
 */
export async function assertVersionedWrite(
  required: {
    changedRows: number | bigint;
    recordKind: string;
    recordId: string;
    expectedVersion: number;
    readCurrentVersion: () => Promise<number | null>;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (Number(required.changedRows) > 0) return;
  throw new RecordVersionConflictError({
    recordKind: required.recordKind,
    recordId: required.recordId,
    expectedVersion: required.expectedVersion,
    currentVersion: await required.readCurrentVersion(),
  });
}

/** The JSON body an HTTP route answers a conflict with, under status 409. */
export interface VersionConflictBody {
  readonly error: string;
  readonly code: typeof VERSION_CONFLICT_CODE;
  readonly details: {
    readonly recordKind: string;
    readonly recordId: string;
    readonly expectedVersion: number;
    readonly currentVersion: number | null;
  };
}

/**
 * The 409 body. `details` carries the versions as fields so the admin "Copy details" text and any
 * client can show "yours N, theirs M" without parsing prose. Same `{ error, code, details }` shape
 * `features/post/expected-version.ts` in Tovu already sends.
 *
 * @complexity O(1).
 */
export function versionConflictBody(
  required: { error: RecordVersionConflictError },
  _optional: Record<string, never> = {},
): VersionConflictBody {
  const { error } = required;
  return {
    error: error.message,
    code: VERSION_CONFLICT_CODE,
    details: {
      recordKind: error.recordKind,
      recordId: error.recordId,
      expectedVersion: error.expectedVersion,
      currentVersion: error.currentVersion,
    },
  };
}

/**
 * The model-facing rule for a domain's allowlist: publishes the plain message plus what to do next,
 * so the assistant re-reads instead of resending the same stale call (or giving up).
 *
 * @complexity O(1).
 */
export function versionConflictRule(
  required: { readToolId: string },
  _optional: Record<string, never> = {},
): ModelFacingErrorRule {
  return {
    error: RecordVersionConflictError,
    code: VERSION_CONFLICT_CODE,
    guidance:
      `Your change was NOT applied and nothing was overwritten. Call ${required.readToolId} again, ` +
      "reapply the change on top of what it returns, and resend with that result's `version` as `expectedVersion`. " +
      'Do not resend this call unchanged. If the other change conflicts with what the person asked for, tell them instead of choosing.',
  };
}
