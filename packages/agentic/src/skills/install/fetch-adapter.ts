import type { SkillFetchPort } from './ports.js';

/** Wrap an explicitly supplied native fetch without adding transport defaults or changing responses. */
export function createSkillFetchAdapter(
  required: { fetch: typeof fetch },
  _optional: Record<string, never> = {},
): SkillFetchPort {
  const fetchImpl = required.fetch;
  return ({ url }, optional = {}) => fetchImpl(url, optional);
}
