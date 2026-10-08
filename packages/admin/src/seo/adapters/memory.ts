import type { AdminSeoPort } from '../ports.js';
import type { SeoEntryMeta, SeoEntryAnalysis, SeoEntryOverridesPatch, SeoSettings, SeoSettingsPatch, AdminPost } from '../models.js';
export interface SeoEntrySeed { meta: SeoEntryMeta; analysis: SeoEntryAnalysis }
export interface MemorySeoOptions { settings?: SeoSettings; entries?: Record<string, SeoEntrySeed>; posts?: readonly AdminPost[]; pages?: readonly AdminPost[]; sitemapText?: string; sitemapError?: string; mediaOriginalUrl?: (required: { id: string }, optional?: Record<string, never>) => string }
const defaultSettings = (): SeoSettings => ({ titleTemplate: '%s', defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [] });
const clone = <T>(value: T): T => structuredClone(value);
/** `patch value ?? meta value`, named — {@link applySeoPatch} calls this once per field instead of
 *  inlining `??` at each of its 13 fields: a plain function call isn't a decision point the way an
 *  inline `??` is, so this is what keeps that merge under the complexity ceiling (same fix this
 *  codebase's `orEmpty` established elsewhere for the same class of violation — a flat run of
 *  independent fallbacks, not real branching logic).
 *
 *  `null` (the patch's CLEAR sentinel) falls through to the meta value by the same `??`, which is
 *  the right model for this fake: the server drops the override and re-resolves, and the seeded
 *  `meta` is the closest thing this fake has to that resolved value. It is only an approximation —
 *  a test that needs to prove a clear actually reached the wire must assert on the PUT body, not on
 *  what comes back. */
function orMeta<T>(patchValue: T | null | undefined, metaValue: T): T {
  return patchValue ?? metaValue;
}

/** Applies a {@link SeoEntryOverridesPatch} onto a resolved {@link SeoEntryMeta} — only the fields
 *  a fake's own tests plausibly touch are merged (title/description/canonical directly, robots and
 *  the OG/Twitter card objects field-by-field); this mirrors the server's `SeoExtFields` -> `SeoMeta`
 *  merge closely enough for hook-level tests without re-implementing the real resolution rules. */
// Optional read fields are absent when unresolved; write-only null never reaches the read shape.
function optionalString<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : { [key]: value } as Record<K, string>;
}

function applySeoPatch(meta: SeoEntryMeta, patch: SeoEntryOverridesPatch): SeoEntryMeta {
  return {
    ...meta,
    title: orMeta(patch.title, meta.title),
    ...optionalString('description', orMeta(patch.description, meta.description)),
    canonical: orMeta(patch.canonical, meta.canonical),
    robots: {
      noindex: orMeta(patch.noindex, meta.robots.noindex),
      nofollow: orMeta(patch.nofollow, meta.robots.nofollow),
    },
    openGraph: {
      ...meta.openGraph,
      title: orMeta(patch.ogTitle, meta.openGraph.title),
      ...optionalString('description', orMeta(patch.ogDescription, meta.openGraph.description)),
      ...optionalString('image', orMeta(patch.ogImage, meta.openGraph.image)),
      type: orMeta(patch.ogType, meta.openGraph.type),
    },
    twitter: {
      ...meta.twitter,
      card: orMeta(patch.twitterCard, meta.twitter.card),
      title: orMeta(patch.twitterTitle, meta.twitter.title),
      ...optionalString('description', orMeta(patch.twitterDescription, meta.twitter.description)),
      ...optionalString('image', orMeta(patch.twitterImage, meta.twitter.image)),
    },
  };
}

/** One of the three site-wide scalars the server registers as `nullable: true` (`SEO_DEFINITIONS`,
 *  `apps/website/src/features/seo/settings.ts`), under the real write's own rule: an omitted key
 *  (`undefined`) keeps the current value, `null` clears it, and a string overwrites. */
function settingOrCleared(patchValue: string | null | undefined, currentValue: string | undefined): string | undefined {
  if (patchValue === undefined) return currentValue;
  return patchValue ?? undefined;
}

