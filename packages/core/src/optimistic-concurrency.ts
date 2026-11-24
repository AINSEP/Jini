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
import { SettingsRevisionConflictError } from './revision-conflict-error.js';

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
 * The shape of {@link assertVersionedWrite} as an injectable collaborator. A storage adapter that
 * finishes conditional saves (the webhook SQL and in-memory subscription repos) takes this port in
 * its constructor object, so the host binds the implementation and the adapter imports only the type.
 */
export type AssertVersionedWritePort = (required: {
  changedRows: number | bigint;
  recordKind: string;
  recordId: string;
  expectedVersion: number;
  readCurrentVersion: () => Promise<number | null>;
}) => Promise<void>;

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

/**
 * A settings-ledger conflict (`settings` `set(…, { expectedRevisionSeq })` / `clear`) as the shared
 * conflict, so a route or tool that writes settings maps ONE error class to 409 / model guidance.
 * Why a bridge, not a second check: the ledger already compares the value row's `seq` inside its
 * revision-stream lock; only its error spelling differs. Any other error comes back unchanged, so
 * callers can `throw fromSettingsRevisionConflict({ error, setting })` in a catch.
 *
 * @param required.setting - `<namespace>.<key>` of the value that was written.
 * @complexity O(1).
 */
export function fromSettingsRevisionConflict(
  required: { error: unknown; setting: string },
  _optional: Record<string, never> = {},
): unknown {
  const { error } = required;
  if (!(error instanceof SettingsRevisionConflictError)) return error;
  return new RecordVersionConflictError(
    { recordKind: 'setting', recordId: required.setting, expectedVersion: error.expectedRevisionSeq, currentVersion: error.actualRevisionSeq },
    { cause: error },
  );
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

/** A rejected save whose basis version had already been superseded. */
export interface SaveConflict {
  /** The version the editor believed it was editing. `null` only if the server omitted it. */
  expectedVersion: number | null;
  /** The version actually stored now — what the other operator's save produced. `null` only if the
   *  server omitted it. */
  currentVersion: number | null;
  /** The `statusOverride` (called `nextStatus` by the page editor) the rejected save was attempting, carried so an explicit retry re-runs the
   *  SAME intent. Without it a rejected Publish would silently retry as an ordinary draft save. */
  attemptedStatus: "draft" | "published" | undefined;
}

/**
 * The 409 body. `details` carries the versions as fields so the admin "Copy details" text and any
 * client can show "yours N, theirs M" without parsing prose. Same `{ error, code, details }` shape
 * `features/post/expected-version.ts` in a host already sends.
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

/** The machine-readable code for a save that named no version (HTTP status 428). */
export const VERSION_REQUIRED_CODE = 'VERSION_REQUIRED';

/** The one plain-words answer for a save that named no version, shared by the error and its 428 body. */
export const VERSION_REQUIRED_MESSAGE =
  "This save did not say which version you were editing, so nothing was saved (it could have overwritten someone else's change). Reload, make your change again, and save.";

/**
 * A save for an editable record arrived without saying which version the person was editing, so it
 * could have overwritten someone else's change. Nothing was written. Re-reading and saving again can
 * succeed.
 */
export class RecordVersionRequiredError extends Error {
  readonly code = VERSION_REQUIRED_CODE;
  /** The input field that should have carried the version. */
  readonly field: string;

  constructor(required: { field: string }, optional: ErrorOptions = {}) {
    super(VERSION_REQUIRED_MESSAGE, optional);
    this.name = 'RecordVersionRequiredError';
    this.field = required.field;
  }
}

/**
 * Like {@link parseExpectedVersion} but the basis is mandatory for an editor save (a person's form),
 * and a missing one is its own error so a route can answer 428 instead of a generic 400.
 *
 * @throws {ToolInputError} when present but malformed.
 * @throws {RecordVersionRequiredError} when missing.
 * @complexity O(1).
 */
export function requireEditorVersion(required: { value: unknown }, optional: { field?: string } = {}): number {
  const field = optional.field ?? 'expectedVersion';
  const parsed = parseExpectedVersion({ value: required.value }, { field });
  if (parsed === undefined) throw new RecordVersionRequiredError({ field });
  return parsed;
}

/**
 * The 428 body for a save that named no version. HTTP status 428.
 *
 * @complexity O(1).
 */
export function versionRequiredBody(
  required: { error: RecordVersionRequiredError },
  _optional: Record<string, never> = {},
): { error: string; code: typeof VERSION_REQUIRED_CODE; details: { field: string } } {
  const { error } = required;
  return { error: VERSION_REQUIRED_MESSAGE, code: VERSION_REQUIRED_CODE, details: { field: error.field } };
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

/**
 * An internal, single-purpose change (a status flip, an adoption, a rename) applied to a versioned
 * record: read it, derive the next state from what was read, write it conditionally on the version
 * that was read. If the write misses, read again and re-apply the same change once (rule M4), then
 * report the conflict. A person's or an agent's edit never goes through here: it carries its own
 * basis and is never retried for them.
 *
 * @param required.read - Reads the record, `null` when it does not exist.
 * @param required.build - Derives the next record from the one just read; `null` means nothing to write.
 * @param required.write - The conditional write (`WHERE version = current.version`); `true` when it applied.
 * @returns the record as written, or `null` when it does not exist or `build` had nothing to write.
 * @throws {RecordVersionConflictError} when the write missed twice.
 * @complexity O(1) writes; at most two reads, two builds and one extra read for the message.
 */
export async function applyInternalChange<TRecord extends { readonly version: number }>(
  required: {
    recordKind: string;
    recordId: string;
    read: () => Promise<TRecord | null>;
    build: (current: TRecord) => Promise<TRecord | null>;
    write: (required: { current: TRecord; next: TRecord }) => Promise<boolean>;
  },
  _optional: Record<string, never> = {},
): Promise<TRecord | null> {
  let expectedVersion = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await required.read();
    if (!current) return null;
    expectedVersion = current.version;
    const next = await required.build(current);
    if (!next) return null;
    if (await required.write({ current, next })) return next;
  }
  const latest = await required.read();
  throw new RecordVersionConflictError({ recordKind: required.recordKind, recordId: required.recordId, expectedVersion, currentVersion: latest?.version ?? null });
}
