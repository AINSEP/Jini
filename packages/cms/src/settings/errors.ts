/**
 * @file Typed domain errors for `settings` (SPEC-007 errors.spec.md §2).
 *
 * Purpose:
 * One class per error this module originates, mirroring the
 * `PresentationSettingsNotFoundError`/`PresentationSettingsValidationError`
 * convention a host's own presentation-settings module may use. Route
 * handlers map these 1:1 to HTTP codes.
 */
export class DefinitionInvalidError extends Error {}
export class ScopeNotAllowedError extends Error {}
export class SecretNotSupportedError extends Error {}
export class ValueValidationFailedError extends Error {}
export class RenameRetypeConflictError extends Error {}
export class AliasDepthExceededError extends Error {}
export class DefinitionTombstonedError extends Error {}
export class DefinitionNotFoundError extends Error {}
export class PurgeRequiredError extends Error {}
export class ForbiddenError extends Error {}

/** REQ-13: the target `principalId` does not resolve to an active principal in the request's workspace (INV-09). */
export class PrincipalNotFoundError extends Error {
  constructor(
    message: string,
    public readonly principalId: string,
    public readonly workspaceId: string
  ) {
    super(message);
  }
}
