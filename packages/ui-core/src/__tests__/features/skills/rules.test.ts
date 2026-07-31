import { describe, expect, it } from 'vitest';

// Imported through the BARREL, not the module, on purpose: it exercises the
// public surface a consumer actually sees, so a symbol missing from
// `index.ts` fails here rather than at some host's build.
import {
  EMPTY_SKILL_DRAFT,
  filterSkills,
  hasAnyCategory,
  localizedSkillDescription,
  localizedSkillName,
  parseTriggers,
  skillFilterOptions,
  skillMatchesFilters,
  skillMatchesSearch,
  summaryToDraft,
} from '../../../features/skills/index.js';
import type { SkillFilters, SkillSummary } from '../../../features/skills/index.js';

/**
 * These assert BEHAVIOUR, not line execution — each case is written so that a
 * subtly wrong implementation fails it. The count tests in particular pin the
 * "exclude your own dimension" rule, which is the single easiest thing to get
 * backwards and the reason the origin needed six near-duplicate blocks.
 */

function skill(over: Partial<SkillSummary> & Pick<SkillSummary, 'id'>): SkillSummary {
  return {
    name: `name-${over.id}`,
    description: `description-${over.id}`,
    mode: 'prototype',
    source: 'user',
    ...over,
  };
}

const NO_FILTERS: SkillFilters = { search: '', source: 'all', mode: 'all', category: 'all' };

describe('localizedSkillName / localizedSkillDescription', () => {
  it('prefers the locale entry when the host localizes', () => {
    const s = skill({ id: 'a', name: 'Wireframe', displayName: { fr: 'Filaire', de: 'Drahtmodell' } });
    expect(localizedSkillName(s, 'fr')).toBe('Filaire');
    expect(localizedSkillName(s, 'de')).toBe('Drahtmodell');
  });

  it('falls back to the untranslated value for an unlisted locale', () => {
    const s = skill({ id: 'a', name: 'Wireframe', displayName: { fr: 'Filaire' } });
    expect(localizedSkillName(s, 'ja')).toBe('Wireframe');
  });

  it('falls back when the host does not localize at all', () => {
    const s = skill({ id: 'a', name: 'Wireframe', description: 'Draws boxes' });
    expect(localizedSkillName(s, 'fr')).toBe('Wireframe');
    expect(localizedSkillDescription(s, 'fr')).toBe('Draws boxes');
  });

  it('localizes description independently of name', () => {
    const s = skill({ id: 'a', description: 'Draws boxes', descriptionI18n: { fr: 'Dessine' } });
    expect(localizedSkillDescription(s, 'fr')).toBe('Dessine');
  });
});

