/**
 * Origin: `SkillsSection.tsx` (994 lines) plus `SkillDetailsModal.tsx`, and the
 * `SkillSummary` contract they render (`packages/contracts/src/api/registry.ts`).
 *
 * What is generic and ported: a skill has an id, a name, a description, trigger
 * phrases, a mode, an origin (shipped vs. authored here), and optional
 * category/localization metadata. Filtering, searching, and draft editing over
 * that shape are the tab's real work and none of it is product-bound.
 *
 * What is deliberately NOT ported: the origin's fixed `mode` union
 * (`'prototype' | 'deck' | 'template' | 'design-system' | ...`) and its
 * `surface`/`platform`/`scenario` fields. Those name that product's own output
 * kinds — a "deck" or a "design-system" is not a concept every host has. `mode`
 * is a plain string here and the host supplies whatever vocabulary it uses,
 * exactly as `ProviderPreset` lets a host supply its own endpoint catalog.
 */

/** Where a skill came from. `'built-in'` ships with the host; `'user'` was
 *  authored locally. Other values are allowed because a host may have more
 *  origins (an org registry, a marketplace) — the filter row only ever offers
 *  the two it knows, and counts the rest under "all". */
export type SkillSource = 'user' | 'built-in' | (string & {});

/** One skill as the list renders it. */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  /** Phrases that activate the skill. */
  triggers?: readonly string[];
  /** Free-form kind, host-defined — see this file's header. */
  mode: string;
  source: SkillSource;
  /** Optional grouping slug. The category filter row renders only when at
   *  least one listed skill carries one, so a host with none sees no empty
   *  row rather than a dead control. */
  category?: string | null;
  /** Locale-keyed display name / description, when the host localizes its
   *  catalog. Absent means "use `name`/`description` as written". */
  displayName?: Readonly<Record<string, string>>;
  descriptionI18n?: Readonly<Record<string, string>>;
}

/** One entry in a skill's file tree. */
export interface SkillFileEntry {
  path: string;
  kind: 'file' | 'directory';
  /** `null` for directories, and for hosts that do not report sizes. */
  size: number | null;
}

/** A skill plus the body text the list does not carry. Fetched lazily per row
 *  so the initial listing payload stays small. */
export interface SkillDetail extends SkillSummary {
  body: string;
}

/** The origin filter. `'all'` disables the filter rather than naming a
 *  source, which is why it is part of this type and not a separate flag. */
export type SourceFilter = 'all' | 'user' | 'built-in';

/** The editable fields of a skill, as strings — `triggers` is the raw comma/
 *  newline-separated text the operator typed, not a parsed array, so a
 *  half-typed entry survives a re-render. `parseTriggers` converts on save. */
export interface SkillDraft {
  name: string;
  description: string;
  triggers: string;
  body: string;
}

/** Everything narrowing the visible list. Grouped into one object so the pure
 *  filter/count helpers take a single argument instead of four positional
 *  ones that are easy to transpose. */
export interface SkillFilters {
  search: string;
  source: SourceFilter;
  /** `'all'` disables the filter. */
  mode: string;
  /** `'all'` disables the filter. */
  category: string;
}

/** A filter option and how many skills it would leave visible. Counts are
 *  computed with that option's OWN dimension excluded, so a pill always shows
 *  what picking it would yield rather than what is showing now. */
export type SkillFilterOption = readonly [value: string, count: number];

/**
 * Why the create/edit form can't submit right now, if at all. The client-side
 * checks (`validateSkillDraft`'s two cases) and a failed
 * `SkillsPort.createSkill`/`updateSkill` call collapse into one shape here —
 * same idiom as `ConnectionTestState` in the execution tab (§3.2 of this
 * package's error-reporting contract): reuse the "async edge result" shape
 * rather than a separate validation-error type plus a separate raw-message
 * string.
 */
export type SkillDraftError =
  | { kind: 'name-required' }
  | { kind: 'body-required' }
  | { kind: 'submit-failed'; message: string };
