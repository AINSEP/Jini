/**
 * Host-supplied attribution every signal of a provider carries (owner 2026-10-25: events must show
 * which site sent them, when several sites share one backend). Neutral by design: the HOST names the
 * keys and values (`attributes`), analytics groups (`groups`: group type → key) and trace tags; each
 * provider plugin only applies them in its vendor's terms (OTel resource attributes, PostHog event
 * properties + `$groups`, Langfuse trace metadata + tags). Factory input key: `attribution`.
 */
export interface ProviderAttribution {
  readonly attributes: Readonly<Record<string, string>>;
  readonly groups: Readonly<Record<string, string>>;
  readonly tags: readonly string[];
}

const EMPTY: ProviderAttribution = Object.freeze({ attributes: Object.freeze({}), groups: Object.freeze({}), tags: Object.freeze([]) });

function stringMap(value: unknown, name: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`attribution.${name} must be an object of strings`);
  }
  return { ...(value as Record<string, string>) };
}

/**
 * Reads the factory's `attribution` input. Absent → empty (no attribution); malformed → TypeError.
 * @complexity O(n) in the attribution's entries.
 */
export function attributionOf(value: unknown): ProviderAttribution {
  if (value === undefined) return EMPTY;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('attribution must be an object');
  const { attributes, groups, tags } = value as Record<string, unknown>;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) throw new TypeError('attribution.tags must be a list of strings');
  return { attributes: stringMap(attributes, 'attributes'), groups: stringMap(groups, 'groups'), tags: [...(tags as string[] | undefined ?? [])] };
}
