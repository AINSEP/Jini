import { describe, expect, it } from 'vitest';

import { AGENT_FAILURE_SECRET_SHAPE_RE, GENERATED_MARKER_RE, redactSecrets, redactSecretsWithCounts } from '../redact.js';
import { sanitizeUntrustedText } from '../text/sanitize-untrusted-text.js';
import { expectLinearTime } from './fixtures/linear-time.js';

// Characterization pins for redactSecretsWithCounts: span union over the original text, the
// merged-span category rule and linear-time guards. Every credential-shaped value is built at
// runtime so no literal secret shape is committed.

const npmToken = (): string => ['np', 'm_'].join('') + 'n'.repeat(36);
const githubToken = (): string => ['gh', 'p_'].join('') + 'g'.repeat(36);
const skPrefix = (): string => ['s', 'k-'].join('') + 's'.repeat(20);
const jwt = (): string => ['ey', 'J'].join('') + 'hdr.' + ['ey', 'J'].join('') + 'pay.sig';

describe('@jini-ai/core — redact — characterization pins', () => {
  it('masks a provider api-key header the core header rule cannot anchor, keeping its separator', () => {
    expect(redactSecretsWithCounts({ input: 'my-x-api-key=abc123 tail' })).toEqual({
      redacted: 'my-x-api-key=[REDACTED:api_key_header] tail',
      counts: { api_key_header: 1 },
    });
  });

  it('leaves an already-masked provider api-key header value alone and uncounted', () => {
    const once = redactSecrets({ input: 'my-x-api-key=abc123' });
    expect(redactSecretsWithCounts({ input: once })).toEqual({ redacted: once, counts: {} });
  });

  it('masks exact secrets longest first so a shorter secret cannot split a longer one', () => {
    expect(redactSecretsWithCounts({ input: 'abcdef abc' }, { exactSecrets: ['abc', 'abcdef'] })).toEqual({
      redacted: '[REDACTED:exact_secret] [REDACTED:exact_secret]',
      counts: { exact_secret: 2 },
    });
  });

  // Every rule matches the ORIGINAL text and overlapping/adjacent spans merge, so no rule's
  // leftover can expose part of another's value. A short secret may still split a label word
  // visually; the case passes as long as no real value survives.
  it.each([
    ['a short secret inside a label', 'a; password=hunter2 pa', ['a', 'pa'], ['hunter2'],
      '[REDACTED:exact_secret]; [REDACTED:exact_secret]ssword=[REDACTED:labeled_secret] [REDACTED:exact_secret]'],
    ['a secret that is itself a label name', 'api_key=hunter2', ['api_key'], ['hunter2'],
      '[REDACTED:exact_secret]=[REDACTED:labeled_secret]'],
    ['a secret that ends in a label and its separator', 'note password=hunter2', ['note password='], ['hunter2'],
      '[REDACTED:exact_secret]'],
    ['a short secret glued inside other text', 'Rejected prefixabcSuffix', ['abc'], [],
      'Rejected prefix[REDACTED:exact_secret]Suffix'],
    ['forged marker text redact never generates', 'Rejected [REDACTED:s3cr3t99] [redacted:s3cr3t99]', ['s3cr3t99'], [],
      'Rejected [REDACTED:[REDACTED:exact_secret]] [redacted:[REDACTED:exact_secret]]'],
    ['a secret shaped like a URL scheme', 'Rejected s3cr3t99://host', ['s3cr3t99'], [],
      'Rejected [REDACTED:exact_secret]://host'],
    ['a secret after a Bearer prefix', 'Authorization: Bearer s3cr3t99', ['s3cr3t99'], [],
      'Authorization: Bearer [REDACTED:bearer_token]'],
    ['a one-letter secret inside a URL scheme', 'see https://user:pw@host', ['s'], ['user', 'pw'],
      '[REDACTED:exact_secret]ee http[REDACTED:exact_secret]://[REDACTED:url_credentials]@ho[REDACTED:exact_secret]t'],
    ['a one-letter secret inside a query name', 'GET /x?key=v4lue', ['k'], ['v4lue'],
      'GET /x?[REDACTED:exact_secret]ey=[REDACTED:api_key_query]'],
    ['a one-letter secret inside a Bearer prefix', 'Bearer hunter2', ['e'], ['hunter2'],
      'B[REDACTED:exact_secret]ar[REDACTED:exact_secret]r [REDACTED:bearer_token]'],
    // Marker text in the input gets no protection: an overlapping secret is simply covered.
    ['a secret named like a generated marker', 'email [REDACTED:email]', ['email'], [],
      '[REDACTED:exact_secret] [REDACTED:[REDACTED:exact_secret]]'],
    ['a secret overlapping marker text in the input', '[REDACTED:email]hunter2', ['email]hunter2'], [],
      '[REDACTED:[REDACTED:exact_secret]'],
    ['a secret overlapping a generated marker', 'mail me@example.com!hunter2', ['com!hunter2'], ['me@example'],
      'mail [REDACTED:email]'],
    ['a secret named like a marker with another case', '[REDACTED:EMAIL]', ['EMAIL'], [],
      '[REDACTED:[REDACTED:exact_secret]]'],
    // The label, vendor, query and bearer rules each stop partway through these.
    ['a secret with spaces after a label', 'password=correct horse battery', ['correct horse battery'], ['horse battery'],
      'password=[REDACTED:exact_secret]'],
    ['a dotted secret glued onto a vendor-shaped token', `${skPrefix()}abc.def.ghi.jkl.mno`, ['abc.def.ghi.jkl.mno'], ['.def.ghi'],
      '[REDACTED:sk_key]'],
    ['a 16+ char secret after api_key=', `GET /x?api_key=${'Q'.repeat(8)}&${'q'.repeat(8)}`, [`${'Q'.repeat(8)}&${'q'.repeat(8)}`], ['q'.repeat(8)],
      'GET /x?api_key=[REDACTED:exact_secret]'],
    ['a short secret with & after api_key=', 'GET /x?api_key=abc&hunter2', ['abc&hunter2'], ['&hunter2'],
      'GET /x?api_key=[REDACTED:exact_secret]'],
    ['a short secret with ! after Bearer', 'Bearer abc!hunter2', ['abc!hunter2'], ['!hunter2'],
      'Bearer [REDACTED:exact_secret]'],
    ['a short secret with a unicode delimiter after Bearer', 'Bearer abcéhunter2', ['abcéhunter2'], ['hunter2'],
      'Bearer [REDACTED:exact_secret]'],
    ['two overlapping secrets', 'x abcdef y', ['abcd', 'cdef'], ['ef'],
      'x [REDACTED:exact_secret] y'],
    ['a secret echoed JSON-escaped', '{"error":"bad ab\\"cd"}', ['ab"cd'], [],
      '{"error":"bad [REDACTED:exact_secret]"}'],
    // Inside quotes only the closing quote ends a labeled value; an unclosed quote runs to the line end.
    ['a vendor token before ; inside a quoted label value', `password="${skPrefix()};hunter2"`, [], ['hunter2'],
      'password=[REDACTED:labeled_secret]'],
    ['a vendor token before a space inside a quoted label value', `password="${skPrefix()} hunter2" next`, [], ['hunter2'],
      'password=[REDACTED:labeled_secret] next'],
    ['one byte after a vendor token in an unclosed quoted label value', `password="${skPrefix()}%`, [], ['%'],
      'password=[REDACTED:labeled_secret]'],
    ['an unclosed quoted label value with spaces', `password="${skPrefix()};hunter2 battery\nnext`, [], ['hunter2', 'battery'],
      'password=[REDACTED:labeled_secret]\nnext'],
    // Text glued after a closing quote stays in the value, up to whitespace or ; & , like an unquoted value.
    ['a suffix glued after a quoted header value with spaces', 'api-key="abc def"hunter2', [], ['abc', 'def', 'hunter2'],
      'api-key=[REDACTED:labeled_secret]'],
    ['a suffix glued after a quoted label value with spaces', 'password="abc def"hunter2;next=1', [], ['abc', 'def', 'hunter2'],
      'password=[REDACTED:labeled_secret];next=1'],
    // A backslash-escaped quote does not close a quoted value; an escaped backslash before a quote does not escape it.
    ['an escaped quote inside a quoted label value', 'password="abc\\" hunter2"', [], ['abc', 'hunter2'],
      'password=[REDACTED:labeled_secret]'],
    ['an escaped quote inside a quoted header value', 'api-key="abc\\" hunter2" next', [], ['abc', 'hunter2'],
      'api-key=[REDACTED:labeled_secret] next'],
    ['an escaped quote inside a single-quoted label value', "password='abc\\' hunter2'", [], ['abc', 'hunter2'],
      'password=[REDACTED:labeled_secret]'],
    ['an escaped backslash then an escaped quote inside a quoted label value', 'password="abc\\\\\\" hunter2" next', [], ['abc', 'hunter2'],
      'password=[REDACTED:labeled_secret] next'],
    ['an escaped backslash before the closing quote of a label value', 'password="abc\\\\" next', [], ['abc'],
      'password=[REDACTED:labeled_secret] next'],
    ['a JWT glued after a hyphen', `token-${jwt()}`, [], ['hdr', 'pay', 'sig'],
      'token-[REDACTED:jwt]'],
    ['URL userinfo after a scheme longer than 32 characters', `a${'1'.repeat(40)}://user:pw@host`, [], ['user', 'pw'],
      `a${'1'.repeat(40)}://[REDACTED:url_credentials]@host`],
    ['overlapping occurrences of one secret', 'x ababa y', ['aba'], ['ba'],
      'x [REDACTED:exact_secret] y'],
    ['a chain of overlapping occurrences of one secret', 'x abababab abab y', ['abab'], ['ba'],
      'x [REDACTED:exact_secret] [REDACTED:exact_secret] y'],
  ])('leaves no secret value in %s', (_label, input, exactSecrets, otherValues, expected) => {
    const redacted = redactSecrets({ input }, { exactSecrets });
    expect(redacted).toBe(expected);
    const outsideMarkers = redacted.replace(GENERATED_MARKER_RE, '');
    const spellings = exactSecrets.flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1)]);
    for (const value of [...spellings, ...otherValues]) expect(outsideMarkers).not.toContain(value);
  });

  it('writes one marker, counted once, for merged overlapping spans', () => {
    expect(redactSecretsWithCounts({ input: 'note password=hunter2 abcdef' }, { exactSecrets: ['note password=', 'abcd', 'cdef'] }))
      .toEqual({ redacted: '[REDACTED:exact_secret] [REDACTED:exact_secret]', counts: { exact_secret: 2 } });
  });

  // 10 MiB MCP responses reach these paths synchronously; each input was quadratic. Three guards are
  // smaller than 10 MiB, still far past where the quadratic forms blew up: dense label fields yield
  // ~3 spans per 10 bytes, and the span pipeline (collect, sort, merge) alone needs ~3.5 s for
  // 10 MiB of them (the old rewinding scan took 7.6 s on 160 KB); scanning every offset of a 5 MiB
  // secret in 10 MiB takes ~470 ms warm, ~490 ms cold at 4 MiB (the old scan-from-every-hit took
  // 0.9 s on 64 KB); skipping an escaped quote every 3 bytes takes ~570 ms at 10 MiB, ~220 ms at 4 MiB.
  // These were `< 500 ms` wall-clock pins, which flaked under machine load; expectLinearTime checks
  // growth instead. The whitespace runs pin the bearer lookbehind (64 KiB of spaces took ~18 s).
  it.each([
    ['unterminated marker prefixes', 20_000, (n: number) => '[REDACTED:'.repeat(n), () => ['x']],
    ['many markers beside many exact matches', 20_000, (n: number) => '[redacted] x '.repeat(n), () => ['x']],
    ['a long dotted run (URL scheme and email local part)', 20_000, (n: number) => 'a.'.repeat(n), () => []],
    ['a 10 MiB run of JWT header prefixes', 2_621_440, (n: number) => 'eyJ-'.repeat(n), () => []],
    ['a 640 KiB run of covered label fields', 65_536, (n: number) => 'api-key=x;'.repeat(n), () => []],
    ['a 10 MiB run of scheme separators', 2_097_152, (n: number) => 'a://b'.repeat(n), () => []],
    ['a 4 MiB run of backslash-escaped quotes in a label value', 1_398_101,
      (n: number) => `password="${'\\\\\\"'.repeat(n)}`, () => []],
    ['a 2 MiB run holding a 1 MiB exact secret at every offset', 1_048_576, (n: number) => 'a'.repeat(2 * n),
      (n: number) => ['a'.repeat(n)]],
    ['1 MiB of spaces after Bearer', 1_048_576, (n: number) => `Authorization: Bearer${' '.repeat(n)}x`, () => []],
    ['a plain 1 MiB whitespace run', 1_048_576, (n: number) => ' '.repeat(n), () => []],
  ])('stays linear on %s', (_label, size, buildInput, buildExactSecrets) => {
    expectLinearTime({ size, prepare: (count) => {
      const input = buildInput(count);
      const exactSecrets = buildExactSecrets(count);
      return () => redactSecrets({ input }, { exactSecrets });
    } });
  });

  it('matches the agent-failure shapes in linear time on a 10 MiB run of JWT header prefixes', () => {
    const input = 'eyJ-'.repeat(2_621_440);
    expect(input.replace(AGENT_FAILURE_SECRET_SHAPE_RE, '[REDACTED]')).toBe(input);
    expectLinearTime({ size: 2_621_440, prepare: (count) => {
      const run = 'eyJ-'.repeat(count);
      return () => run.replace(AGENT_FAILURE_SECRET_SHAPE_RE, '[REDACTED]');
    } });
  });

  it('sanitizes unterminated marker prefixes in linear time', () => {
    expectLinearTime({ size: 160_000, prepare: (count) => {
      const text = '[REDACTED:'.repeat(count);
      return () => sanitizeUntrustedText({ text }, { maxLength: Infinity });
    } });
  });

  it('keeps a bearer token after a long whitespace run', () => {
    const token = 'b'.repeat(20);
    expect(redactSecrets({ input: `Authorization: Bearer${' '.repeat(100_000)}${token}` }))
      .toBe(`Authorization: Bearer${' '.repeat(100_000)}[REDACTED:bearer_token]`);
  });

  it('masks URL userinfo behind a scheme glued onto a long word', () => {
    expect(redactSecrets({ input: `${'x'.repeat(40)}https://u:pw@h` })).toBe(`${'x'.repeat(40)}https://[REDACTED:url_credentials]@h`);
  });

  it('masks an exact secret containing a label word that is not in label position', () => {
    expect(redactSecrets({ input: 'got secret-value-xyz back' }, { exactSecrets: ['secret-value-xyz'] }))
      .toBe('got [REDACTED:exact_secret] back');
  });

  it('lets a lexical rule label a known secret it matches exactly', () => {
    expect(redactSecretsWithCounts({ input: 'Bearer s3cr3t99' }, { exactSecrets: ['s3cr3t99'] })).toEqual({
      redacted: 'Bearer [REDACTED:bearer_token]',
      counts: { bearer_token: 1 },
    });
  });

  it('names a merged span after its longest constituent, a lexical rule winning a tie', () => {
    const token = githubToken();
    expect(redactSecretsWithCounts({ input: `t=${token}` }, { exactSecrets: [token] })).toEqual({
      redacted: 't=[REDACTED:github_token]',
      counts: { github_token: 1 },
    });
    expect(redactSecretsWithCounts({ input: `t=${token}.x` }, { exactSecrets: [`${token}.x`] })).toEqual({
      redacted: 't=[REDACTED:exact_secret]',
      counts: { exact_secret: 1 },
    });
  });

  it('applies a non-global extra pattern to every occurrence', () => {
    expect(redactSecretsWithCounts({ input: 'zz1 zz2' }, { extraPatterns: [{ name: 'zz', regex: /zz\d/ }] })).toEqual({
      redacted: '[REDACTED:zz] [REDACTED:zz]',
      counts: { zz: 2 },
    });
  });

  it('does not leak lastIndex state from a caller-owned global extra pattern across calls', () => {
    const extraPatterns = [{ name: 'zz', regex: /zz\d/g }];
    expect(redactSecrets({ input: 'zz1' }, { extraPatterns })).toBe('[REDACTED:zz]');
    expect(redactSecrets({ input: 'zz1' }, { extraPatterns })).toBe('[REDACTED:zz]');
  });

  it('labels a shape known only to the static-scan vocabulary as a credential', () => {
    expect(redactSecretsWithCounts({ input: `x ${npmToken()} y` })).toEqual({
      redacted: 'x [REDACTED:credential] y',
      counts: { credential: 1 },
    });
  });

  it('keeps addresses, numbers and cards readable when PII redaction is off, but still masks credentials', () => {
    const input = `mail a@b.co ip 10.1.2.3 call 415-555-1234 card 4111 1111 1111 1111 key ${githubToken()}`;
    expect(redactSecretsWithCounts({ input }, { redactPii: false })).toEqual({
      redacted: 'mail a@b.co ip 10.1.2.3 call 415-555-1234 card 4111 1111 1111 1111 key [REDACTED:github_token]',
      counts: { github_token: 1 },
    });
  });

  it('runs the aggressive opaque rule before PII rules so a long digit run is one opaque token', () => {
    expect(redactSecretsWithCounts({ input: '41555512344155551234' }, { policy: 'aggressive' })).toEqual({
      redacted: '[REDACTED:opaque_token]',
      counts: { opaque_token: 1 },
    });
  });

  it('leaves opaque runs readable under the default conservative policy', () => {
    expect(redactSecrets({ input: 'abcdefghijklmnopqrstuvwxyz' })).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('masks a short labeled value but not one already masked by an earlier rule', () => {
    expect(redactSecretsWithCounts({ input: 'password=hunter' })).toEqual({
      redacted: 'password=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 1 },
    });
    const once = redactSecrets({ input: 'password=hunter' });
    expect(redactSecretsWithCounts({ input: once })).toEqual({ redacted: once, counts: {} });
  });

  it('masks and counts a labeled value that only looks like a marker', () => {
    expect(redactSecretsWithCounts({ input: 'password=[REDACTED:x]' })).toEqual({
      redacted: 'password=[REDACTED:labeled_secret]',
      counts: { labeled_secret: 1 },
    });
  });
});
