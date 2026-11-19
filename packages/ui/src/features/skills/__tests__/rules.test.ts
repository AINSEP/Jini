import { describe, expect, it } from 'vitest';

// Imported through the BARREL, not the module, on purpose: it exercises the
// public surface a consumer actually sees, so a symbol missing from
// `index.ts` fails here rather than at some host's build.
import {
  EMPTY_SKILL_DRAFT,
  filterSkills,
  formatSkillFileSize,
  hasAnyCategory,
  humanizeSkillCategory,
  isBuiltInSkill,
  isDeletableSkill,
  localizedSkillDescription,
  localizedSkillName,
  parseTriggers,
  skillFileLeafName,
  skillFileTreeIndent,
  skillFilterOptions,
  skillMatchesFilters,
  skillMatchesSearch,
  summaryToDraft,
  validateSkillDraft,
} from '../rules.js';
import type { SkillDraft, SkillFilters, SkillSummary } from '../types.js';

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
    expect(localizedSkillName({ skill: s, locale: 'fr' })).toBe('Filaire');
    expect(localizedSkillName({ skill: s, locale: 'de' })).toBe('Drahtmodell');
  });

  it('falls back to the untranslated value for an unlisted locale', () => {
    const s = skill({ id: 'a', name: 'Wireframe', displayName: { fr: 'Filaire' } });
    expect(localizedSkillName({ skill: s, locale: 'ja' })).toBe('Wireframe');
  });

  it('falls back when the host does not localize at all', () => {
    const s = skill({ id: 'a', name: 'Wireframe', description: 'Draws boxes' });
    expect(localizedSkillName({ skill: s, locale: 'fr' })).toBe('Wireframe');
    expect(localizedSkillDescription({ skill: s, locale: 'fr' })).toBe('Draws boxes');
  });

  it('localizes description independently of name', () => {
    const s = skill({ id: 'a', description: 'Draws boxes', descriptionI18n: { fr: 'Dessine' } });
    expect(localizedSkillDescription({ skill: s, locale: 'fr' })).toBe('Dessine');
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
    expect(skillMatchesSearch({ skill: s, query: '', locale: 'en' })).toBe(true);
    expect(skillMatchesSearch({ skill: s, query: '   ', locale: 'en' })).toBe(true);
  });

  it('normalises the query itself rather than requiring a pre-lowercased one', () => {
    // The origin required callers to pre-lowercase and silently missed otherwise.
    expect(skillMatchesSearch({ skill: s, query: 'WIREFRAME', locale: 'en' })).toBe(true);
    expect(skillMatchesSearch({ skill: s, query: '  Wireframe  ', locale: 'en' })).toBe(true);
  });

  it('searches the untranslated name even while a locale is active', () => {
    expect(skillMatchesSearch({ skill: s, query: 'wireframe', locale: 'fr' })).toBe(true);
  });

  it('searches the localized name for the active locale', () => {
    expect(skillMatchesSearch({ skill: s, query: 'filaire', locale: 'fr' })).toBe(true);
  });

  it('does not match a localization for a different locale', () => {
    const other = skill({ id: 'b', name: 'Zed', displayName: { fr: 'Filaire' } });
    expect(skillMatchesSearch({ skill: other, query: 'filaire', locale: 'de' })).toBe(false);
  });

  it('searches description, localized description, triggers and category', () => {
    expect(skillMatchesSearch({ skill: s, query: 'draws', locale: 'en' })).toBe(true);
    expect(skillMatchesSearch({ skill: s, query: 'dessine', locale: 'fr' })).toBe(true);
    expect(skillMatchesSearch({ skill: s, query: 'rough layout', locale: 'en' })).toBe(true);
    expect(skillMatchesSearch({ skill: s, query: 'design', locale: 'en' })).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(skillMatchesSearch({ skill: s, query: 'kubernetes', locale: 'en' })).toBe(false);
  });

  it('handles a skill with no triggers and no category', () => {
    const bare = skill({ id: 'c', name: 'Bare' });
    expect(skillMatchesSearch({ skill: bare, query: 'bare', locale: 'en' })).toBe(true);
    expect(skillMatchesSearch({ skill: bare, query: 'nope', locale: 'en' })).toBe(false);
  });

  it('does not let one skill\'s fields bleed across the joiner', () => {
    // Fields are newline-joined; a query spanning two fields must not match.
    const s2 = skill({ id: 'd', name: 'alpha', description: 'beta' });
    expect(skillMatchesSearch({ skill: s2, query: 'alphabeta', locale: 'en' })).toBe(false);
  });
});

