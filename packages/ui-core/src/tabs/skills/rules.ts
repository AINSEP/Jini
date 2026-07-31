/**
 * Origin: the `useMemo` block of `SkillsSection.tsx` (lines ~146-240) plus its
 * three module-level helpers (`summaryToDraft`, `parseTriggers`,
 * `skillMatchesSearch`). All of it is pure derivation over a skill list — no
 * React, no I/O — so it belongs here rather than in the component.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE ORIGIN, called out because a reviewer
 * diffing the two will notice it immediately: the origin repeats the same
 * "does this skill match every active filter EXCEPT my own dimension"
 * predicate six times, once inline per `useMemo` (`sourceCounts`,
 * `modeOptions`, `modeAllCount`, `categoryOptions`, `categoryAllCount`,
 * `filteredSkills`). Those six copies are not identical by accident — they are
 * identical by intent, and they had already drifted in one respect: the
 * category memos skip skills with no category before counting, while the mode
 * memos do not. Here it is ONE parameterised predicate
 * (`skillMatchesFilters` + its `except` option), which is why this file is
 * shorter than the region it replaces while covering the same cases.
 *
 * Why counts exclude their own dimension: a filter pill should say what
 * picking it WOULD yield, not what is showing now. Counting "mode" pills with
 * the mode filter still applied would show 0 on every unselected pill, which
 * reads as "empty" when it means "not currently selected".
 */

import type {
  SkillDraft,
  SkillFilterOption,
  SkillFilters,
  SkillSummary,
  SourceFilter,
} from './types.js';

/** The blank draft a "create new skill" form starts from. */
export const EMPTY_SKILL_DRAFT: SkillDraft = {
  name: '',
  description: '',
  triggers: '',
  body: '',
};

/** The two origins the source filter offers explicitly. A host may report
 *  others (an org registry, a marketplace); those are counted under `all` and
 *  get no pill of their own, matching the origin's behaviour. */
const KNOWN_SOURCES: readonly SourceFilter[] = ['all', 'user', 'built-in'];

/**
 * The skill's name in `locale`, falling back to the untranslated `name`.
 *
 * A host that does not localize its catalog omits `displayName` entirely, so
 * the fallback is the normal path rather than an error case.
 */
export function localizedSkillName(skill: SkillSummary, locale: string): string {
  return skill.displayName?.[locale] ?? skill.name;
}

/** The skill's description in `locale`, falling back to the untranslated one. */
export function localizedSkillDescription(skill: SkillSummary, locale: string): string {
  return skill.descriptionI18n?.[locale] ?? skill.description;
}

/**
 * Whether `skill` matches the free-text `query`.
 *
 * Searches the untranslated name AND the localized one, the untranslated
 * description AND the localized one, every trigger phrase, and the category —
 * so an operator can find a skill by what their UI calls it or by what its
 * files call it.
 *
 * `query` is normalised (trimmed and lowercased) INSIDE this function. The
 * origin required callers to pre-lowercase it and silently returned nothing
 * for a capitalised query if they forgot; every call site there did the
 * normalisation separately. An empty or whitespace-only query matches
 * everything, which is what makes an untouched search box a no-op.
 */
