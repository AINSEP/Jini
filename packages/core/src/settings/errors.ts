/**
 * @file Typed domain errors for `settings`.
 *
 * Purpose:
 * One class per error this module originates, mirroring the
 * `PresentationSettingsNotFoundError`/`PresentationSettingsValidationError`
 * convention a host's own presentation-settings module may use. Route
 * handlers map these 1:1 to HTTP codes.
 */
export class DefinitionInvalidError extends Error {}
export class ScopeNotAllowedError extends Error {}
export class SecretNotSupportedError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}
export class ValueValidationFailedError extends Error {}
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
export class RenameRetypeConflictError extends Error {}
export class AliasDepthExceededError extends Error {}
export class DefinitionTombstonedError extends Error {}
export class DefinitionNotFoundError extends Error {}
export class PurgeRequiredError extends Error {
  constructor({ message }: { message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
  }
}
export class ForbiddenError extends Error {}

/** : the target `principalId` does not resolve to an active principal in the request's workspace. See docs/decisions/DR-003-settings-ledger-invariants.md. */
export class PrincipalNotFoundError extends Error {
  constructor(
    message: string,
    public readonly principalId: string,
    public readonly workspaceId: string
  ) {
    super(message);
  }
}
