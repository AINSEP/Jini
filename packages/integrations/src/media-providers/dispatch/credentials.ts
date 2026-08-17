/**
 * An opt-in reference credential resolver — reads a provider's API key
 * from the first set environment variable in `PROVIDER_CREDENTIAL_ENV_VARS`
 * priority order. The dispatch engine itself never reads `process.env`
 * (see `types.ts`'s `MediaDispatchEngineOptions.credentials` doc); a host
 * that's fine with plain env-var credentials can use this to build that
 * map instead of writing its own resolver. A host with its own secrets
 * layer (a config file, a vault, a project-scoped override var) should
 * build the credentials map itself instead of using this.
 */
import { PROVIDER_CREDENTIAL_ENV_VARS } from '../providers.js';
import type { ProviderCredentials } from './types.js';

/** Resolves `{ apiKey }` for `providerId` from the first set environment variable in its priority list, or `{}` if none are set / the provider has no known env vars. */
export function resolveProviderCredentialsFromEnv(providerId: string, env: NodeJS.ProcessEnv = process.env): ProviderCredentials {
  const candidates = PROVIDER_CREDENTIAL_ENV_VARS[providerId];
  if (!candidates) return {};
  for (const name of candidates) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) {
      return { apiKey: value.trim() };
    }
  }
  return {};
}
