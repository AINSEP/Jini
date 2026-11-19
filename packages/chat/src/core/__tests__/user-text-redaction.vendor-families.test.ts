import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

// The parity corpus leaves vendor key shapes out (their literals look like real keys to repository secret scanning), so
// this sweep builds obviously fake keys of each family at runtime and checks chat hides all of each key in every context
// the corpus sweep uses. Nothing of a key may stay visible: no whole key and no 6+ character piece of its body.
const tail = (length: number, alphabet = 'aB3xK9'): string => alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);
const FAMILIES: readonly (readonly [string, string])[] = [
  ['AWS access key id', ['AK', 'IA'].join('') + tail(16, 'Q7ZX2M')],
  ['GitHub token', ['gh', 'p_'].join('') + tail(36)],
  ['Slack token', ['xo', 'xb-'].join('') + `${tail(11, '1234567890')}-${tail(24)}`],
  ['OpenAI-style key', ['s', 'k-'].join('') + tail(48)],
  ['Anthropic key', ['sk-', 'ant-'].join('') + tail(95)],
  ['Stripe key', ['sk_', 'live_'].join('') + tail(24)],
  ['Google API key', ['AI', 'za'].join('') + tail(35)],
  ['JWT', ['ey', 'J'].join('') + `${tail(20)}.${['ey', 'J'].join('')}${tail(30)}.${tail(43)}`],
];
const PEM_TYPE = ['RSA PRIV', 'ATE KEY'].join('');
const PEM = `-----BEGIN ${PEM_TYPE}-----\n${tail(64)}\n${tail(40)}\n-----END ${PEM_TYPE}-----`;
const CONTEXTS: readonly (readonly [string, string])[] = [
  ['', ''], ['Hey, my key is ', ' thanks'], ['- ', ''], ['1. ', '\n2. Notes: x'], ['{"value":"', '"}'], ['export VALUE=', ''],
  ['--value ', ' --verbose'], ['curl -H "X-Custom: ', '" https://x.test'],
];

const pieces = (key: string): string[] => {
  const body = key.replace(/[^A-Za-z0-9]/g, ' ').split(' ').filter(Boolean).join('');
  return Array.from({ length: Math.max(0, body.length - 5) }, (_unused, at) => body.slice(at, at + 6));
};
const shown = (input: string, key: string): string[] => {
  const out = redactUserText({ text: input }).text.replace(/[^A-Za-z0-9]/g, '');
  return pieces(key).filter(piece => out.includes(piece)).slice(0, 3);
};

describe('vendor key families in chat text', () => {
  it.each(FAMILIES.flatMap(([family, key]) => CONTEXTS.map(([before, after]) => [family, `${before}${key}${after}`, key] as const)))(
    'hides all of a %s in %j', (_family, input, key) => {
      expect(shown(input, key)).toEqual([]);
    });

  it.each(CONTEXTS)('hides all of a PEM private key block between %j and %j', (before, after) => {
    expect(shown(`${before}${PEM}${after}`, `${tail(64)}${tail(40)}`)).toEqual([]);
  });
});
