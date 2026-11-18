import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });
const M = '[REDACTED:labeled_secret]';

// The diagnostics rules masked the value of these labels at any length; the engine's label list stopped
// at password/secret/token/api_key, so a short value under an alias or a prefixed env-style name got
// through. Values are obviously fake.
describe('label aliases with short values', () => {
  it.each(['passwd', 'pwd', 'id_token', 'auth_token', 'signing_secret', 'webhook_secret'])('masks %s in assignment, JSON, inspect and quoted forms', label => {
    expect(run(`${label}=abc`)).toEqual({ redacted: `${label}=${M}`, counts: { labeled_secret: 1 } });
    expect(run(`my ${label}=abc ok`).redacted).toBe(`my ${label}=${M} ok`);
    expect(run(`{"${label}":"abc"}`).redacted).toBe(`{"${label}":"${M}"}`);
    expect(run(`{ ${label}: 'abc' }`).redacted).toBe(`{ ${label}: '${M}' }`);
    expect(run(`${label}="two words"`).redacted).toBe(`${label}="${M}"`);
    expect(run(`${label}: "abc"`).redacted).toBe(`${label}: "${M}"`);
    expect(run(`${label.toUpperCase()}=abc&page=2`).redacted).toBe(`${label.toUpperCase()}=${M}&page=2`);
  });
  it.each([
    ['DB_PASSWORD=abc', `DB_PASSWORD=${M}`],
    ['MY_API_KEY=abc', `MY_API_KEY=${M}`],
    ['app_secret=abc', `app_secret=${M}`],
    ['STRIPE_WEBHOOK_SECRET=abc', `STRIPE_WEBHOOK_SECRET=${M}`],
    ['my-token=abc', `my-token=${M}`],
    ['{"db_password":"abc"}', `{"db_password":"${M}"}`],
  ])('masks a prefixed name: %j', (input, redacted) => {
    expect(run(input).redacted).toBe(redacted);
  });
  it('masks a long unquoted value after a colon', () => {
    expect(run('pwd: hunter2hunter2').redacted).toBe(`pwd: ${M}`);
    expect(run('webhook_secret: abcdefghijklmnop').redacted).toBe(`webhook_secret: ${M}`);
  });
  it('masks a quoted value with the other quote kind inside it', () => {
    expect(run(`{"pwd":"it's"}`).redacted).toBe(`{"pwd":"${M}"}`);
  });
  it.each([
    'passwd: hunter2', 'pwd: ok', 'pwd command prints the cwd', 'cd /home/user && pwd', 'mypwd=abc', 'passwdfile=abc', 'tokenizer=bpe',
    'token_count=12', 'max_tokens=4096', 'id_token_hint=abc', 'pwd=', 'pwd=""', 'my.passwd.file is readable', 'passwd',
  ])('keeps %j byte for byte', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
  it.each(['pwd=[REDACTED:labeled_secret]', '{"passwd":"[REDACTED:labeled_secret]"}', "{ id_token: '[REDACTED:labeled_secret]' }"])(
    'keeps an existing marker: %j', input => {
      expect(run(input)).toEqual({ redacted: input, counts: {} });
    });
  it('masks a marker-lookalike that is not one the engine generates', () => {
    expect(run('pwd=[REDACTED:custom]').redacted).toBe(`pwd=${M}`);
  });
  it.each(['passwd=abc', 'DB_PASSWORD=abc', '{"pwd":"x y"}', "{ webhook_secret: 'abc' }"])('is idempotent for %j', input => {
    const once = run(input).redacted;
    expect(run(once)).toEqual({ redacted: once, counts: {} });
  });
  it('scans separator-heavy text in linear time', () => {
    const input = `${'a_'.repeat(50_000)}pwd: x ${'b-'.repeat(50_000)}`;
    const started = performance.now();
    run(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
