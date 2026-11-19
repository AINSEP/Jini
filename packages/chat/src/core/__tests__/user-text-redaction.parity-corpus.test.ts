import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

// Chat's user-text redaction moved from the diagnostics rules plus chat's own rules (base 4c189236) onto core's shared
// engine. Two review rounds each found inputs the old redactor masked and the engine showed, one class at a time. This
// corpus holds the old redactor's answers instead: every token it hid must stay hidden, every prose line it kept must
// stay kept. A new finding is added here (and to core's own tests), not only patched. See fixtures/ for how it was made.
interface Corpus {
  readonly mask: readonly (readonly string[])[];
  readonly sweep: {
    readonly labels: readonly string[];
    readonly separators: readonly string[];
    readonly values: readonly string[];
    readonly contexts: readonly (readonly [string, string])[];
    /** `[input index, ...hidden]`: a number is a position in the input's tokens, a string a piece of a token. */
    readonly hidden: readonly (readonly (number | string)[])[];
  };
  readonly keep: readonly string[];
}
const corpus = JSON.parse(readFileSync(new URL('./fixtures/redaction-parity-corpus.json', import.meta.url), 'utf8')) as Corpus;

// The tokenizer the corpus was recorded with: any run between separators that holds a letter or digit, lower-cased, in
// first occurrence order, with redaction markers removed first so a marker's own words never count as shown text.
const MARKER = /\[(?:REDACTED:[^\]\r\n]+|token removed)\]/gi;
const tokens = (text: string): string[] => [...new Set(text.replace(MARKER, ' ').toLowerCase().match(/[^\s"'`,;:=&?()<>[\]{}\\]+/g) ?? [])]
  .filter(token => /[a-z0-9]/.test(token));

function sweepInputs({ sweep }: Pick<Corpus, 'sweep'>): { readonly input: string; readonly excused: readonly string[] }[] {
  const inputs: { input: string; excused: readonly string[] }[] = [];
  for (const label of sweep.labels) for (const separator of sweep.separators) for (const value of sweep.values) {
    for (const [before, after] of sweep.contexts) {
      inputs.push({ input: `${before}${before === '{"' ? `${label}"` : label}${separator}${value}${after}`, excused: sweepExcused({ separator, value }) });
    }
  }
  return inputs;
}

// Differences the owner accepted in the first two rounds; none shows a credential value. Each names its class.
const DECIDED: Readonly<Record<string, string>> = {
  'Authorization: Basic.': 'a scheme word alone describes a header',
  'x-api-key: Bearer.': 'a scheme word alone describes a header',
  'Authorization: Bearer <API_KEY>': 'a documentation placeholder',
  'Token v2.0.14-rc1abcdefgh released': 'a release id after Token',
  'release Token 2024.11.18.build1234567': 'a release id after Token',
  'Token 1.2.3-beta.4567890123': 'a release id after Token',
  'the Token 10.4.0.rc1.build987654321 shipped': 'a release id after Token',
  'https://user:pw@host.example.com,bob@example.com': 'the host and contact address after URL credentials',
  'https://user:pw@host.example.com;bob@example.com': 'the host and contact address after URL credentials',
  '(https://user:pw@host.example.com)bob@example.com': 'the host and contact address after URL credentials',
  '<https://user:pw@host.example.com>,bob@example.com': 'the host and contact address after URL credentials',
  '"https://user:pw@host.example.com",bob@example.com': 'the host and contact address after URL credentials',
  'token=secret=[REDACTED:labeled_secret]': 'a label word beside a masked value',
  'api_key: token=secret=[REDACTED:labeled_secret]': 'a label word beside a masked value',
  'primary-backup-service-account-api-key=Zq8wPx3mK7vR2tL9': 'the variable name before a masked value',
  'DB_PASSWORD=\nDB_USER=app': 'the next line is another assignment',
};
// The same class in the sweep, named exactly: `name=` and a line break, then the one sweep value that is itself a
// `key=value` line. Only that line's own tokens are excused; every other hidden piece of those inputs is still checked.
const SWEEP_DECIDED: readonly { readonly separators: readonly string[]; readonly value: string; readonly reason: string }[] = [
  { separators: ['=\n', '=\r\n  '], value: 'sid=Zq8w; auth=Mf4n', reason: 'the next line is another assignment' },
];
const sweepExcused = ({ separator, value }: { separator: string; value: string }): readonly string[] =>
  SWEEP_DECIDED.some(decided => decided.value === value && decided.separators.includes(separator)) ? tokens(value) : [];

/** Hidden pieces the redactor shows, whole or in part. The corpus records what the old redactor hid as pieces: an input
 * token minus any part of it the old output still showed beside a marker (`[token removed]@host` showed `@host`). A piece
 * is shown when it is an output token; when it is a split piece (not an input token itself) and an output token holds it
 * (4+ characters, so a one-letter piece is not found inside every word), as when the whole input token is shown again; or
 * when a part (an output token that is not an input token, split off by a marker) is a piece of it: a partial disclosure. */
// Decided in rounds 1-2: an auth scheme word right before a masked value stays readable (`x=Token [token removed]`). The
// old redactor hid it with the value. Only that position is excused; the same word as the value itself is still checked.
const SCHEME_WORDS: ReadonlySet<string> = new Set(['bearer', 'token', 'basic', 'digest', 'apikey']);
const isSchemeBeforeMarker = (text: string, piece: string): boolean =>
  SCHEME_WORDS.has(piece) && new RegExp(`\\b${piece}\\s+\\[(?:REDACTED:|token removed\\])`, 'i').test(text);

const shownTokens = (input: string, hidden: readonly string[]): string[] => {
  const text = redactUserText({ text: input }).text;
  const out = tokens(text);
  const whole = new Set(tokens(input));
  const parts = out.filter(token => !whole.has(token));
  return hidden.filter(piece => !isSchemeBeforeMarker(text, piece))
    .filter(piece => out.some(token => token === piece || (!whole.has(piece) && piece.length >= 4 && token.includes(piece)))
      || parts.some(part => piece.includes(part)));
};
const sweepPieces = (input: string, hidden: readonly (number | string)[]): string[] => {
  const all = tokens(input);
  return hidden.map(item => typeof item === 'number' ? all[item]! : item);
};

describe('parity with the chat redactor before the move onto core', () => {
  it(`hides every token the old redactor hid in ${corpus.mask.length} recorded inputs`, () => {
    const shown = corpus.mask.filter(([input]) => !(input! in DECIDED))
      .flatMap(([input, ...hidden]) => shownTokens(input!, hidden).map(token => ({ input, token })));
    expect(shown).toEqual([]);
  });

  it(`hides every token the old redactor hid in ${corpus.sweep.hidden.length} generated inputs`, () => {
    const inputs = sweepInputs(corpus);
    const shown = corpus.sweep.hidden.flatMap(([index, ...positions]) => {
      const { input, excused } = inputs[index as number]!;
      const checked = sweepPieces(input, positions).filter(piece => !excused.includes(piece));
      return shownTokens(input, checked).map(token => ({ input, token }));
    });
    expect(shown).toEqual([]);
  });

  it(`keeps ${corpus.keep.length} prose lines the old redactor kept`, () => {
    expect(corpus.keep.filter(text => redactUserText({ text }).text !== text)).toEqual([]);
  });

  it('lists only decided differences that are in the corpus', () => {
    const recorded = new Set(corpus.mask.map(([input]) => input));
    expect(Object.keys(DECIDED).filter(input => !recorded.has(input))).toEqual([]);
  });
});
