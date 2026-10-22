/**
 * @file Unit tests for the admin-surface descriptor parser's refusals that the security suite does
 * not already pin: file-level bounds, surface and action list shapes, identity fields, duplicate
 * ids/names, and malformed CSP blocks. Each refusal names the exact field that failed.
 */
import { describe, expect, test } from 'vitest';
import { isContainedAdminSurfacePath, parseAdminSurfacesFile } from '../descriptor.js';

const SURFACE = { id: 'settings', title: 'Settings', entry: 'surfaces/settings.html' };

function parse(raw: string) {
  return parseAdminSurfacesFile({ raw });
}

function parseSurfaces(surfaces: unknown) {
  return parse(JSON.stringify({ schemaVersion: 1, surfaces }));
}

function withSurface(overrides: Record<string, unknown>) {
  return parseSurfaces([{ ...SURFACE, ...overrides }]);
}

const refused = (reason: string) => ({ ok: false, reason });

describe('file', () => {
  test('accepts a minimal surface with empty defaults', () => {
    expect(parseSurfaces([SURFACE])).toEqual({ ok: true, descriptors: [{ ...SURFACE, files: [], actions: [], csp: {} }] });
  });

  test('refuses text over 64 KiB before parsing it', () => {
    expect(parse(' '.repeat(64 * 1024 + 1))).toEqual(refused('larger than 64 KiB'));
  });

  test('refuses text that is not JSON', () => {
    expect(parse('{')).toEqual(refused('not valid JSON'));
  });

  test('refuses a top-level array', () => {
    expect(parse('[]')).toEqual(refused('schemaVersion must be 1'));
  });

  test('refuses another schema version', () => {
    expect(parse(JSON.stringify({ schemaVersion: 2, surfaces: [] }))).toEqual(refused('schemaVersion must be 1'));
  });

  test('refuses surfaces that is not an array', () => {
    expect(parseSurfaces({ settings: SURFACE })).toEqual(refused('surfaces must be an array of at most 16'));
  });

  test('refuses more than 16 surfaces', () => {
    const surfaces = Array.from({ length: 17 }, (_, index) => ({ ...SURFACE, id: `s-${index}` }));
    expect(parseSurfaces(surfaces)).toEqual(refused('surfaces must be an array of at most 16'));
  });

  test('accepts exactly 16 surfaces', () => {
    const surfaces = Array.from({ length: 16 }, (_, index) => ({ ...SURFACE, id: `s-${index}` }));
    const parsed = parseSurfaces(surfaces);
    expect(parsed.ok && parsed.descriptors.length).toBe(16);
  });

  test('refuses a surface that is not an object', () => {
    expect(parseSurfaces([SURFACE, 'settings'])).toEqual(refused('surfaces[1] must be an object'));
  });

  test('refuses a surface id declared twice', () => {
    expect(parseSurfaces([SURFACE, { ...SURFACE }])).toEqual(refused("surfaces[1].id 'settings' is declared twice"));
  });
});

describe('identity', () => {
  test.each([['Settings'], ['two--dashes'], ['-lead'], [`a${'b'.repeat(64)}`], [3]])('refuses id %j', (id) => {
    expect(withSurface({ id })).toEqual(refused('surfaces[0].id must be a lowercase hyphenated id'));
  });

  test('accepts a 64-character id', () => {
    expect(withSurface({ id: `a${'b'.repeat(63)}` }).ok).toBe(true);
  });

  test.each([[undefined], ['   '], ['t'.repeat(101)]])('refuses title %j', (title) => {
    expect(withSurface({ title })).toEqual(refused('surfaces[0].title must be a non-empty string of at most 100 characters'));
  });

  test('accepts a 100-character title', () => {
    expect(withSurface({ title: 't'.repeat(100) }).ok).toBe(true);
  });

  test('refuses an entry that is not .html', () => {
    expect(withSurface({ entry: 'surfaces/settings.htm' })).toEqual(refused('surfaces[0].entry must be a plain relative path ending in .html'));
  });
});

describe('files', () => {
  test('refuses files that is not an array', () => {
    expect(withSurface({ files: 'app.mjs' })).toEqual(refused('surfaces[0].files must be an array of at most 32'));
  });

  test('refuses more than 32 files', () => {
    expect(withSurface({ files: Array.from({ length: 33 }, (_, index) => `f${index}.js`) })).toEqual(refused('surfaces[0].files must be an array of at most 32'));
  });

  test('accepts 32 files of every allowed extension', () => {
    const files = Array.from({ length: 32 }, (_, index) => `f${index}${['.mjs', '.js', '.css', '.json'][index % 4]}`);
    expect(withSurface({ files }).ok).toBe(true);
  });

  test('names the first file with an unsupported extension', () => {
    expect(withSurface({ files: ['app.mjs', 'logo.svg'] })).toEqual(refused('surfaces[0].files[1] must be a plain relative path ending in .mjs, .js, .css, .json'));
  });
});