describe('skillMatchesFilters', () => {
  const s = skill({ id: 'a', mode: 'deck', source: 'built-in', category: 'design' });

  it('passes when every filter is "all"', () => {
    expect(skillMatchesFilters({ skill: s, filters: NO_FILTERS, locale: 'en' })).toBe(true);
  });

  it('rejects on a mismatched source, mode, or category', () => {
    expect(skillMatchesFilters({ skill: s, filters: { ...NO_FILTERS, source: 'user' }, locale: 'en' })).toBe(false);
    expect(skillMatchesFilters({ skill: s, filters: { ...NO_FILTERS, mode: 'prototype' }, locale: 'en' })).toBe(false);
    expect(skillMatchesFilters({ skill: s, filters: { ...NO_FILTERS, category: 'ops' }, locale: 'en' })).toBe(false);
  });

  it('accepts on a matching source, mode, and category', () => {
    expect(
      skillMatchesFilters({ skill: s, filters: { search: '', source: 'built-in', mode: 'deck', category: 'design' }, locale: 'en' }),
    ).toBe(true);
  });

  it('ignores exactly the excepted dimension and no other', () => {
    const mismatched = { ...NO_FILTERS, source: 'user' as const, mode: 'prototype' };
    // Excepting source is not enough — mode still mismatches.
    expect(skillMatchesFilters({ skill: s, filters: mismatched, locale: 'en' }, { except: 'source' })).toBe(false);
    // Excepting mode is not enough — source still mismatches.
    expect(skillMatchesFilters({ skill: s, filters: mismatched, locale: 'en' }, { except: 'mode' })).toBe(false);
    // Excepting source with only source mismatched does pass.
    expect(skillMatchesFilters({ skill: s, filters: { ...NO_FILTERS, source: 'user' }, locale: 'en' }, { except: 'source' })).toBe(true);
    expect(skillMatchesFilters({ skill: s, filters: { ...NO_FILTERS, category: 'ops' }, locale: 'en' }, { except: 'category' })).toBe(true);
  });

  it('never excepts the search filter', () => {
    const filters = { ...NO_FILTERS, search: 'kubernetes' };
    expect(skillMatchesFilters({ skill: s, filters, locale: 'en' }, { except: 'source' })).toBe(false);
    expect(skillMatchesFilters({ skill: s, filters, locale: 'en' }, { except: 'mode' })).toBe(false);
    expect(skillMatchesFilters({ skill: s, filters, locale: 'en' }, { except: 'category' })).toBe(false);
  });
});