describe('skillMatchesSearch', () => {
  const s = skill({
    id: 'a',
    name: 'Wireframe',
    description: 'Draws boxes',
    triggers: ['sketch it', 'rough layout'],
    category: 'design',
    displayName: { fr: 'Filaire' },
    descriptionI18n: { fr: 'Dessine des boites' },
  });

  it('matches everything for an empty or whitespace-only query', () => {
    expect(skillMatchesSearch(s, '', 'en')).toBe(true);
    expect(skillMatchesSearch(s, '   ', 'en')).toBe(true);
  });

  it('normalises the query itself rather than requiring a pre-lowercased one', () => {
    // The origin required callers to pre-lowercase and silently missed otherwise.
    expect(skillMatchesSearch(s, 'WIREFRAME', 'en')).toBe(true);
    expect(skillMatchesSearch(s, '  Wireframe  ', 'en')).toBe(true);
  });

  it('searches the untranslated name even while a locale is active', () => {
    expect(skillMatchesSearch(s, 'wireframe', 'fr')).toBe(true);
  });

  it('searches the localized name for the active locale', () => {
    expect(skillMatchesSearch(s, 'filaire', 'fr')).toBe(true);
  });

  it('does not match a localization for a different locale', () => {
    const other = skill({ id: 'b', name: 'Zed', displayName: { fr: 'Filaire' } });
    expect(skillMatchesSearch(other, 'filaire', 'de')).toBe(false);
  });

  it('searches description, localized description, triggers and category', () => {
    expect(skillMatchesSearch(s, 'draws', 'en')).toBe(true);
    expect(skillMatchesSearch(s, 'dessine', 'fr')).toBe(true);
    expect(skillMatchesSearch(s, 'rough layout', 'en')).toBe(true);
    expect(skillMatchesSearch(s, 'design', 'en')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(skillMatchesSearch(s, 'kubernetes', 'en')).toBe(false);
  });

  it('handles a skill with no triggers and no category', () => {
    const bare = skill({ id: 'c', name: 'Bare' });
    expect(skillMatchesSearch(bare, 'bare', 'en')).toBe(true);
    expect(skillMatchesSearch(bare, 'nope', 'en')).toBe(false);
  });

  it('does not let one skill\'s fields bleed across the joiner', () => {
    // Fields are newline-joined; a query spanning two fields must not match.
    const s2 = skill({ id: 'd', name: 'alpha', description: 'beta' });
    expect(skillMatchesSearch(s2, 'alphabeta', 'en')).toBe(false);
  });
});

describe('skillMatchesFilters', () => {
  const s = skill({ id: 'a', mode: 'deck', source: 'built-in', category: 'design' });

  it('passes when every filter is "all"', () => {
    expect(skillMatchesFilters(s, NO_FILTERS, 'en')).toBe(true);
  });

  it('rejects on a mismatched source, mode, or category', () => {
    expect(skillMatchesFilters(s, { ...NO_FILTERS, source: 'user' }, 'en')).toBe(false);
    expect(skillMatchesFilters(s, { ...NO_FILTERS, mode: 'prototype' }, 'en')).toBe(false);
    expect(skillMatchesFilters(s, { ...NO_FILTERS, category: 'ops' }, 'en')).toBe(false);
  });

  it('accepts on a matching source, mode, and category', () => {
    expect(
      skillMatchesFilters(s, { search: '', source: 'built-in', mode: 'deck', category: 'design' }, 'en'),
    ).toBe(true);
  });

  it('ignores exactly the excepted dimension and no other', () => {
    const mismatched = { ...NO_FILTERS, source: 'user' as const, mode: 'prototype' };
    // Excepting source is not enough — mode still mismatches.
    expect(skillMatchesFilters(s, mismatched, 'en', 'source')).toBe(false);
    // Excepting mode is not enough — source still mismatches.
    expect(skillMatchesFilters(s, mismatched, 'en', 'mode')).toBe(false);
    // Excepting source with only source mismatched does pass.
    expect(skillMatchesFilters(s, { ...NO_FILTERS, source: 'user' }, 'en', 'source')).toBe(true);
    expect(skillMatchesFilters(s, { ...NO_FILTERS, category: 'ops' }, 'en', 'category')).toBe(true);
  });

  it('never excepts the search filter', () => {
    const filters = { ...NO_FILTERS, search: 'kubernetes' };
    expect(skillMatchesFilters(s, filters, 'en', 'source')).toBe(false);
    expect(skillMatchesFilters(s, filters, 'en', 'mode')).toBe(false);
    expect(skillMatchesFilters(s, filters, 'en', 'category')).toBe(false);
  });
});

describe('filterSkills', () => {
  const skills = [
    skill({ id: 'a', mode: 'deck', source: 'user', category: 'design' }),
    skill({ id: 'b', mode: 'deck', source: 'built-in', category: 'ops' }),
    skill({ id: 'c', mode: 'template', source: 'user' }),
  ];

  it('returns everything when unfiltered', () => {
    expect(filterSkills(skills, NO_FILTERS, 'en').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies filters conjunctively', () => {
    expect(filterSkills(skills, { ...NO_FILTERS, mode: 'deck', source: 'user' }, 'en').map((s) => s.id)).toEqual(['a']);
  });

  it('preserves input order', () => {
    expect(filterSkills(skills, { ...NO_FILTERS, source: 'user' }, 'en').map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('can return empty', () => {
    expect(filterSkills(skills, { ...NO_FILTERS, mode: 'nonexistent' }, 'en')).toEqual([]);
  });
});

describe('skillFilterOptions', () => {
  const skills = [
    skill({ id: 'a', mode: 'deck', source: 'user', category: 'design' }),
    skill({ id: 'b', mode: 'deck', source: 'built-in', category: 'ops' }),
    skill({ id: 'c', mode: 'template', source: 'user', category: 'design' }),
    skill({ id: 'd', mode: 'template', source: 'user' }),
  ];

  it('counts source pills with the source filter itself ignored', () => {
    // With source=built-in active, the pills must still show what picking
    // each source WOULD yield — not 0 for every unselected one.
    const { all, options } = skillFilterOptions(skills, { ...NO_FILTERS, source: 'built-in' }, 'en', 'source');
    expect(all).toBe(4);
    expect(options).toEqual([
      ['built-in', 1],
      ['user', 3],
    ]);
  });

  it('still narrows source counts by the OTHER active filters', () => {
    const { all, options } = skillFilterOptions(skills, { ...NO_FILTERS, mode: 'deck' }, 'en', 'source');
    expect(all).toBe(2);
    expect(options).toEqual([
      ['built-in', 1],
      ['user', 1],
    ]);
  });

  it('always offers both known source pills even at zero', () => {
    const onlyUser = [skill({ id: 'x', source: 'user' })];
    const { options } = skillFilterOptions(onlyUser, NO_FILTERS, 'en', 'source');
    expect(options).toEqual([
      ['built-in', 0],
      ['user', 1],
    ]);
  });

  it('counts an unknown source under all, but gives it no pill', () => {
    const withOrg = [...skills, skill({ id: 'e', source: 'org-registry' })];
    const { all, options } = skillFilterOptions(withOrg, NO_FILTERS, 'en', 'source');
    expect(all).toBe(5);
    expect(options.map(([value]) => value)).toEqual(['built-in', 'user']);
  });

  it('counts mode pills with the mode filter itself ignored', () => {
    const { all, options } = skillFilterOptions(skills, { ...NO_FILTERS, mode: 'deck' }, 'en', 'mode');
    expect(all).toBe(4);
    expect(options).toEqual([
      ['deck', 2],
      ['template', 2],
    ]);
  });

  it('keeps a mode option visible at zero when other filters exclude it', () => {
    // Option SET comes from all skills; counts from the filtered ones.
    const { options } = skillFilterOptions(skills, { ...NO_FILTERS, source: 'built-in' }, 'en', 'mode');
    expect(options).toEqual([
      ['deck', 1],
      ['template', 0],
    ]);
  });

  it('counts category pills with the category filter itself ignored', () => {
    const { all, options } = skillFilterOptions(skills, { ...NO_FILTERS, category: 'ops' }, 'en', 'category');
    // `all` counts every skill surviving the other filters, INCLUDING the
    // uncategorised one — it is a row that exists, just not under a pill.
    expect(all).toBe(4);
    expect(options).toEqual([
      ['design', 2],
      ['ops', 1],
    ]);
  });

  it('gives an uncategorised skill no category pill', () => {
    const none = [skill({ id: 'x' }), skill({ id: 'y' })];
    const { all, options } = skillFilterOptions(none, NO_FILTERS, 'en', 'category');
    expect(all).toBe(2);
    expect(options).toEqual([]);
  });

  it('treats an empty-string or null category as absent', () => {
    const odd = [skill({ id: 'x', category: '' }), skill({ id: 'y', category: null })];
    expect(skillFilterOptions(odd, NO_FILTERS, 'en', 'category').options).toEqual([]);
  });

  it('sorts options by value, not by list order', () => {
    const unsorted = [
      skill({ id: 'a', mode: 'zebra' }),
      skill({ id: 'b', mode: 'alpha' }),
      skill({ id: 'c', mode: 'middle' }),
    ];
    expect(skillFilterOptions(unsorted, NO_FILTERS, 'en', 'mode').options.map(([v]) => v)).toEqual([
      'alpha',
      'middle',
      'zebra',
    ]);
  });

  it('narrows counts by the active search', () => {
    const searchable = [
      skill({ id: 'a', name: 'findme', mode: 'deck' }),
      skill({ id: 'b', name: 'other', mode: 'deck' }),
    ];
    const { all, options } = skillFilterOptions(searchable, { ...NO_FILTERS, search: 'findme' }, 'en', 'mode');
    expect(all).toBe(1);
    expect(options).toEqual([['deck', 1]]);
  });

  it('handles an empty skill list', () => {
    expect(skillFilterOptions([], NO_FILTERS, 'en', 'mode')).toEqual({ all: 0, options: [] });
    expect(skillFilterOptions([], NO_FILTERS, 'en', 'category')).toEqual({ all: 0, options: [] });
    expect(skillFilterOptions([], NO_FILTERS, 'en', 'source').options).toEqual([
      ['built-in', 0],
      ['user', 0],
    ]);
  });
});

describe('hasAnyCategory', () => {
  it('is true when at least one skill carries a non-empty category', () => {
    expect(hasAnyCategory([skill({ id: 'a' }), skill({ id: 'b', category: 'design' })])).toBe(true);
  });

  it('is false when none do', () => {
    expect(hasAnyCategory([skill({ id: 'a' }), skill({ id: 'b' })])).toBe(false);
  });

  it('does not count an empty string or null as a category', () => {
    expect(hasAnyCategory([skill({ id: 'a', category: '' }), skill({ id: 'b', category: null })])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasAnyCategory([])).toBe(false);
  });
});

describe('parseTriggers', () => {
  it('splits on commas and newlines alike', () => {
    expect(parseTriggers('one, two\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('trims each phrase but preserves interior spaces', () => {
    expect(parseTriggers('  rough layout ,  sketch it  ')).toEqual(['rough layout', 'sketch it']);
  });

  it('drops blanks from trailing separators and stray blank lines', () => {
    expect(parseTriggers('one,,two,\n\n')).toEqual(['one', 'two']);
  });

  it('returns empty for empty or separator-only input', () => {
    expect(parseTriggers('')).toEqual([]);
    expect(parseTriggers('  ')).toEqual([]);
    expect(parseTriggers(',\n,')).toEqual([]);
  });
});

describe('summaryToDraft', () => {
  it('joins triggers back to comma-separated text for the form', () => {
    const s = skill({ id: 'a', name: 'N', description: 'D', triggers: ['one', 'two'] });
    expect(summaryToDraft(s, 'BODY')).toEqual({
      name: 'N',
      description: 'D',
      triggers: 'one, two',
      body: 'BODY',
    });
  });

  it('yields empty triggers text when the skill has none', () => {
    expect(summaryToDraft(skill({ id: 'a' }), '').triggers).toBe('');
  });

  it('survives a host returning null for triggers', () => {
    // The Array.isArray guard exists for exactly this — .join would throw.
    const s = { ...skill({ id: 'a' }), triggers: null } as unknown as SkillSummary;
    expect(summaryToDraft(s, 'B').triggers).toBe('');
  });

  it('round-trips through parseTriggers', () => {
    const s = skill({ id: 'a', triggers: ['one', 'two', 'three'] });
    expect(parseTriggers(summaryToDraft(s, '').triggers)).toEqual(['one', 'two', 'three']);
  });

  it('carries the body through unchanged', () => {
    expect(summaryToDraft(skill({ id: 'a' }), '# Heading\n\nbody').body).toBe('# Heading\n\nbody');
  });
});

describe('EMPTY_SKILL_DRAFT', () => {
  it('is entirely blank, so a create form starts clean', () => {
    expect(EMPTY_SKILL_DRAFT).toEqual({ name: '', description: '', triggers: '', body: '' });
  });
});
