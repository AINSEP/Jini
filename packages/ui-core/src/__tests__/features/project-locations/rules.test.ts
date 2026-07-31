import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  locationLabel,
  resolveDefaultLocationId,
  saveableDrafts,
  toStoredLocations,
} from '../../../features/project-locations/index.js';
import type { ProjectLocation } from '../../../features/project-locations/index.js';

function loc(over: Partial<ProjectLocation> & Pick<ProjectLocation, 'id'>): ProjectLocation {
  return { name: `name-${over.id}`, path: `/p/${over.id}`, ...over };
}

describe('locationLabel', () => {
  it('takes the last segment of a POSIX path', () => {
    expect(locationLabel('/Users/me/Projects/site')).toBe('site');
  });

  it('takes the last segment of a Windows path', () => {
    // Both separators are handled regardless of host, since a path can be
    // typed on one platform and rendered on another.
    expect(locationLabel('C:\\Users\\me\\site')).toBe('site');
  });

  it('ignores a trailing separator', () => {
    expect(locationLabel('/Users/me/site/')).toBe('site');
    expect(locationLabel('C:\\Users\\me\\site\\')).toBe('site');
  });

  it('collapses repeated separators', () => {
    expect(locationLabel('/Users//me///site')).toBe('site');
  });

  it('falls back to the whole path when there is no segment', () => {
    // A blank label would render an unclickable empty row.
    expect(locationLabel('/')).toBe('/');
    expect(locationLabel('')).toBe('');
  });

  it('returns a bare name unchanged', () => {
    expect(locationLabel('site')).toBe('site');
  });
});

describe('externalLocations', () => {
  it('drops built-ins — the operator manages only what they added', () => {
    const locations = [loc({ id: 'a' }), loc({ id: 'b', builtIn: true }), loc({ id: 'c' })];
    expect(externalLocations(locations)).toEqual([
      { id: 'a', path: '/p/a' },
      { id: 'c', path: '/p/c' },
    ]);
  });

  it('treats builtIn:false as editable', () => {
    expect(externalLocations([loc({ id: 'a', builtIn: false })])).toHaveLength(1);
  });

  it('returns empty for an empty or all-built-in list', () => {
    expect(externalLocations([])).toEqual([]);
    expect(externalLocations([loc({ id: 'a', builtIn: true })])).toEqual([]);
  });

  it('carries id and path but not name', () => {
    expect(externalLocations([loc({ id: 'a', name: 'Alpha' })])).toEqual([{ id: 'a', path: '/p/a' }]);
  });
});

describe('toStoredLocations', () => {
  it('drops built-ins and keeps id, name and path', () => {
    const locations = [loc({ id: 'a', name: 'Alpha' }), loc({ id: 'b', builtIn: true })];
    expect(toStoredLocations(locations)).toEqual([{ id: 'a', name: 'Alpha', path: '/p/a' }]);
  });

  it('does not leak the builtIn flag into stored config', () => {
    const stored = toStoredLocations([loc({ id: 'a', builtIn: false })]);
    expect(Object.keys(stored[0]!).sort()).toEqual(['id', 'name', 'path']);
  });

  it('returns empty for an empty list', () => {
    expect(toStoredLocations([])).toEqual([]);
  });
});

describe('saveableDrafts', () => {
  it('drops blank rows — those are the add affordance, not locations', () => {
    expect(saveableDrafts([{ path: '/real' }, { path: '' }, { path: '   ' }])).toEqual([{ path: '/real' }]);
  });

  it('keeps a draft with no id — that is a create, not a mistake', () => {
    expect(saveableDrafts([{ path: '/new' }])).toEqual([{ path: '/new' }]);
  });

  it('does not trim the surviving path', () => {
    // Trimming is the host's call at write time; the editor's value is preserved.
    expect(saveableDrafts([{ path: ' /padded ' }])).toEqual([{ path: ' /padded ' }]);
  });

  it('returns empty when everything is blank', () => {
    expect(saveableDrafts([{ path: '' }, { path: '\t' }])).toEqual([]);
    expect(saveableDrafts([])).toEqual([]);
  });
});

