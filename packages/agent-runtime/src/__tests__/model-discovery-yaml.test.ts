import { describe, expect, it } from 'vitest';

import { yamlModelCapture } from '../model-discovery-yaml.js';

/** The regex the linear scan replaces; the scan must return exactly what its group captures. */
const ORIGINAL = /^model\s*:\s*["']?([^\n"'#]+)["']?\s*(?:#.*)?$/m;
const original = (raw: string): string | undefined => ORIGINAL.exec(raw)?.[1];

describe('yamlModelCapture', () => {
  it.each([
    ['model: gpt-5', 'gpt-5'],
    ['model: "quoted-model"', 'quoted-model'],
    ["model: 'single'", 'single'],
    ['model: x # trailing comment', 'x '],
    ['other: 1\nmodel:   spaced  \nnext: 2', 'spaced  '],
    ['name: a\r\nmodel: crlf\r\n', 'crlf\r'],
    ['model:\n', undefined],
    ['model:', undefined],
    ['', undefined],
    ['  model: indented', undefined],
    ['modelx: 1', undefined],
    ['model "no-colon"', undefined],
    ['model: ""', undefined],
    ['model: #only-comment', ' '],
  ])('reads %j as %j', (raw, expected) => {
    expect(yamlModelCapture(raw)).toBe(expected);
    expect(original(raw)).toBe(expected);
  });

  it('lets the value start inside the whitespace after the colon, as the regex backtracks', () => {
    expect(yamlModelCapture('model:\nmodel: second')).toBe('model: second');
    expect(original('model:\nmodel: second')).toBe('model: second');
  });

  it('agrees with the original regex on every short string over a hostile alphabet (differential)', () => {
    const tokens = ['model', ':', ' ', '\n', '\r', ' ', ' ', '"', "'", '#', 'a'];
    const mismatches: string[] = [];
    let checked = 0;
    const walk = (prefix: string, depth: number): void => {
      checked += 1;
      const actual = yamlModelCapture(prefix);
      const expected = original(prefix);
      if (actual !== expected && mismatches.length < 5) {
        mismatches.push(`${JSON.stringify(prefix)}: scan=${JSON.stringify(actual)} regex=${JSON.stringify(expected)}`);
      }
      if (depth === 0) return;
      for (const token of tokens) walk(prefix + token, depth - 1);
    };
    for (const lead of ['', 'model', 'model:', 'x\nmodel:', 'model: ', 'model:\r']) walk(lead, lead === '' ? 5 : 4);
    expect(checked).toBeGreaterThan(100_000);
    expect(mismatches).toEqual([]);
  });

  it('stays linear on a long whitespace run (the regression the scan exists to prevent)', () => {
    const raw = `model:${' '.repeat(200_000)}\n`;
    const started = Date.now();
    expect(yamlModelCapture(raw)).toBe(original(`model:${' '.repeat(50)}\n`));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