describe('filterSkills', () => {
  const skills = [
    skill({ id: 'a', mode: 'deck', source: 'user', category: 'design' }),
    skill({ id: 'b', mode: 'deck', source: 'built-in', category: 'ops' }),
    skill({ id: 'c', mode: 'template', source: 'user' }),
  ];

  it('returns everything when unfiltered', () => {
    expect(filterSkills({ skills, filters: NO_FILTERS, locale: 'en' }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies filters conjunctively', () => {
    expect(filterSkills({ skills, filters: { ...NO_FILTERS, mode: 'deck', source: 'user' }, locale: 'en' }).map((s) => s.id)).toEqual(['a']);
  });

  it('preserves input order', () => {
    expect(filterSkills({ skills, filters: { ...NO_FILTERS, source: 'user' }, locale: 'en' }).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('can return empty', () => {
    expect(filterSkills({ skills, filters: { ...NO_FILTERS, mode: 'nonexistent' }, locale: 'en' })).toEqual([]);
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
    const { all, options } = skillFilterOptions({ skills, filters: { ...NO_FILTERS, source: 'built-in' }, locale: 'en', dimension: 'source' });
    expect(all).toBe(4);
    expect(options).toEqual([
      ['built-in', 1],
      ['user', 3],
    ]);
  });

  it('still narrows source counts by the OTHER active filters', () => {
    const { all, options } = skillFilterOptions({ skills, filters: { ...NO_FILTERS, mode: 'deck' }, locale: 'en', dimension: 'source' });
    expect(all).toBe(2);
    expect(options).toEqual([
      ['built-in', 1],
      ['user', 1],
    ]);
  });

  it('always offers both known source pills even at zero', () => {
    const onlyUser = [skill({ id: 'x', source: 'user' })];
    const { options } = skillFilterOptions({ skills: onlyUser, filters: NO_FILTERS, locale: 'en', dimension: 'source' });
    expect(options).toEqual([
      ['built-in', 0],
      ['user', 1],
    ]);
  });

  it('counts an unknown source under all, but gives it no pill', () => {
    const withOrg = [...skills, skill({ id: 'e', source: 'org-registry' })];
    const { all, options } = skillFilterOptions({ skills: withOrg, filters: NO_FILTERS, locale: 'en', dimension: 'source' });
    expect(all).toBe(5);
    expect(options.map(([value]) => value)).toEqual(['built-in', 'user']);
  });

  it('counts mode pills with the mode filter itself ignored', () => {
    const { all, options } = skillFilterOptions({ skills, filters: { ...NO_FILTERS, mode: 'deck' }, locale: 'en', dimension: 'mode' });
    expect(all).toBe(4);
    expect(options).toEqual([
      ['deck', 2],
      ['template', 2],
    ]);
  });

  it('keeps a mode option visible at zero when other filters exclude it', () => {
    // Option SET comes from all skills; counts from the filtered ones.
    const { options } = skillFilterOptions({ skills, filters: { ...NO_FILTERS, source: 'built-in' }, locale: 'en', dimension: 'mode' });
    expect(options).toEqual([
      ['deck', 1],
      ['template', 0],
    ]);
  });

  it('counts category pills with the category filter itself ignored', () => {
    const { all, options } = skillFilterOptions({ skills, filters: { ...NO_FILTERS, category: 'ops' }, locale: 'en', dimension: 'category' });
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
    const { all, options } = skillFilterOptions({ skills: none, filters: NO_FILTERS, locale: 'en', dimension: 'category' });
    expect(all).toBe(2);
    expect(options).toEqual([]);
  });

  it('treats an empty-string or null category as absent', () => {
    const odd = [skill({ id: 'x', category: '' }), skill({ id: 'y', category: null })];
    expect(skillFilterOptions({ skills: odd, filters: NO_FILTERS, locale: 'en', dimension: 'category' }).options).toEqual([]);
  });

  it('sorts options by value, not by list order', () => {
    const unsorted = [
      skill({ id: 'a', mode: 'zebra' }),
      skill({ id: 'b', mode: 'alpha' }),
      skill({ id: 'c', mode: 'middle' }),
    ];
    expect(skillFilterOptions({ skills: unsorted, filters: NO_FILTERS, locale: 'en', dimension: 'mode' }).options.map(([v]) => v)).toEqual([
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
    const { all, options } = skillFilterOptions({ skills: searchable, filters: { ...NO_FILTERS, search: 'findme' }, locale: 'en', dimension: 'mode' });
    expect(all).toBe(1);
    expect(options).toEqual([['deck', 1]]);
  });

  it('handles an empty skill list', () => {
    expect(skillFilterOptions({ skills: [], filters: NO_FILTERS, locale: 'en', dimension: 'mode' })).toEqual({ all: 0, options: [] });
    expect(skillFilterOptions({ skills: [], filters: NO_FILTERS, locale: 'en', dimension: 'category' })).toEqual({ all: 0, options: [] });
    expect(skillFilterOptions({ skills: [], filters: NO_FILTERS, locale: 'en', dimension: 'source' }).options).toEqual([
      ['built-in', 0],
      ['user', 0],
    ]);
  });
});

describe('hasAnyCategory', () => {
  it('is true when at least one skill carries a non-empty category', () => {
    expect(hasAnyCategory({ skills: [skill({ id: 'a' }), skill({ id: 'b', category: 'design' })] })).toBe(true);
  });

  it('is false when none do', () => {
    expect(hasAnyCategory({ skills: [skill({ id: 'a' }), skill({ id: 'b' })] })).toBe(false);
  });

  it('does not count an empty string or null as a category', () => {
    expect(hasAnyCategory({ skills: [skill({ id: 'a', category: '' }), skill({ id: 'b', category: null })] })).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasAnyCategory({ skills: [] })).toBe(false);
  });
});

describe('parseTriggers', () => {
  it('splits on commas and newlines alike', () => {
    expect(parseTriggers({ raw: 'one, two\nthree' })).toEqual(['one', 'two', 'three']);
  });

  it('trims each phrase but preserves interior spaces', () => {
    expect(parseTriggers({ raw: '  rough layout ,  sketch it  ' })).toEqual(['rough layout', 'sketch it']);
  });

  it('drops blanks from trailing separators and stray blank lines', () => {
    expect(parseTriggers({ raw: 'one,,two,\n\n' })).toEqual(['one', 'two']);
  });

  it('returns empty for empty or separator-only input', () => {
    expect(parseTriggers({ raw: '' })).toEqual([]);
    expect(parseTriggers({ raw: '  ' })).toEqual([]);
    expect(parseTriggers({ raw: ',\n,' })).toEqual([]);
  });
});

describe('summaryToDraft', () => {
  it('joins triggers back to comma-separated text for the form', () => {
    const s = skill({ id: 'a', name: 'N', description: 'D', triggers: ['one', 'two'] });
    expect(summaryToDraft({ skill: s, body: 'BODY' })).toEqual({
      name: 'N',
      description: 'D',
      triggers: 'one, two',
      body: 'BODY',
    });
  });

  it('yields empty triggers text when the skill has none', () => {
    expect(summaryToDraft({ skill: skill({ id: 'a' }), body: '' }).triggers).toBe('');
  });

  it('survives a host returning null for triggers', () => {
    // The Array.isArray guard exists for exactly this — .join would throw.
    const s = { ...skill({ id: 'a' }), triggers: null } as unknown as SkillSummary;
    expect(summaryToDraft({ skill: s, body: 'B' }).triggers).toBe('');
  });

  it('round-trips through parseTriggers', () => {
    const s = skill({ id: 'a', triggers: ['one', 'two', 'three'] });
    expect(parseTriggers({ raw: summaryToDraft({ skill: s, body: '' }).triggers })).toEqual(['one', 'two', 'three']);
  });

  it('carries the body through unchanged', () => {
    expect(summaryToDraft({ skill: skill({ id: 'a' }), body: '# Heading\n\nbody' }).body).toBe('# Heading\n\nbody');
  });
});

describe('EMPTY_SKILL_DRAFT', () => {
  it('is entirely blank, so a create form starts clean', () => {
    expect(EMPTY_SKILL_DRAFT).toEqual({ name: '', description: '', triggers: '', body: '' });
  });
});

function draft(over: Partial<SkillDraft> = {}): SkillDraft {
  return { name: 'a name', description: '', triggers: '', body: 'a body', ...over };
}

describe('validateSkillDraft', () => {
  it('is null when both required fields are present', () => {
    expect(validateSkillDraft(draft())).toBeNull();
  });

  it('reports name-required when the name is blank', () => {
    expect(validateSkillDraft(draft({ name: '' }))).toBe('name-required');
  });

  it('treats a whitespace-only name as blank', () => {
    expect(validateSkillDraft(draft({ name: '   ' }))).toBe('name-required');
  });

  it('reports body-required when the body is blank', () => {
    expect(validateSkillDraft(draft({ body: '' }))).toBe('body-required');
  });

  it('treats a whitespace-only body as blank', () => {
    expect(validateSkillDraft(draft({ body: '   ' }))).toBe('body-required');
  });

  it('checks name before body, matching the origin precedence', () => {
    // Both blank: the operator should see the name error first.
    expect(validateSkillDraft(draft({ name: '', body: '' }))).toBe('name-required');
  });
});

describe('humanizeSkillCategory', () => {
  it('title-cases a kebab-case slug', () => {
    expect(humanizeSkillCategory('image-generation')).toBe('Image Generation');
  });

  it('title-cases a single-word slug', () => {
    expect(humanizeSkillCategory('design')).toBe('Design');
  });

  it('returns an empty slug unchanged', () => {
    expect(humanizeSkillCategory('')).toBe('');
  });

  it('title-cases every hyphen-separated word', () => {
    expect(humanizeSkillCategory('a-b-c')).toBe('A B C');
  });

  it('leaves an empty segment from a doubled hyphen as-is', () => {
    // 'a--b'.split('-') => ['a', '', 'b']; the middle empty word is returned
    // unchanged rather than crashing on charAt(0) of an empty string.
    expect(humanizeSkillCategory('a--b')).toBe('A  B');
  });
});

describe('skillFileLeafName', () => {
  it('returns the last segment of a nested path', () => {
    expect(skillFileLeafName({ path: 'assets/images/logo.png' })).toBe('logo.png');
  });

  it('returns the whole string when there is no separator', () => {
    expect(skillFileLeafName({ path: 'SKILL.md' })).toBe('SKILL.md');
  });

  it('returns an empty string for a path ending in a separator', () => {
    expect(skillFileLeafName({ path: 'assets/images/' })).toBe('');
  });
});

describe('skillFileTreeIndent', () => {
  it('is 0 for a top-level entry', () => {
    expect(skillFileTreeIndent({ path: 'SKILL.md' })).toBe(0);
  });

  it('indents 12px per path segment', () => {
    expect(skillFileTreeIndent({ path: 'assets/logo.png' })).toBe(12);
    expect(skillFileTreeIndent({ path: 'assets/images/logo.png' })).toBe(24);
  });

  it('caps indentation at depth 4', () => {
    expect(skillFileTreeIndent({ path: 'a/b/c/d/e' })).toBe(48);
    expect(skillFileTreeIndent({ path: 'a/b/c/d/e/f/g' })).toBe(48);
  });
});

describe('formatSkillFileSize', () => {
  it('renders sub-kilobyte sizes in bytes', () => {
    expect(formatSkillFileSize({ bytes: 500 })).toBe('500 B');
  });

  it('renders kilobyte sizes to one decimal', () => {
    expect(formatSkillFileSize({ bytes: 2048 })).toBe('2.0 KB');
  });

  it('renders megabyte sizes to one decimal', () => {
    expect(formatSkillFileSize({ bytes: 2 * 1024 * 1024 })).toBe('2.0 MB');
  });

  it('treats exactly 1024 bytes as the KB boundary, not bytes', () => {
    expect(formatSkillFileSize({ bytes: 1024 })).toBe('1.0 KB');
  });

  it('treats exactly 1MB as the MB boundary, not KB', () => {
    expect(formatSkillFileSize({ bytes: 1024 * 1024 })).toBe('1.0 MB');
  });
});

describe('isBuiltInSkill', () => {
  it('is true for a built-in skill', () => {
    expect(isBuiltInSkill(skill({ id: 'a', source: 'built-in' }))).toBe(true);
  });

  it('is false for a user-authored skill', () => {
    expect(isBuiltInSkill(skill({ id: 'a', source: 'user' }))).toBe(false);
  });

  it('is true for any origin other than user, inclusive of unknown ones', () => {
    expect(isBuiltInSkill(skill({ id: 'a', source: 'org-registry' }))).toBe(true);
  });
});

describe('isDeletableSkill', () => {
  it('is true only for a user-authored skill', () => {
    expect(isDeletableSkill(skill({ id: 'a', source: 'user' }))).toBe(true);
  });

  it('is false for a built-in skill', () => {
    expect(isDeletableSkill(skill({ id: 'a', source: 'built-in' }))).toBe(false);
  });

  it('is false for a third-party origin', () => {
    expect(isDeletableSkill(skill({ id: 'a', source: 'org-registry' }))).toBe(false);
  });
});
