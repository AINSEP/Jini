/**
 * @file The host's read-tool vocabulary: how model-facing domain-package text names the host's tool that reads
 * an entity back ("call X to list valid terms", "as returned by X").
 *
 * Why this is a port: the read tool is a host product's tool id (a host publishes its reads as one
 * family, and the engine may not name any host tool — `scripts/check-engine-boundaries.ts`'s
 * `HOST_TOOL_NAMES`). The package text therefore names an *entity* and the host says how it reads it;
 * a host that binds nothing gets neutral wording, so no tool id the host never registered reaches a
 * model. Same mechanism as the daemon's `ToolFamilyPort`: product names reach a model through a
 * host-supplied port, never through engine source.
 *
 * Architectural role: tool kit (with `model-facing-tool-errors`) — domain catalogs write `{{read:<entity>}}` placeholders
 * in static text and `resolveHostReadRefs` fills them when a domain's registrations are built.
 */

/** An entity whose read-back a domain's tool text points a model at, named by the domain (e.g. `redirect`, `seo_entry_meta`). */
export type HostReadEntity = string;

/** How the host names the tool call that reads an entity back. */
export interface HostReadVocabulary {
  /** The text a model should see for "read this entity", e.g. a host tool id. */
  readonly readRef: (required: { entity: HostReadEntity }, optional?: Record<string, never>) => string;
}

/** Wording for a host that binds no vocabulary: names the read, never a tool id. */
export const NEUTRAL_HOST_READ_VOCABULARY: HostReadVocabulary = {
  readRef: ({ entity }) => `the ${entity.replaceAll("_", " ")} read tool`,
};

/** The placeholder a static catalog text carries for `entity`. */
export function hostReadRef({ entity }: { entity: HostReadEntity }, _optional = {}): string {
  return `{{read:${entity}}}`;
}

const PLACEHOLDER = /\{\{read:([a-z_]+)\}\}/g;

/** Resolves every placeholder in `text` through `hostReads`; text without one is returned as is. */
export function resolveHostReadText(
  { text }: { text: string },
  { hostReads = NEUTRAL_HOST_READ_VOCABULARY }: { hostReads?: HostReadVocabulary | undefined } = {},
): string {
  return text.replace(PLACEHOLDER, (_whole, entity: string) => hostReads.readRef({ entity: entity as HostReadEntity }));
}

/**
 * Deep-copies `value` with every string resolved by {@link resolveHostReadText}. Used on a domain's
 * static catalog when its registrations are built; the input is never mutated.
 *
 * @complexity O(n) in the catalog's nodes.
 */
export function resolveHostReadRefs<T>({ value }: { value: T }, optional: { hostReads?: HostReadVocabulary | undefined } = {}): T {
  if (typeof value === "string") return resolveHostReadText({ text: value }, optional) as T;
  if (Array.isArray(value)) return value.map((item) => resolveHostReadRefs({ value: item }, optional)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveHostReadRefs({ value: item }, optional)])) as T;
  }
  return value;
}