describe('resolveDefaultLocationId', () => {
  const locations = [loc({ id: 'a' }), loc({ id: 'b' })];

  it('keeps a default that still resolves', () => {
    expect(resolveDefaultLocationId('a', locations)).toBe('a');
  });

  it('falls back when the default was removed', () => {
    // A dangling id would point new projects at nothing.
    expect(resolveDefaultLocationId('gone', locations)).toBe(DEFAULT_LOCATION_ID);
  });

  it('accepts the built-in default without it being in the list', () => {
    expect(resolveDefaultLocationId(DEFAULT_LOCATION_ID, [])).toBe(DEFAULT_LOCATION_ID);
  });

  it('treats null and undefined as the built-in default', () => {
    expect(resolveDefaultLocationId(null, locations)).toBe(DEFAULT_LOCATION_ID);
    expect(resolveDefaultLocationId(undefined, locations)).toBe(DEFAULT_LOCATION_ID);
  });

  it('falls back when the list is empty', () => {
    expect(resolveDefaultLocationId('a', [])).toBe(DEFAULT_LOCATION_ID);
  });

  it('can resolve to a built-in location by id', () => {
    expect(resolveDefaultLocationId('sys', [loc({ id: 'sys', builtIn: true })])).toBe('sys');
  });
});

describe('isDuplicatePath', () => {
  const locations = [loc({ id: 'a', path: '/Users/me/site' }), loc({ id: 'b', path: '/Users/me/blog' })];

  it('detects an exact duplicate', () => {
    expect(isDuplicatePath('/Users/me/site', locations)).toBe(true);
  });

  it('detects a duplicate differing only by trailing separator', () => {
    // A folder picker and a typed path routinely disagree on this.
    expect(isDuplicatePath('/Users/me/site/', locations)).toBe(true);
    expect(isDuplicatePath('/Users/me/site', [loc({ id: 'a', path: '/Users/me/site/' })])).toBe(true);
  });

  it('detects a duplicate differing only by surrounding whitespace', () => {
    expect(isDuplicatePath('  /Users/me/site  ', locations)).toBe(true);
  });

  it('is false for a genuinely new path', () => {
    expect(isDuplicatePath('/Users/me/other', locations)).toBe(false);
  });

  it('excludes the row itself, so re-saving is not a self-duplicate', () => {
    expect(isDuplicatePath('/Users/me/site', locations, 'a')).toBe(false);
  });

  it('still flags a clash with a DIFFERENT row when excepting one', () => {
    expect(isDuplicatePath('/Users/me/blog', locations, 'a')).toBe(true);
  });

  it('is false for a blank candidate — that is an empty row, not a clash', () => {
    expect(isDuplicatePath('', locations)).toBe(false);
    expect(isDuplicatePath('   ', locations)).toBe(false);
  });

  it('does not reduce a root path to empty when comparing', () => {
    // '/' must stay '/' rather than normalising to '' and matching blanks.
    expect(isDuplicatePath('/', [loc({ id: 'r', path: '/' })])).toBe(true);
    expect(isDuplicatePath('/', locations)).toBe(false);
  });

  it('handles Windows separators', () => {
    expect(isDuplicatePath('C:\\site\\', [loc({ id: 'w', path: 'C:\\site' })])).toBe(true);
  });

  it('does not blank an all-separator path when stripping the trailing one', () => {
    // '//' is longer than one char, so it reaches the strip — which would
    // reduce it to '' and make it match every other separator-only path.
    // The fallback keeps it as itself.
    expect(isDuplicatePath('//', [loc({ id: 'r', path: '//' })])).toBe(true);
    expect(isDuplicatePath('//', [loc({ id: 'r', path: '\\\\' })])).toBe(false);
  });

  it('is false against an empty list', () => {
    expect(isDuplicatePath('/anything', [])).toBe(false);
  });
});