/** Applies a {@link SeoSettingsPatch} the way the real `setSeoSettings` does: an omitted key leaves
 *  the current value alone (it is a MERGE — `buildScalarWrites` skips every `undefined`), and a
 *  `null` on one of the three nullable scalars clears it back to absent, which `getSeoSettings`
 *  reads back as `undefined` (via its `undefinedIfEmpty`). Naming those three explicitly rather
 *  than spreading the patch verbatim is what stops a `null` from surviving into a `SeoSettings`
 *  the fake hands back — no real response can contain one.
 *
 *  @complexity O(1) — three fixed field reads, no iteration. */
function applySettingsPatch(current: SeoSettings, patch: SeoSettingsPatch): SeoSettings {
  const { defaultDescription, defaultOgImage, twitterSite, ...rest } = patch;
  const { defaultDescription: _description, defaultOgImage: _image, twitterSite: _site, ...retained } = current;
  return {
    ...retained,
    ...rest,
    ...optionalString('defaultDescription', settingOrCleared(defaultDescription, current.defaultDescription)),
    ...optionalString('defaultOgImage', settingOrCleared(defaultOgImage, current.defaultOgImage)),
    ...optionalString('twitterSite', settingOrCleared(twitterSite, current.twitterSite)),
  };
}


/** Isolated memory backend with seeded effective defaults; never implements a CMS repository.
 * Clears resolve back to the seed, and prior returned snapshots never change on subsequent writes.
 * A host with richer content derivation can supply resolveEntry rather than fork the adapter. */
export function createMemorySeoApi(
  required: MemorySeoOptions = {},
  { resolveEntry }: { resolveEntry?: (required: { entryId: string; base: SeoEntryMeta; overrides: SeoEntryOverridesPatch }, optional?: Record<string, never>) => SeoEntryMeta } = {},
): AdminSeoPort {
  let settings = clone(required.settings ?? defaultSettings());
  const entries = clone(required.entries ?? {});
  const posts = clone(required.posts ?? []);
  const pages = clone(required.pages ?? []);
  const overrides: Record<string, SeoEntryOverridesPatch> = {};
  const lookup = (entryId: string): SeoEntrySeed => {
    const found = entries[entryId];
    if (!found) throw new Error(`fake seo port: unknown entry ${entryId}`);
    return found;
  };
  const resolved = (entryId: string): SeoEntryMeta => {
    const base = lookup(entryId).meta;
    const patch = overrides[entryId] ?? {};
    return resolveEntry ? resolveEntry({ entryId, base: clone(base), overrides: clone(patch) }) : applySeoPatch(base, patch);
  };
  return {
    async getSeoSettings() { return clone(settings); },
    async putSeoSettings(_required, patch = {}) { settings = applySettingsPatch(settings, patch); return clone(settings); },
    async regenerateSeoSitemap() { return { accepted: true }; },
    async getSeoEntry({ entryId }) { return clone(resolved(entryId)); },
    async putSeoEntry({ entryId }, patch = {}) {
      lookup(entryId);
      const current = { ...overrides[entryId] };
      // O(k) in patch keys; null removes only touched overrides, omission preserves other edits.
      for (const key of Object.keys(patch) as (keyof SeoEntryOverridesPatch)[]) {
        const value = patch[key];
        if (value === null) delete current[key];
        else if (value !== undefined) Object.assign(current, { [key]: value });
      }
      overrides[entryId] = current;
      return clone(resolved(entryId));
    },
    async analyzeSeoEntry({ entryId }) { return clone(lookup(entryId).analysis); },
    async listSeoPosts() { return clone(posts); },
    async listSeoPages() { return clone(pages); },
    async fetchSitemapXml(_required, { signal } = {}) {
      signal?.throwIfAborted();
      if (required.sitemapError !== undefined) throw new Error(required.sitemapError);
      return { text: required.sitemapText ?? '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n' };
    },
    mediaOriginalUrl({ id }) { return required.mediaOriginalUrl?.({ id }) ?? `memory://media/${encodeURIComponent(id)}/original`; },
  };
}
