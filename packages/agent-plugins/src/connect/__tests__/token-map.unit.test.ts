import { describe, expect, test } from 'vitest';
import { decodeTokenSignInEntries, parsePluginTokenMap, tokensForCreate, type TokenMapLimits } from '../../core/token-map.js';

const limits: TokenMapLimits = { pluginIdPattern: /^[a-z0-9][a-z0-9-]{0,63}$/, maxTokens: 8, maxTokenLength: 4096 };
const parse = (raw: unknown, over: Partial<TokenMapLimits> = {}) => parsePluginTokenMap({ raw, limits: { ...limits, ...over } });
const REFUSED = { ok: false };

describe('parsePluginTokenMap', () => {
  test('absent input is "none given"; values are trimmed and blanks dropped', () => {
    expect(parse(undefined)).toEqual({ ok: true, tokens: {} });
    expect(parse(null)).toEqual({ ok: true, tokens: {} });
    expect(parse({ github: '  tok  ', vercel: '   ', resend: '' })).toEqual({ ok: true, tokens: { github: 'tok' } });
  });

  test('at most maxTokens entries: the count is checked before any entry', () => {
    const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`, 't']));
    expect(parse(eight)).toMatchObject({ ok: true });
    expect(parse({ ...eight, p8: 't' })).toEqual(REFUSED);
    // a ninth blank entry still counts: the limit bounds the work, not the surviving tokens
    expect(parse({ ...eight, p8: '' })).toEqual(REFUSED);
  });

  test('a token may be maxTokenLength long, measured before trimming', () => {
    expect(parse({ github: 'x'.repeat(4096) })).toMatchObject({ ok: true });
    expect(parse({ github: 'x'.repeat(4097) })).toEqual(REFUSED);
    expect(parse({ github: ` ${'x'.repeat(4096)}` })).toEqual(REFUSED);
  });

  test('the plugin id must match the host-supplied pattern, anchored at both ends', () => {
    for (const id of ['a', '0', 'a-b', `a${'b'.repeat(63)}`]) expect(parse({ [id]: 't' })).toEqual({ ok: true, tokens: { [id]: 't' } });
    for (const id of ['', '-a', 'A', 'a_b', 'a.b', 'a\n', ' a', 'a ', `a${'b'.repeat(64)}`, '../x', '__proto__']) {
      expect(parse({ [id]: 't' }), JSON.stringify(id)).toEqual(REFUSED);
    }
  });

  test('a host pattern that admits dots is honoured, not replaced by a default', () => {
    const dotted = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
    expect(parse({ 'acme.mail': 't' }, { pluginIdPattern: dotted })).toEqual({ ok: true, tokens: { 'acme.mail': 't' } });
    expect(parse({ 'acme.mail': 't' })).toEqual(REFUSED);
  });

  test('wrong shapes are refused, never coerced', () => {
    for (const raw of [[], ['t'], 'github=t', 5, true, { github: 5 }, { github: null }, { github: ['t'] }, { ok: 't', bad: {} }]) {
      expect(parse(raw), JSON.stringify(raw)).toEqual(REFUSED);
    }
  });

  test('a refusal carries no token text', () => {
    const secret = 'sk-live-very-secret';
    for (const raw of [{ github: secret, Bad: secret }, { github: secret, n: 5 }, Array(9).fill(secret)]) {
      expect(JSON.stringify(parse(raw))).not.toContain(secret);
    }
  });

  test('"constructor" is a legal id under this pattern and stays an ordinary key', () => {
    const result = parse({ constructor: 't' });
    if (!result.ok) throw new Error('expected an accepted map');
    expect(Object.keys(result.tokens)).toEqual(['constructor']);
    expect(result.tokens.constructor).toBe('t');
  });

  test('the accepted map has no prototype, so an id can never reach Object.prototype', () => {
    const result = parse({ github: 't' });
    if (!result.ok) throw new Error('expected an accepted map');
    expect(Object.getPrototypeOf(result.tokens)).toBeNull();
    // a host pattern that (wrongly) admits "__proto__" must still not pollute
    const loose = parse(JSON.parse('{"__proto__":"t"}'), { pluginIdPattern: /^[a-z_]+$/ });
    expect(({} as Record<string, unknown>).t).toBeUndefined();
    if (!loose.ok) throw new Error('expected the loose pattern to accept');
    expect(Object.keys(loose.tokens)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe('decodeTokenSignInEntries', () => {
  const pluginIdPattern = limits.pluginIdPattern;
  const good = { pluginId: 'supabase', displayName: 'Supabase', helpUrl: 'https://supabase.com/dashboard/account/tokens' };
  const decode = (entries: unknown) => decodeTokenSignInEntries({ entries, pluginIdPattern });

  test('keeps only well-formed entries with an https help link', () => {
    expect(decode([
      good,
      { pluginId: 'evil', displayName: 'Evil', helpUrl: 'javascript:alert(1)' },
      { pluginId: 'plain', displayName: 'Plain', helpUrl: 'http://example.test' },
      { pluginId: 'Bad Id', displayName: 'x', helpUrl: 'https://x' },
      { pluginId: 5, displayName: 'x', helpUrl: 'https://x' },
      { pluginId: 'noname', displayName: 5, helpUrl: 'https://x' },
      { pluginId: 'nourl', displayName: 'x', helpUrl: undefined },
      null,
      undefined,
      'github',
    ])).toEqual([good]);
  });

  test('the https check is anchored at the start', () => {
    expect(decode([{ ...good, helpUrl: 'javascript:https://x' }])).toEqual([]);
    expect(decode([{ ...good, helpUrl: ' https://x' }])).toEqual([]);
  });

  test('anything but an array is no entries', () => {
    for (const entries of [undefined, null, 'supabase', 5, { 0: good }]) expect(decode(entries)).toEqual([]);
  });

  test('extra fields are not carried over', () => {
    expect(decode([{ ...good, secret: 'x' }])).toEqual([good]);
  });
});

describe('tokensForCreate', () => {
  test('trimmed, blanks dropped, undefined when nothing was typed', () => {
    expect(tokensForCreate({ values: { supabase: '  sbp_x  ', crm: '   ' } })).toEqual({ supabase: 'sbp_x' });
    expect(tokensForCreate({ values: { supabase: '' } })).toBeUndefined();
    expect(tokensForCreate({ values: {} })).toBeUndefined();
  });
});
