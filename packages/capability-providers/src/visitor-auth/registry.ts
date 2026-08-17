import type { VisitorAuthProviderDefinition } from './definitions.js';

export type VisitorAuthRegistryErrorCode =
  | 'invalid-provider'
  | 'duplicate-provider';

export class VisitorAuthRegistryError extends Error {
  readonly code: VisitorAuthRegistryErrorCode;

  constructor(code: VisitorAuthRegistryErrorCode, message: string) {
    super(message);
    this.name = 'VisitorAuthRegistryError';
    this.code = code;
  }
}

export interface VisitorAuthProviderRegistry {
  register(definition: VisitorAuthProviderDefinition): void;
  get(providerId: string): VisitorAuthProviderDefinition | undefined;
  has(providerId: string): boolean;
  list(): readonly VisitorAuthProviderDefinition[];
}

function validatedCopy(
  definition: VisitorAuthProviderDefinition,
): VisitorAuthProviderDefinition {
  const id = definition.id.trim();
  const label = definition.label.trim();
  if (!id || !label || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new VisitorAuthRegistryError(
      'invalid-provider',
      'visitor-auth provider id and label must be non-empty, and id must be URL-safe',
    );
  }
  if (definition.credentialSchema.length === 0) {
    throw new VisitorAuthRegistryError(
      'invalid-provider',
      `visitor-auth provider "${id}" must declare at least one credential field`,
    );
  }

  const credentialKeys = new Set<string>();
  const credentialSchema = definition.credentialSchema.map((field) => {
    const key = field.key.trim();
    const fieldLabel = field.label.trim();
    if (!key || !fieldLabel || credentialKeys.has(key)) {
      throw new VisitorAuthRegistryError(
        'invalid-provider',
        `visitor-auth provider "${id}" has an invalid or duplicate credential field`,
      );
    }
    credentialKeys.add(key);
    return Object.freeze({ ...field, key, label: fieldLabel });
  });

  const scopes = definition.defaultScopes.map((scope) => scope.trim());
  if (scopes.some((scope) => !scope) || new Set(scopes).size !== scopes.length) {
    throw new VisitorAuthRegistryError(
      'invalid-provider',
      `visitor-auth provider "${id}" has an invalid or duplicate default scope`,
    );
  }

  return Object.freeze({
    ...definition,
    id,
    label,
    credentialSchema: Object.freeze(credentialSchema),
    defaultScopes: Object.freeze(scopes),
  });
}

/**
 * Creates an independent, append-only provider-definition registry.
 *
 * The registry stores defensive immutable copies. It intentionally carries no
 * OAuth handlers or credentials: a host cannot obtain executable authority by
 * enumerating provider metadata.
 *
 * @param required - Optional provider definitions to validate and register in order.
 * @returns A fresh registry with no shared mutable state.
 * @throws {VisitorAuthRegistryError} When a definition is malformed or duplicates an id.
 * @complexity Time: O(p * (f + s)); space: O(p * (f + s)), where p is providers,
 * f is credential fields, and s is scopes.
 */
export function createVisitorAuthProviderRegistry(
  required: { readonly seed?: readonly VisitorAuthProviderDefinition[] } = {},
): VisitorAuthProviderRegistry {
  const providers = new Map<string, VisitorAuthProviderDefinition>();

  const registry: VisitorAuthProviderRegistry = {
    register(definition): void {
      const copy = validatedCopy(definition);
      if (providers.has(copy.id)) {
        throw new VisitorAuthRegistryError(
          'duplicate-provider',
          `visitor-auth provider "${copy.id}" is already registered`,
        );
      }
      providers.set(copy.id, copy);
    },
    get(providerId): VisitorAuthProviderDefinition | undefined {
      return providers.get(providerId);
    },
    has(providerId): boolean {
      return providers.has(providerId);
    },
    list(): readonly VisitorAuthProviderDefinition[] {
      return Object.freeze(Array.from(providers.values()));
    },
  };

  for (const definition of required.seed ?? []) {
    registry.register(definition);
  }
  return registry;
}