describe('isContainedAdminSurfacePath', () => {
  test('accepts a 200-character path', () => {
    expect(isContainedAdminSurfacePath({ value: `${'a'.repeat(196)}.mjs`, extensions: ['.mjs'] })).toBe(true);
  });

  test('refuses a 201-character path', () => {
    expect(isContainedAdminSurfacePath({ value: `${'a'.repeat(197)}.mjs`, extensions: ['.mjs'] })).toBe(false);
  });

  test('refuses a non-string', () => {
    expect(isContainedAdminSurfacePath({ value: ['a.mjs'], extensions: ['.mjs'] })).toBe(false);
  });
});

describe('actions', () => {
  const INPUT = { type: 'object' };

  test('refuses actions that is not an array', () => {
    expect(withSurface({ actions: {} })).toEqual(refused('surfaces[0].actions must be an array of at most 32'));
  });

  test('refuses more than 32 actions', () => {
    const actions = Array.from({ length: 33 }, (_, index) => ({ name: `a-${index}`, input: INPUT }));
    expect(withSurface({ actions })).toEqual(refused('surfaces[0].actions must be an array of at most 32'));
  });

  test('refuses an action that is not an object', () => {
    expect(withSurface({ actions: ['save'] })).toEqual(refused('surfaces[0].actions[0] must be an object'));
  });

  test('refuses an action name that is not an id', () => {
    expect(withSurface({ actions: [{ name: 'Save', input: INPUT }] })).toEqual(refused('surfaces[0].actions[0].name must be a lowercase hyphenated id'));
  });

  test('refuses an action name declared twice', () => {
    expect(withSurface({ actions: [{ name: 'save', input: INPUT }, { name: 'save', input: INPUT }] })).toEqual(refused("surfaces[0].actions[1].name 'save' is declared twice"));
  });

  test('names an invalid input schema', () => {
    expect(withSurface({ actions: [{ name: 'save', input: { type: 'object', pattern: 'x' } }] })).toEqual(refused("surfaces[0].actions[0].input uses unsupported keyword 'pattern'"));
  });

  test('names an invalid result schema', () => {
    expect(withSurface({ actions: [{ name: 'save', input: INPUT, result: { type: 'any' } }] })).toEqual(refused('surfaces[0].actions[0].result must declare a supported type'));
  });

  test('keeps a declared result schema', () => {
    const parsed = withSurface({ actions: [{ name: 'save', input: INPUT, result: { type: 'boolean' } }] });
    expect(parsed.ok && parsed.descriptors[0]!.actions).toEqual([{ name: 'save', effect: 'write', input: INPUT, result: { type: 'boolean' } }]);
  });
});

describe('csp', () => {
  test('refuses a csp that is not an object', () => {
    expect(withSurface({ csp: ['https://cdn.example.com'] })).toEqual(refused('surfaces[0].csp must be an object'));
  });

  test('refuses sources that are not an array', () => {
    expect(withSurface({ csp: { 'img-src': 'https://cdn.example.com' } })).toEqual(refused("surfaces[0].csp['img-src'] must be an array of at most 8"));
  });

  test('refuses more than 8 sources for one directive', () => {
    const sources = Array.from({ length: 9 }, (_, index) => `https://cdn${index}.example.com`);
    expect(withSurface({ csp: { 'img-src': sources } })).toEqual(refused("surfaces[0].csp['img-src'] must be an array of at most 8"));
  });

  test('accepts 8 bare origins on every allowed directive', () => {
    const sources = Array.from({ length: 8 }, (_, index) => `https://cdn${index}.example.com`);
    const csp = Object.fromEntries(['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src'].map((directive) => [directive, sources]));
    expect(withSurface({ csp })).toMatchObject({ ok: true, descriptors: [{ csp }] });
  });

  test('truncates an unknown directive name to 32 characters in the refusal', () => {
    expect(withSurface({ csp: { [`x${'y'.repeat(40)}`]: [] } })).toEqual(refused(`surfaces[0].csp may not extend 'x${'y'.repeat(31)}'`));
  });
});
