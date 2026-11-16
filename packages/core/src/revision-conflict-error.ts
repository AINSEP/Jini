/**
 * @file The settings-ledger revision-conflict error, kept at the package root (it is the one settings
 * error the root `optimistic-concurrency` bridge must recognise; `./settings/errors.js` re-exports it).
 */
/**
 * A scoped value changed since the caller's snapshot; read again before retrying.
 * Both sequences refer to the addressed value row, never the ledger's global watermark.
 * @example if (error instanceof SettingsRevisionConflictError) await refreshSnapshot();
 */
export class SettingsRevisionConflictError extends Error {
  readonly expectedRevisionSeq: number;
  readonly actualRevisionSeq: number;

  constructor(
    required: { expectedRevisionSeq: number; actualRevisionSeq: number },
    optional: ErrorOptions = {},
  ) {
    super(`Setting revision changed: expected ${required.expectedRevisionSeq}, found ${required.actualRevisionSeq}.`, optional);
    this.name = "SettingsRevisionConflictError";
    this.expectedRevisionSeq = required.expectedRevisionSeq;
    this.actualRevisionSeq = required.actualRevisionSeq;
  }
}
