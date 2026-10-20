import { describe, expect, it } from 'vitest';
import { parseFlags, positionalArgs } from '../flags.js';

// Characterization pins for flags.ts's parseFlags/positionalArgs, written
// against the pre-refactor code.

const S = (...names: string[]): ReadonlySet<string> => new Set(names);

describe('parseFlags pins', () => {
  it('keeps everything after the first "=" as the value, including further "="', () => {
    expect(parseFlags({ argv: ['--k=a=b'] })).toEqual({ k: 'a=b' });
  });

  it('accepts an empty inline value', () => {
    expect(parseFlags({ argv: ['--k='] })).toEqual({ k: '' });
  });

  it('gives a boolean-declared flag its inline string value', () => {
    expect(parseFlags({ argv: ['--b=no'] }, { boolean: S('b') })).toEqual({ b: 'no' });
  });

  it('lets a string-declared flag consume a flag-looking next token', () => {
    expect(parseFlags({ argv: ['--s', '--other'] }, { string: S('s') })).toEqual({ s: '--other' });
  });

  it('lets a string-declared flag consume an empty-string next token', () => {
    expect(parseFlags({ argv: ['--s', ''] }, { string: S('s') })).toEqual({ s: '' });
  });

  it('heuristic mode consumes a single-dash next token as the value', () => {
    expect(parseFlags({ argv: ['--n', '-5'] })).toEqual({ n: '-5' });
  });

  it('a bare "--" is parsed as the empty-named flag in heuristic mode', () => {
    expect(parseFlags({ argv: ['--', 'x'] })).toEqual({ '': 'x' });
  });

  it('rejects an unknown inline flag with the key before "=" in strict mode', () => {
    expect(() => parseFlags({ argv: ['--nope=1'] }, { boolean: S('b') })).toThrow(
      'unknown flag: --nope. Run with --help for the list of accepted flags.',
    );
  });

  it('rejects in strict mode when only the string set is given', () => {
    expect(() => parseFlags({ argv: ['--x'] }, { string: S('s') })).toThrow('unknown flag: --x.');
  });

  it('reports the missing value with the flag name', () => {
    expect(() => parseFlags({ argv: ['--s'] }, { string: S('s') })).toThrow('flag --s requires a value');
  });

  it('a flag in both sets is treated as boolean', () => {
    expect(parseFlags({ argv: ['--x', 'v'] }, { string: S('x'), boolean: S('x') })).toEqual({ x: true });
  });

  it('empty provided sets mean heuristic mode', () => {
    expect(parseFlags({ argv: ['--anything', 'v'] }, { string: S(), boolean: S() })).toEqual({ anything: 'v' });
  });

  it('single-dash tokens are skipped as positionals', () => {
    expect(parseFlags({ argv: ['-v', '--b'] }, { boolean: S('b') })).toEqual({ b: true });
  });
});

describe('positionalArgs pins', () => {
  it('collects single-dash tokens as positionals', () => {
    expect(positionalArgs({ argv: ['-v', 'x'] })).toEqual(['-v', 'x']);
  });

  it('a trailing string flag with no value collects nothing more', () => {
    expect(positionalArgs({ argv: ['a', '--s'] }, { string: S('s') })).toEqual(['a']);
  });

  it('a string flag skips a flag-looking next token too', () => {
    expect(positionalArgs({ argv: ['--s', '--t', 'a'] }, { string: S('s') })).toEqual(['a']);
  });

  it('with stopAtDoubleDash, a string flag swallows a following "--" as its value', () => {
    expect(positionalArgs({ argv: ['--s', '--', 'a'] }, { string: S('s'), stopAtDoubleDash: true })).toEqual(['a']);
  });

  it('with stopAtDoubleDash and nothing after "--", collects nothing more', () => {
    expect(positionalArgs({ argv: ['a', '--'] }, { stopAtDoubleDash: true })).toEqual(['a']);
  });

  it('stopAtDoubleDash=false behaves like unset', () => {
    expect(positionalArgs({ argv: ['--', 'a', '--x'] }, { stopAtDoubleDash: false })).toEqual(['a']);
  });
});
