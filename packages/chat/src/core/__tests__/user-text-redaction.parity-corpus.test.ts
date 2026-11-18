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
    readonly hidden: readonly (readonly number[])[];
  };
  readonly keep: readonly string[];
}
const corpus = JSON.parse(readFileSync(new URL('./fixtures/redaction-parity-corpus.json', import.meta.url), 'utf8')) as Corpus;

// The tokenizer the corpus was recorded with: 4+ characters between separators, lower-cased, first occurrence order.
const tokens = (text: string): string[] => [...new Set(text.toLowerCase().match(/[^\s"'`,;:=&?()<>[\]{}\\]{4,}/g) ?? [])];

function sweepInputs({ sweep }: Pick<Corpus, 'sweep'>): string[] {
  const inputs: string[] = [];
  for (const label of sweep.labels) for (const separator of sweep.separators) for (const value of sweep.values) {
    for (const [before, after] of sweep.contexts) inputs.push(`${before}${before === '{"' ? `${label}"` : label}${separator}${value}${after}`);
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
// The same class in the sweep: `name=` or `name:` with nothing after it, then a line that is its own `key=value`.
const NEXT_LINE_IS_ASSIGNMENT = /[:=][ \t]*(?:\r?\n[ \t]*)+[\w.-]+=/;

const shownTokens = (input: string, hidden: readonly string[]): string[] => {
  const out = redactUserText({ text: input }).text.toLowerCase();
  return hidden.filter(token => out.includes(token));
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
      const input = inputs[index!]!;
      if (NEXT_LINE_IS_ASSIGNMENT.test(input)) return [];
      const all = tokens(input);
      return shownTokens(input, positions.map(position => all[position]!)).map(token => ({ input, token }));
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
