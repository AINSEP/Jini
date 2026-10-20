import { describe, expect, it } from 'vitest';
import { isPluginRelativePath, validateBrowserProviders } from '../../browser-providers.js';

const digest = `sha256-${'ab'.repeat(32)}`;
const provider = { id: 'charts.basic', kind: 'chart', contractVersion: 1, kinds: ['bar'], javascript: 'client/chart.js' };
const integrity = { 'client/chart.js': digest, 'client/chart.mjs': digest, 'client/chart.css': digest };
const invalid = ({ message }: { message: string }, _options: Record<string, never> = {}) => ({ code: 'BROWSER_PROVIDER_INVALID', file: null, message });

describe('browser declaration admission before L121', () => {
  it.each([undefined, []].map(browserProviders => ({ browserProviders })))('accepts absent or empty declarations: %j', ({ browserProviders }) => {
    expect(validateBrowserProviders({ browserProviders, integrity })).toEqual([]);
  });
  it.each([null, {}, 'charts', 1])('rejects a non-list declaration: %j', browserProviders => {
    expect(validateBrowserProviders({ browserProviders, integrity })).toEqual([invalid({ message: 'browserProviders must be a list.' })]);
  });
  it.each([null, [], 'chart', 1].map(value => ({ value })))('rejects non-object entries and continues to the next declaration: %j', ({ value }) => {
    expect(validateBrowserProviders({ browserProviders: [value, provider], integrity })).toEqual([invalid({ message: 'Browser provider must be an object.' })]);
  });
  it.each(['client/chart.js', 'client/chart.mjs'])('accepts a digest-covered script with optional CSS: %s', javascript => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, javascript, stylesheet: 'client/chart.css' }], integrity })).toEqual([]);
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, javascript }], integrity })).toEqual([]);
  });
  it('collects every declaration error in field order, then continues across entries', () => {
    expect(validateBrowserProviders({ browserProviders: [null, {
      ...provider, trust: 'built-in', id: '', kind: 'table', contractVersion: 2, kinds: [], javascript: '../escape.js', stylesheet: null,
    }, provider, provider], integrity })).toEqual([
      invalid({ message: 'Browser provider must be an object.' }),
      invalid({ message: 'Unknown browser provider field.' }),
      invalid({ message: 'Browser provider id must be unique and non-empty.' }),
      invalid({ message: 'Only chart contractVersion 1 is supported.' }),
      invalid({ message: 'Chart kinds must be unique non-empty strings.' }),
      invalid({ message: 'Browser provider javascript must name a digest-covered client asset.' }),
      invalid({ message: 'Browser provider stylesheet must name a digest-covered client asset.' }),
      invalid({ message: 'Browser provider id must be unique and non-empty.' }),
    ]);
  });
  it.each([undefined, 1, '', 'Bad', '-chart', 'a_b'])('rejects malformed ids: %j', id => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, id }], integrity })).toEqual([
      invalid({ message: 'Browser provider id must be unique and non-empty.' }),
    ]);
  });
  it('permits digit, dot and hyphen segments in distinct ids', () => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, id: '0.foo-bar' }, provider], integrity })).toEqual([]);
  });
  it.each([{ kind: 'table' }, { contractVersion: 2 }])('rejects an unsupported chart contract: %j', changes => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, ...changes }], integrity })).toEqual([
      invalid({ message: 'Only chart contractVersion 1 is supported.' }),
    ]);
  });
  it.each([undefined, 'bar', [], ['bar', 1], ['bar', ' '], ['bar', 'bar']].map(kinds => ({ kinds })))('rejects malformed kinds: %j', ({ kinds }) => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, kinds }], integrity })).toEqual([
      invalid({ message: 'Chart kinds must be unique non-empty strings.' }),
    ]);
  });
  it('compares kinds literally while using trimming only to reject blank strings', () => {
    expect(validateBrowserProviders({ browserProviders: [{ ...provider, kinds: ['bar', ' bar ', 'Bar'] }], integrity })).toEqual([]);
  });
  it.each(['javascript', 'stylesheet'] as const)('enforces every asset constraint for %s', key => {
    for (const file of [undefined, null, 1, '', 'client/../chart.js', '/client/chart.js', 'client\\chart.js', 'https://site/chart.js', 'other/chart.js', 'client/chart.txt', 'client/missing.js']) {
      if (key === 'stylesheet' && file === undefined) continue;
      expect(validateBrowserProviders({ browserProviders: [{ ...provider, [key]: file }], integrity })).toEqual([
        invalid({ message: `Browser provider ${key} must name a digest-covered client asset.` }),
      ]);
    }
    for (const hash of [undefined, 'sha256-bad', `sha256-${'AB'.repeat(32)}`, `sha512-${'ab'.repeat(32)}`]) {
      const file = key === 'javascript' ? 'client/chart.js' : 'client/chart.css';
      expect(validateBrowserProviders({ browserProviders: [{ ...provider, [key]: file }], integrity: { ...integrity, [file]: hash } })).toEqual([
        invalid({ message: `Browser provider ${key} must name a digest-covered client asset.` }),
      ]);
    }
  });
  it.each(['', '/client/chart.js', 'client//chart.js', 'client/./chart.js', 'client/../chart.js', 'client/chart.js/', 'client\\chart.js', 'file:chart.js', 'client/\u0000.js', 'client/\u001f.js'])('refuses non-portable relative paths: %j', path => {
    expect(isPluginRelativePath({ path })).toBe(false);
  });
  it('accepts nested portable paths', () => {
    expect(isPluginRelativePath({ path: 'client/charts/bar.mjs' })).toBe(true);
  });
});
