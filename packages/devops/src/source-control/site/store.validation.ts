import { CredentialInputError, normalizeCredentialToken } from "@jini-ai/platform/secrets/credential-token";
import type { SourceControlProviderId, SourceControlConnectionInput } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { UUID } from "@jini-ai/core/primitives";
import { SourceControlCredentialValidationError, type SourceControlCredentialWriteDeps, type SourceControlProviderDescriptor, type SourceControlProviderRegistry } from "./store.js";

const MAX_LABEL_LENGTH = 200;

/** Narrows and validates a caller-supplied `label`. Never throws a raw `TypeError` — every
 *  rejection is a {@link SourceControlCredentialValidationError} the route layer can map to its own
 *  `400`. */
export function validateLabel({ raw, assertCredentialFreeField }: { raw: unknown; assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"] }, _optional = {}): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SourceControlCredentialValidationError("label must be a non-empty string");
  }
  if (raw.length > MAX_LABEL_LENGTH) {
    throw new SourceControlCredentialValidationError(`label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  assertPlainField({ value: raw, field: "label", assertCredentialFreeField });
  return raw;
}

function requireNonEmptyString({ raw, field, providerId }: { raw: unknown; field: string; providerId: string }, _optional = {}): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SourceControlCredentialValidationError(`'${field}' (non-empty string) is required for provider '${providerId}'`);
  }
  return raw;
}

/** Narrows a caller-supplied `isDefault`. `undefined` means "no default change requested"; any
 *  other non-boolean value is rejected rather than coerced. */
export function optionalBoolean({ raw, field }: { raw: unknown; field: string }, _optional = {}): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw new SourceControlCredentialValidationError(`'${field}' must be a boolean when provided`);
  }
  return raw;
}

/** Blank/omitted canonical tokens preserve the envelope after connection-shape validation. */
export function isEmptyTokenPatch({ value }: { value: Record<string, unknown> }, _options = {}): boolean {
  const token = value.token;
  return token === '' || token === undefined;
}

/** Reject malformed connection shapes before either rotation or envelope preservation. */
function connectionObject({ raw }: { raw: unknown }, _options = {}): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SourceControlCredentialValidationError('connection must be an object');
  }
  return raw as Record<string, unknown>;
}

/** Forms and vault payloads use `token`; accept a declared form name at the store boundary too.
 * An explicitly supplied canonical value takes precedence, including blank/invalid values. */
function canonicalConnection({ value, descriptor }: { value: Record<string, unknown>; descriptor?: SourceControlProviderDescriptor }, _options = {}): Record<string, unknown> {
  if (value.token !== undefined) return value;
  const tokenField = descriptor?.credential?.tokenField ?? 'token';
  return { ...value, token: value[tokenField] };
}

/** Normalize alternate form names before deciding whether this is a rotation. Ordinary metadata
 * patches and canonical-token patches need no registry lookup, keeping opaque saved rows editable.
 * @complexity O(k) input keys plus at most one registry load for provider-specific fields. */
export async function normalizeConnectionPatch({ raw, existing, registry }: {
  raw: unknown; existing: SourceControlProviderId; registry: () => Promise<SourceControlProviderRegistry>;
}, _options = {}): Promise<Record<string, unknown> | undefined> {
  if (raw === undefined) return undefined;
  // A patch that leaves out the host keeps the saved one (a token-only rotation names no provider).
  const value = { ...connectionObject({ raw }) };
  value.providerId ??= existing;
  if (value.token !== undefined || Object.keys(value).every(key => key === 'providerId' || key === 'token')) return value;
  const loaded = await registry();
  const descriptor = typeof value.providerId === 'string' ? loaded.get({ providerId: value.providerId })?.descriptor : undefined;
  return canonicalConnection({ value, descriptor });
}

/** A blank token keeps the sealed envelope, and the envelope cannot be rewritten without the token,
 * so a blank patch carrying any other connection field is refused rather than dropping it silently.
 * The provider's declared token name is a blank token too. @complexity O(k) patch keys; the registry
 * loads only when the patch names a field besides `providerId`/`token`. */
export async function assertBlankPatchChangesNoField({ patch, registry }: {
  patch: Record<string, unknown> | undefined; registry: () => Promise<SourceControlProviderRegistry>;
}, _options = {}): Promise<void> {
  const named = Object.keys(patch ?? {}).filter(key => key !== 'providerId' && key !== 'token');
  if (named.length === 0) return;
  const providerId = typeof patch?.providerId === 'string' ? patch.providerId : '';
  const tokenField = (await registry()).get({ providerId })?.descriptor.credential?.tokenField;
  const changed = named.filter(key => key !== tokenField);
  if (changed.length > 0) throw new SourceControlCredentialValidationError(`changing ${changed.join(', ')} requires a new token`);
}
/** A token-only host can move without opening the secret. Entering a host with required
 * paired fields needs a new connection; an envelope-only move cannot invent those fields.
 * Saved, unlisted ids may keep their envelope and metadata without loading plugin code. */
export async function preservedProvider({ raw, existing, registry }: {
  raw: unknown; existing: SourceControlProviderId; registry: () => Promise<SourceControlProviderRegistry>;
}, _options = {}): Promise<SourceControlProviderId> {
  if (raw === undefined) return existing;
  const providerId = (raw as Record<string, unknown>).providerId;
  if (providerId === undefined || providerId === existing) return existing;
  const descriptor = requireProvider({ providerId, registry: await registry() });
  const credential = descriptor.credential;
  const paired = credential?.fields.find(field => field.required && field.name !== credential.tokenField);
  if (paired) throw new SourceControlCredentialValidationError(`moving to ${descriptor.id} requires a new token and ${paired.name}`);
  return descriptor.id;
}

/** Only loaded providers admit new connections; stored ids are never checked against this list. */
function requireProvider({ providerId, registry }: { providerId: unknown; registry: SourceControlProviderRegistry }, _options = {}): SourceControlProviderDescriptor {
  const loaded = typeof providerId === 'string' ? registry.get({ providerId }) : undefined;
  if (!loaded) throw new SourceControlCredentialValidationError(`connection.providerId must be one of: ${registry.list().map(provider => provider.descriptor.id).join(', ')}`);
  return loaded.descriptor;
}

/** Write-only callers without a provider port cannot introduce a new credential/provider. */
export async function credentialRegistry({ deps, workspaceId }: { deps: SourceControlCredentialWriteDeps; workspaceId: UUID }, _options = {}): Promise<SourceControlProviderRegistry> {
  if (!deps.loadSourceControlProviders) return { list: () => [], get: () => undefined, refusals: [] };
  return deps.loadSourceControlProviders({ workspaceId });
}

export function normalizeStoredToken({ value }: { value: unknown }): string {
  try { return normalizeCredentialToken({ value }); }
  catch (err) { if (err instanceof CredentialInputError) { throw new SourceControlCredentialValidationError(err.message); } throw err; }
}
export function assertPlainField(required: { value: string; field: string; assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"] }): void {
  try { required.assertCredentialFreeField(required); }
  catch (err) { if (err instanceof CredentialInputError) { throw new SourceControlCredentialValidationError(err.message); } throw err; }
}

/** Validate declared fields before sealing. Authentication pairs stay in one ciphertext blob.
 * Only declared fields are accepted on new writes; existing saved payloads remain opaque.
 * @complexity O(f) time/space, f bounded by the existing credential-form parser (10 fields). */
export function validateConnection({ raw, registry, assertCredentialFreeField }: { raw: unknown; registry: SourceControlProviderRegistry; assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"] }, _options = {}): SourceControlConnectionInput {
  const value = connectionObject({ raw });
  const descriptor = requireProvider({ providerId: value.providerId, registry });
  const canonical = canonicalConnection({ value, descriptor });
  const token = normalizeStoredToken({ value: canonical.token });
  return { ...collectDeclaredFields({ value, descriptor, assertCredentialFreeField }), providerId: descriptor.id, token };
}

/** Collect only the provider's additional declared fields; the primary secret is stored as `token`.
 * Authentication pairs stay in the same ciphertext blob. @complexity O(f) time/space, f <= 10. */
function collectDeclaredFields({ value, descriptor, assertCredentialFreeField }: { value: Record<string, unknown>; descriptor: SourceControlProviderDescriptor; assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"] }, _options = {}): Record<string, string> {
  const tokenField = descriptor.credential?.tokenField ?? 'token';
  const fields: Record<string, string> = {};
  for (const field of descriptor.credential?.fields ?? []) {
    if (field.name === tokenField) continue;
    const validated = validateDeclaredField({ value: value[field.name], field, providerId: descriptor.id, assertCredentialFreeField });
    if (validated !== undefined) fields[field.name] = validated;
  }
  return fields;
}

/** Non-secret metadata uses the existing credential-free admission check; secrets use token admission. */
function validateDeclaredField({ value, field, providerId, assertCredentialFreeField }: {
  assertCredentialFreeField: SourceControlCredentialWriteDeps["assertCredentialFreeField"];
  value: unknown; field: import('@jini-ai/devops/source-control/site/credential-form').SourceControlCredentialField; providerId: string;
}, _options = {}): string | undefined {
  if (value === undefined && !field.required) return undefined;
  const text = requireNonEmptyString({ raw: value, field: field.name, providerId });
  if (field.secret) return normalizeStoredToken({ value: text });
  assertPlainField({ value: text, field: field.name, assertCredentialFreeField });
  return text;
}

