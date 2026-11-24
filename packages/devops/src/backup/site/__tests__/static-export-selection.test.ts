import { describe, expect, it } from 'vitest';
import { allocateStaticExportThemes, parseStaticExportInput, type StaticExportSelectionPolicy } from '../static-export-selection.js';

class Refused extends Error {}
const policy: StaticExportSelectionPolicy = {
  validateSharePath: ({ path }) => { if (path.includes('..') || path.includes('\u0000')) throw new Refused('bad path'); },
  invalidInput: () => { throw new Refused('INVALID_INPUT'); },
};
const alias = ({ path }: { path: string }) => path.normalize('NFC').toLowerCase();
const parse = (input: unknown) => parseStaticExportInput({ input, policy });

describe('parseStaticExportInput', () => {
  const jobId = '00000000-0000-4000-8000-000000000001';
  it('preserves ordered ids, legacy start and resume', () => {
    expect(parse({})).toEqual({});
    expect(parse({ jobId })).toEqual({ jobId });
    expect(parse({ themeIds: ['zoran-poster', 'zoran-editorial'] })).toEqual({ themeIds: ['zoran-poster', 'zoran-editorial'] });
    const many = Array.from({ length: 50 }, (_, index) => `theme-${index}`);
    expect(parse({ themeIds: many })).toEqual({ themeIds: many });
  });
  it('hands every malformed shape to the injected refusal', () => {
    for (const input of [null, [], 'text', { extra: true }, { jobId: 'bad' }, { jobId, themeIds: ['poster'] }, { themeIds: [] }, { themeIds: [1] }, { themeIds: ['a', 'a'] }, { themeIds: ['../a'] }, { themeIds: ['%2fa'] }, { themeIds: [''] }, { themeIds: 'x' }]) {
      expect(() => parse(input), JSON.stringify(input)).toThrow(Refused);
    }
  });
  it('treats a path-policy refusal on a theme id as invalid input, not the path error', () => {
    expect(() => parse({ themeIds: ['a..b'] })).toThrow('INVALID_INPUT');
  });
  it('accepts a public url only on a start', () => {
    const publicUrl = 'https://download.example/site/';
    expect(parse({ publicUrl })).toEqual({ publicUrl });
    expect(parse({ publicUrl, themeIds: ['none'] })).toEqual({ publicUrl, themeIds: ['none'] });
    for (const input of [{ publicUrl: 7 }, { publicUrl: ' ' }, { jobId: '12345678-1234-1234-1234-123456789012', publicUrl }]) {
      expect(() => parse(input)).toThrow(Refused);
    }
  });
});

describe('allocateStaticExportThemes', () => {
  it('strips the site-slug prefix, avoids case/Unicode aliases and is stable across roster order', () => {
    const themeIds = ['zoran-poster', 'poster', 'Poster', 'zoran-été', 'zoran-été'];
    const themes = allocateStaticExportThemes({ themeIds, siteSlug: 'zoran-studio', policy: { validateSharePath: policy.validateSharePath, sharePathAlias: alias } });
    expect(new Set(themes.map(theme => theme.name.normalize('NFC').toLowerCase())).size).toBe(5);
    expect(themes.find(theme => theme.themeId === 'zoran-poster')!.name).toMatch(/^poster/);
    const reversed = allocateStaticExportThemes({ themeIds: [...themeIds].reverse(), siteSlug: 'zoran-studio', policy: { validateSharePath: policy.validateSharePath, sharePathAlias: alias } });
    expect(new Map(themes.map(t => [t.themeId, t.name]))).toEqual(new Map(reversed.map(t => [t.themeId, t.name])));
  });
  it('lets the path policy refuse an allocated folder', () => {
    expect(() => allocateStaticExportThemes({ themeIds: ['a'], siteSlug: 's', policy: { validateSharePath: () => { throw new Refused('no'); }, sharePathAlias: alias } })).toThrow(Refused);
  });
});
