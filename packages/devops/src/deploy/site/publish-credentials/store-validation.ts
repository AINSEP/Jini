import { VaultError, type VaultSummary } from '@jini-ai/core/contracts/vault';
import type { DeployTargetRegistry, DeployTargetCredentialSpec, DeployTargetFieldSpec } from '../deploy-targets/types.js';
import type { PublishConnectionInput, PublishProviderId } from './types.js';
import type { PublishCredentialReadDeps } from './store.js';

/** Thrown for any caller-supplied value that fails shape validation — the route maps this to `400`. */
export class PublishCredentialValidationError extends Error {}

const MAX_LABEL_LENGTH = 200;

export function validatedWorksFor({ deps, value }: { deps: PublishCredentialReadDeps; value: unknown }, _options = {}): string[] {
  try { const ids = deps.normalizeCredentialWorksFor({ value }); for (const id of ids) { assertPlainField({ deps, value: id, field: "worksFor" }); } return ids; }
  catch (error) { if (error instanceof VaultError) { throw new PublishCredentialValidationError("worksFor must be an array of provider IDs"); } throw error; }
}

/** A provider move retargets the old host/vendor compatibility, preserving unrelated IDs.
 * Explicit compatibility edits win, including an empty list. No I/O; O(compatibility IDs).
 */
export function updatedWorksFor({ deps, value, row, provider, host }: {
  deps: PublishCredentialReadDeps; value: unknown; row: Pick<VaultSummary, "provider" | "meta">; provider: string; host: string;
}, _options = {}): string[] {
  if (value !== undefined) return validatedWorksFor({ deps, value });
  const previous = deps.parseStoreMeta({ kind: "vendor", meta: row.meta, provider: row.provider }).worksFor as string[];
  if (provider === row.provider) return previous;
  return validatedWorksFor({ deps, value: previous.map(id => id === row.provider?.toLowerCase() || id === host.toLowerCase() ? provider : id) });
}

/** Narrows and validates a caller-supplied `label`. Never throws a raw `TypeError` — every rejection
 *  is a {@link PublishCredentialValidationError} the route/tool layer can map to its own `400`. */