export function skillMatchesSearch(skill: SkillSummary, query: string, locale: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    skill.name,
    localizedSkillName(skill, locale),
    skill.description,
    localizedSkillDescription(skill, locale),
    (skill.triggers ?? []).join(' '),
    skill.category ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Which filter dimension a count is being computed FOR, and therefore which
 *  one to ignore while computing it. */
export type SkillFilterDimension = 'source' | 'mode' | 'category';

/**
 * Whether `skill` survives every active filter, optionally ignoring one
 * dimension.
 *
 * `except` is what makes the filter-pill counts correct — see this file's
 * header. Omit it and this is the plain "is this row visible" predicate.
 */
export function skillMatchesFilters(
  skill: SkillSummary,
  filters: SkillFilters,
  locale: string,
  except?: SkillFilterDimension,
): boolean {
  if (except !== 'source' && filters.source !== 'all' && skill.source !== filters.source) return false;
  if (except !== 'mode' && filters.mode !== 'all' && skill.mode !== filters.mode) return false;
  if (except !== 'category' && filters.category !== 'all' && skill.category !== filters.category) {
    return false;
  }
  return skillMatchesSearch(skill, filters.search, locale);
}

/** The rows the list should render. */
export function filterSkills(
  skills: readonly SkillSummary[],
  filters: SkillFilters,
  locale: string,
): SkillSummary[] {
  return skills.filter((skill) => skillMatchesFilters(skill, filters, locale));
}

/**
 * The pills for one filter dimension, plus the count its "all" pill shows.
 *
 * Replaces five of the origin's six memos. Two properties are preserved from
 * it deliberately:
 *
 * - **The option SET comes from every skill, the COUNTS from the filtered
 *   ones.** So an option can legitimately show 0 — it stays visible, telling
 *   the operator the value exists but is excluded by their other filters.
 *   Dropping zero-count options would make pills appear and vanish as filters
 *   change, which is worse.
 * - **`source` always offers its two known pills**, even when no skill has
 *   that origin, because they are a fixed vocabulary rather than data-derived.
 *   Unknown origins a host may report are counted in `all` but get no pill.
 *
 * Options are sorted by value (`localeCompare`) so the row is stable across
 * renders rather than reflecting list order.
 */
export function skillFilterOptions(
  skills: readonly SkillSummary[],
  filters: SkillFilters,
  locale: string,
  dimension: SkillFilterDimension,
): { all: number; options: SkillFilterOption[] } {
  const matching = skills.filter((skill) => skillMatchesFilters(skill, filters, locale, dimension));

  if (dimension === 'source') {
    const counts = new Map<string, number>(KNOWN_SOURCES.filter((s) => s !== 'all').map((s) => [s, 0]));
    for (const skill of matching) {
      // `undefined` means an origin outside the known vocabulary (an org
      // registry, a marketplace). Those are counted in `all` and get no pill.
      // One lookup, not a `has` + `get` pair with an unreachable `?? 0`.
      const current = counts.get(skill.source);
      if (current !== undefined) counts.set(skill.source, current + 1);
    }
    return {
      all: matching.length,
      options: [...counts.entries()]
        .map(([value, count]) => [value, count] as SkillFilterOption)
        .sort((a, b) => a[0].localeCompare(b[0])),
    };
  }

  // `mode` is required on every skill; `category` is optional, so a skill
  // without one contributes to `all` but to no pill.
  const valueOf = (skill: SkillSummary): string | null =>
    dimension === 'mode' ? skill.mode : typeof skill.category === 'string' && skill.category ? skill.category : null;

  const values = new Set<string>();
  for (const skill of skills) {
    const value = valueOf(skill);
    if (value !== null) values.add(value);
  }

  const counts = new Map<string, number>();
  for (const skill of matching) {
    const value = valueOf(skill);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return {
    all: matching.length,
    options: [...values]
      .map((value) => [value, counts.get(value) ?? 0] as SkillFilterOption)
      .sort((a, b) => a[0].localeCompare(b[0])),
  };
}

/**
 * Whether the category filter row should render at all.
 *
 * Categories are optional per-skill metadata. A host shipping only
 * uncategorised skills should see no row rather than a row with nothing but
 * an "all" pill — the origin's own note calls this out.
 */
export function hasAnyCategory(skills: readonly SkillSummary[]): boolean {
  return skills.some((skill) => typeof skill.category === 'string' && skill.category.length > 0);
}

/**
 * Splits the raw triggers textarea into phrases.
 *
 * Comma OR newline separated, trimmed, blanks dropped — so trailing
 * separators and a stray blank line while typing don't produce empty
 * triggers. The draft keeps the RAW text (see `SkillDraft.triggers`); this
 * runs at save time, which is why a half-typed entry survives re-renders.
 */
export function parseTriggers(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((trigger) => trigger.trim())
    .filter(Boolean);
}

/**
 * Seeds the edit form from an existing skill plus its lazily-fetched body.
 *
 * `triggers` is joined back to comma-separated text because the form edits the
 * raw string, not the array. The `Array.isArray` guard is kept from the origin:
 * `triggers` is optional in the contract and a host can return `null` for it,
 * which `.join` would throw on.
 */
export function summaryToDraft(skill: SkillSummary, body: string): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    triggers: Array.isArray(skill.triggers) ? skill.triggers.join(', ') : '',
    body,
  };
}