export function validateLabel({ deps, raw }: { deps: PublishCredentialReadDeps; raw: unknown }, _options = {}): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PublishCredentialValidationError("label must be a non-empty string");
  }
  if (raw.length > MAX_LABEL_LENGTH) {
    throw new PublishCredentialValidationError(`label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  assertPlainField({ deps, value: raw, field: "label" });
  return raw;
}

/** Shared check-then-trim step for {@link requireNonEmptyString}/{@link optionalString} — the two
 *  differ only in whether `undefined` is acceptable, never in what counts as "non-empty" or what gets
 *  persisted. Always returns the TRIMMED value, never the raw one just validated: a leading or trailing
 *  space pasted alongside a real value (an endpoint URL, an access key, a bearer token) is never
 *  meaningful, and returning it unmodified lets it survive into storage, then into every reader
 *  downstream — for a secret field, that surfaces later as a misleading "wrong credentials" far from
 *  where the stray space was typed. Extracted (2026-09-05) after `optionalString` was fixed alone once
 *  already and `requireNonEmptyString` was found carrying the identical untrimmed-return bug days
 *  later — a single shared step is what keeps the two from drifting apart a second time. */
function assertNonEmptyTrimmed({ raw, message }: { raw: unknown; message: string }, _options = {}): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new PublishCredentialValidationError(message);
  }
  return raw.trim();
}

function requireNonEmptyString({ raw, field, providerId }: { raw: unknown; field: string; providerId: string }, _options = {}): string {
  return assertNonEmptyTrimmed({ raw, message: `'${field}' (non-empty string) is required for provider '${providerId}'` });
}

function optionalString({ raw, field }: { raw: unknown; field: string }, _options = {}): string | undefined {
  if (raw === undefined) return undefined;
  // A blank optional form field (e.g. an optional zone id left empty) means "not provided", not an
  // invalid value: secure forms send every field, so rejecting "" blocked saving a valid credential.
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  return assertNonEmptyTrimmed({ raw, message: `'${field}' must be a non-empty string when provided` });
}

/** Narrows a caller-supplied `isDefault`. `undefined` means "no default change requested" (the same
 *  omitted-means-unchanged convention `label`/`connection` already use); any other non-boolean value
 *  is rejected rather than coerced, so a stray string/number in the request body cannot silently be
 *  read as truthy. */
export function optionalBoolean({ raw, field }: { raw: unknown; field: string }, _options = {}): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw new PublishCredentialValidationError(`'${field}' must be a boolean when provided`);
  }
  return raw;
}

/** A validated connection plus the host credential spec it was validated against. */
export interface ValidatedConnection {
  readonly connection: PublishConnectionInput;
  readonly spec: DeployTargetCredentialSpec;
}

/**
 * Validates a caller-supplied `connection` against the credential its host declares
 * (`DeployTargetDescriptor.credential` in this workspace's deploy registry): `providerId` must be a
 * target that takes a saved credential; every declared required field must be a non-empty string,
 * every declared optional one a non-empty string when present. Required fields are checked before
 * optional ones, in declaration order. Values are trimmed; undeclared keys are dropped. Never throws a
 * raw shape error — every rejection is a {@link PublishCredentialValidationError}.
 *
 * @complexity O(t + f): one pass over the registry's targets (for the error text), one over the fields.
 */
function normalizeSecret(required: { deps: PublishCredentialReadDeps; value: unknown; field: string }): string {
  try { return required.deps.normalizeCredentialToken({ value: required.value, field: required.field }); }
  catch (err) { if (err instanceof required.deps.CredentialInputError) { throw new PublishCredentialValidationError(err.message); } throw err; }
}
function assertPlainField(required: { deps: PublishCredentialReadDeps; value: string; field: string }): void {
  try { required.deps.assertCredentialFreeField({ value: required.value, field: required.field }); }
  catch (err) { if (err instanceof required.deps.CredentialInputError) { throw new PublishCredentialValidationError(err.message); } throw err; }
}

export function validateConnection({ deps, raw, registry }: { deps: PublishCredentialReadDeps; raw: unknown; registry: DeployTargetRegistry }, _options = {}): ValidatedConnection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PublishCredentialValidationError("connection must be an object");
  }
  const value = raw as Record<string, unknown>;
  const { providerId, spec } = connectionCredentialSpec({ value, registry });

  const fields: Record<string, string> = {};
  const ordered = [...spec.fields.filter(field => field.required), ...spec.fields.filter(field => !field.required)];
  for (const field of ordered) {
    const normalized = validatedConnectionField({ deps, value: value[field.name], field, spec, providerId });
    if (normalized !== undefined) fields[field.name] = normalized;
  }
  if (fields[spec.tokenField] === undefined) normalizeSecret({ deps, value: undefined, field: spec.tokenField });
  return { connection: { providerId, ...fields }, spec };
}

export function connectionCredentialSpec({ value, registry }: {
  value: Record<string, unknown>; registry: DeployTargetRegistry;
}, _options = {}): { providerId: string; spec: DeployTargetCredentialSpec } {
  const providerId = value.providerId;
  const spec = typeof providerId === "string" ? registry.get(providerId)?.descriptor.credential : undefined;
  if (typeof providerId !== "string" || spec === undefined) {
    const known = registry.list().flatMap((target) => (target.descriptor.credential !== undefined ? [target.descriptor.id] : []));
    throw new PublishCredentialValidationError(`connection.providerId must be one of: ${known.join(", ")}`);
  }

  return { providerId, spec };
}

export function isSecretField({ field, spec }: {
  field: DeployTargetFieldSpec; spec: DeployTargetCredentialSpec;
}, _options = {}): boolean {
  return Boolean(field.secret || field.name === spec.tokenField);
}

function validatedConnectionField({ deps, value, field, spec, providerId }: {
  deps: PublishCredentialReadDeps; value: unknown; field: DeployTargetFieldSpec; spec: DeployTargetCredentialSpec; providerId: string;
}, _options = {}): string | undefined {
  const secret = isSecretField({ field, spec });
  if (secret && (field.required || value !== undefined)) return normalizeSecret({ deps, value, field: field.name });
  const normalized = field.required ? requireNonEmptyString({ raw: value, field: field.name, providerId }) : optionalString({ raw: value, field: field.name });
  if (!secret && normalized !== undefined) assertPlainField({ deps, value: normalized, field: field.name });
  return normalized;
}

/** Preserve only a provider change between compatible token-only contracts. Companion-field
 * changes and different secret schemas still require the validated replacement path.
 * @complexity O(k) time/space for k supplied keys; fixed schema checks, no I/O. */
export function preservedMove({ raw, registry, host }: { raw: unknown; registry: DeployTargetRegistry; host: PublishProviderId }, _options = {}): { providerId: string; spec: DeployTargetCredentialSpec } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const values = raw as Record<string, unknown>;
  if (typeof values.providerId !== "string" || values.providerId === host) return undefined;
  const spec = tokenOnlyMoveSpec({ registry, host, providerId: values.providerId });
  if (!spec || !isProviderOnlyMove({ values, spec })) return undefined;
  return { providerId: values.providerId, spec };
}

function tokenOnlyMoveSpec({ registry, host, providerId }: {
  registry: DeployTargetRegistry; host: PublishProviderId; providerId: string;
}, _options = {}): DeployTargetCredentialSpec | undefined {
  const spec = registry.get(providerId)?.descriptor.credential;
  const previous = registry.get(host)?.descriptor.credential;
  if (!spec || !previous || spec.tokenField !== previous.tokenField) return undefined;
  // Token-only = the token is the only REQUIRED field; an optional extra (a host's add-on secret) may
  // be absent, so the retained envelope is still a valid connection for the destination.
  if (![spec, previous].every(candidate => candidate.fields.every(field => field.name === candidate.tokenField || !field.required))) return undefined;
  return spec;
}

function isProviderOnlyMove({ values, spec }: {
  values: Record<string, unknown>; spec: DeployTargetCredentialSpec;
}, _options = {}): boolean {
  return Object.keys(values).every(key => key === "providerId" || key === spec.tokenField) &&
    (values[spec.tokenField] === undefined || values[spec.tokenField] === "");
}

