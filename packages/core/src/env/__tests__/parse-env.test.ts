import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EnvSchema, EnvVarSpec } from '../../contracts/env.js';
import { describeExpected } from '../coercers.js';
import { formatEnvIssue } from '../format-env-issue.js';
import { parseEnv } from '../parse-env.js';

interface HostConfig {
  rateLimit: number | undefined; debug: boolean | undefined; strictFlag: boolean | undefined; mode: string | undefined;
  publicUrl: string | undefined; siteOrigin: string | undefined; dataDir: string | undefined; origins: readonly string[] | undefined;
  limits: unknown; idleMs: number | undefined; apiKey: number | undefined; bindHost: string | undefined; pgSslMode: string | undefined;
  backend: string | undefined;
}
type Spec = EnvVarSpec<Extract<keyof HostConfig, string>>;
const base = { kind: 'config', secret: false, readers: ['server'], phase: 'boot', setBy: 'operator', validation: 'schema' } as const;
const doc = (fix: string) => ({ section: 'Test', summary: 'A test setting.', fix });
const SPECS: readonly Spec[] = [
  { ...base, name: 'HOST_RATE_LIMIT', field: 'rateLimit', type: 'int', accepts: { min: 1, max: 1000 }, default: '60', display: 'value', doc: doc('set HOST_RATE_LIMIT to a number such as 60, or remove it.') },
  { ...base, name: 'HOST_DEBUG', field: 'debug', type: 'flag', default: '0', display: 'value', doc: doc('set HOST_DEBUG to 1 or 0, or remove it.') },
  { ...base, name: 'HOST_STRICT', field: 'strictFlag', type: 'flag', accepts: { on: ['1'], off: [] }, security: 'deny-switch', doc: doc('set HOST_STRICT to 1, or remove it.') },
  { ...base, name: 'HOST_MODE', field: 'mode', type: 'enum', accepts: { values: ['local', 'hosted'] }, default: 'local', display: 'value', doc: doc('set HOST_MODE to local or hosted.') },
  { ...base, name: 'HOST_PUBLIC_URL', field: 'publicUrl', type: 'url', display: 'value', doc: doc('set HOST_PUBLIC_URL to your site address.') },
  { ...base, name: 'HOST_SITE_ORIGIN', field: 'siteOrigin', type: 'origin', display: 'value', doc: doc('set HOST_SITE_ORIGIN to an address with no path.') },
  { ...base, name: 'HOST_DATA_DIR', field: 'dataDir', type: 'path', doc: doc('set HOST_DATA_DIR to a folder.') },
  { ...base, name: 'HOST_ORIGINS', field: 'origins', type: 'list', doc: doc('set HOST_ORIGINS to a comma-separated list.') },
  { ...base, name: 'HOST_LIMITS', field: 'limits', type: 'json', doc: doc('set HOST_LIMITS to valid JSON.') },
  { ...base, name: 'HOST_IDLE_MS', field: 'idleMs', type: 'duration-ms', default: '5000', display: 'value', doc: doc('set HOST_IDLE_MS to a number of milliseconds.') },
  { ...base, name: 'HOST_API_KEY', field: 'apiKey', type: 'int', accepts: { min: 100000 }, secret: true, default: '424242', display: 'value', doc: doc('set HOST_API_KEY again.') },
  { ...base, name: 'HOST_BIND', field: 'bindHost', type: 'string', validation: 'owner', owner: 'bind-host.ts', security: 'trust-widening', doc: doc('set HOST_BIND to an address.') },
  { ...base, name: 'HOST_BACKEND', field: 'backend', type: 'enum', accepts: { values: ['sqlite', 'postgres'] }, default: 'sqlite', display: 'value', doc: doc('set HOST_BACKEND to sqlite or postgres.') },
  { ...base, name: 'HOST_PG_SSL_MODE', field: 'pgSslMode', type: 'enum', accepts: { values: ['require', 'disable'] }, default: 'require', display: 'value', activeWhen: { name: 'HOST_BACKEND', in: ['postgres'] }, doc: doc('set HOST_PG_SSL_MODE to require or disable.') },
];
const IPC_SECRET: EnvVarSpec = { ...base, name: 'HOST_STARTUP_TOKEN', field: 'startupToken', type: 'string', secret: true, delivery: 'startup-ipc', doc: doc('nothing to set.') };
const IMPORT_SECRET: EnvVarSpec = { ...base, name: 'HOST_OWNER_SIGNIN', field: 'ownerSignIn', type: 'string', secret: true, delivery: 'consume-at-import', phase: 'import', doc: doc('nothing to set.') };
const schema: EnvSchema<HostConfig> = { specs: [...SPECS, IPC_SECRET, IMPORT_SECRET] as EnvSchema<HostConfig>['specs'], ownedPrefixes: ['HOST_'] };
const parse = (env: Record<string, string | undefined>) => parseEnv({ schema, env });
const field = <K extends keyof HostConfig>(name: string, key: K, value: string | undefined) => parse({ [name]: value }).config[key];
/** The shared hostile table of the design (§4.4), run against every type. */
const HOSTILE = [undefined, '', '  ', 'abc', '0', '-1', 'true', 'TRUE', 'yes', 'off', 'x'.repeat(5000)] as const;

describe('parseEnv: defaults, coercion and what counts as set', () => {
  it('an empty map gives every default, no source and no issue', () => {
    const { config, sources, issues } = parse({});
    expect(config).toEqual({ rateLimit: 60, debug: false, strictFlag: undefined, mode: 'local', publicUrl: undefined, siteOrigin: undefined,
      dataDir: undefined, origins: undefined, limits: undefined, idleMs: 5000, apiKey: 424242, bindHost: undefined, pgSslMode: undefined, backend: 'sqlite' });
    expect(sources).toEqual({});
    expect(issues).toEqual([]);
  });

  it('unset, empty and blank all mean "not set": the default is used and nothing is reported', () => {
    for (const blank of [undefined, '', '  ', '\t\n']) {
      const { config, sources, issues } = parse({ HOST_RATE_LIMIT: blank, HOST_DEBUG: blank, HOST_ORIGINS: blank });
      expect([config.rateLimit, config.debug, config.origins, sources, issues]).toEqual([60, false, undefined, {}, []]);
    }
  });

  it('int: the hostile table, and the limits one below, on and one above', () => {
    expect(HOSTILE.map(value => field('HOST_RATE_LIMIT', 'rateLimit', value))).toEqual([60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60]);
    expect(['0', '1', '2', ' 7 ', '999', '1000', '1001', '1.5', '1e2', '0x10', '+5'].map(value => field('HOST_RATE_LIMIT', 'rateLimit', value)))
      .toEqual([60, 1, 2, 7, 999, 1000, 60, 60, 60, 60, 60]);
    expect(parse({ HOST_RATE_LIMIT: '0' }).issues.map(issue => issue.name)).toEqual(['HOST_RATE_LIMIT']);
    expect(parse({ HOST_RATE_LIMIT: '1' })).toMatchObject({ sources: { rateLimit: 'HOST_RATE_LIMIT' }, issues: [] });
  });

  it('flag: only the listed words count, compared exactly; 0 and false are real values, not "unset"', () => {
    expect(HOSTILE.map(value => field('HOST_DEBUG', 'debug', value))).toEqual([false, false, false, false, false, false, true, false, false, false, false]);
    expect(['1', 'false', ' 1', '1 ', 'True'].map(value => field('HOST_DEBUG', 'debug', value))).toEqual([true, false, false, false, false]);
    expect(parse({ HOST_DEBUG: '0' })).toMatchObject({ sources: { debug: 'HOST_DEBUG' }, issues: [] });
    expect(parse({ HOST_DEBUG: 'TRUE' }).issues).toHaveLength(1);
  });

  it('flag with its own words: a deny switch that accepts only 1 is not turned on by true or yes', () => {
    expect(['1', 'true', 'yes', 'TRUE', '0'].map(value => field('HOST_STRICT', 'strictFlag', value))).toEqual([true, undefined, undefined, undefined, undefined]);
  });

  it('enum, url, origin, path, list, json and duration each accept and reject as declared', () => {
    expect(['hosted', 'local', 'Hosted', 'other'].map(value => field('HOST_MODE', 'mode', value))).toEqual(['hosted', 'local', 'local', 'local']);
    expect([' https://example.com/a?b=1 ', 'not a url', 'example.com'].map(value => field('HOST_PUBLIC_URL', 'publicUrl', value))).toEqual(['https://example.com/a?b=1', undefined, undefined]);
    expect(['https://example.com', 'https://example.com/', 'https://example.com/path', 'http://localhost:4321'].map(value => field('HOST_SITE_ORIGIN', 'siteOrigin', value)))
      .toEqual(['https://example.com', undefined, undefined, 'http://localhost:4321']);
    expect(field('HOST_DATA_DIR', 'dataDir', ' /var/data ')).toBe(' /var/data ');
    expect(field('HOST_ORIGINS', 'origins', ' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(field('HOST_LIMITS', 'limits', '{"a":[1,2]}')).toEqual({ a: [1, 2] });
    expect(parse({ HOST_LIMITS: '{bad' })).toMatchObject({ config: { limits: undefined }, issues: [{ name: 'HOST_LIMITS', problem: 'invalid', expected: 'valid JSON' }] });
    expect(['0', '250', '-1', 'abc'].map(value => field('HOST_IDLE_MS', 'idleMs', value))).toEqual([0, 250, 5000, 5000]);
  });

  it('the config, its lists and its JSON values are frozen', () => {
    const { config, sources, issues } = parse({ HOST_ORIGINS: 'a,b', HOST_LIMITS: '{"a":{"b":[1]}}', HOST_RATE_LIMIT: 'abc' });
    const limits = config.limits as { a: { b: number[] } };
    expect([config, config.origins, limits, limits.a, limits.a.b, sources, issues, issues[0], issues[0]!.received].map(value => Object.isFrozen(value))).toEqual(Array(9).fill(true));
  });
});

describe('parseEnv: owners, activation and delivery', () => {
  it('an owner-validated value is handed on raw and never judged, whatever it is', () => {
    for (const raw of ['0.0.0.0', 'not an address', '', '  ']) {
      expect(parse({ HOST_BIND: raw })).toMatchObject({ config: { bindHost: raw }, sources: { bindHost: 'HOST_BIND' }, issues: [] });
    }
    expect(parse({}).sources).toEqual({});
  });

  it('an inactive setting is neither coerced nor reported; the same value is judged once it is active', () => {
    for (const env of [{ HOST_PG_SSL_MODE: 'nonsense' }, { HOST_PG_SSL_MODE: 'nonsense', HOST_BACKEND: 'sqlite' }, { HOST_PG_SSL_MODE: 'disable' }]) {
      expect(parse(env)).toMatchObject({ config: { pgSslMode: undefined }, issues: [] });
    }
    expect(parse({ HOST_BACKEND: 'postgres' }).config.pgSslMode).toBe('require');
    expect(parse({ HOST_BACKEND: 'postgres', HOST_PG_SSL_MODE: 'disable' }).config.pgSslMode).toBe('disable');
    expect(parse({ HOST_BACKEND: 'postgres', HOST_PG_SSL_MODE: 'nonsense' })).toMatchObject({ config: { pgSslMode: 'require' }, issues: [{ name: 'HOST_PG_SSL_MODE' }] });
  });

  it('values delivered over startup IPC or consumed at import are never read, never in the config, and still known names', () => {
    const { config, sources, issues } = parse({ HOST_STARTUP_TOKEN: 'ipc-fixture-value', HOST_OWNER_SIGNIN: 'signin-fixture-value' });
    expect(Object.keys(config)).not.toContain('startupToken');
    expect(Object.keys(config)).not.toContain('ownerSignIn');
    expect(JSON.stringify({ config, sources, issues })).not.toMatch(/fixture-value/);
    expect(issues).toEqual([]);
  });
});

describe('parseEnv: unknown names', () => {
  it('reports a set name with an owned prefix and no spec, with the nearest known name; other names are ignored', () => {
    const { issues } = parse({ HOST_PUBIC_URL: 'https://example.com', HOST_SOMETHING_ELSE: '1', HOST_BLANK: ' ', PATH: '/usr/bin', OTHER_RATE_LIMIT: '5' });
    expect(issues).toEqual([
      { name: 'HOST_PUBIC_URL', problem: 'unknown-name', received: { kind: 'hidden', length: 19 }, expected: 'a setting name this program knows', suggestion: 'HOST_PUBLIC_URL', fix: 'rename it where you set it' },
      { name: 'HOST_SOMETHING_ELSE', problem: 'unknown-name', received: { kind: 'hidden', length: 1 }, expected: 'a setting name this program knows', fix: 'check the spelling where you set it, or remove it' },
    ]);
  });

  it('a name another list declares is known', () => {
    const declared: EnvVarSpec = { ...base, kind: 'ambient', name: 'HOST_TMPDIR', field: 'tmp', type: 'path', doc: doc('nothing to set.') };
    expect(parseEnv({ schema, env: { HOST_TMPDIR: '/tmp' } }).issues).toHaveLength(1);
    expect(parseEnv({ schema, env: { HOST_TMPDIR: '/tmp' } }, { declared: [declared] }).issues).toEqual([]);
  });
});

describe('parseEnv: an issue can never carry a secret', () => {
  const SECRET = 'postgres://admin:hunter2-fixture@db.internal/prod';

  it('hides a secret, an unlisted name, a presence-only setting and credentials inside a shown URL', () => {
    const { issues } = parse({ HOST_API_KEY: SECRET, HOST_UNLISTED_DSN: SECRET, HOST_ORIGINS_X: SECRET, HOST_LIMITS: `{bad ${SECRET}`,
      HOST_SITE_ORIGIN: 'https://user:hunter2-fixture@example.com/path?token=hunter2-fixture#hunter2-fixture' });
    expect(issues.map(issue => [issue.name, issue.received.kind])).toEqual([['HOST_SITE_ORIGIN', 'shown'], ['HOST_LIMITS', 'hidden'], ['HOST_API_KEY', 'hidden'],
      ['HOST_ORIGINS_X', 'hidden'], ['HOST_UNLISTED_DSN', 'hidden']]);
    expect(issues[0]!.received).toEqual({ kind: 'shown', text: 'https://example.com/path' });
    expect(issues[2]).not.toHaveProperty('usedInstead');
    const error = new Error(issues.map(issue => formatEnvIssue({ issue, product: 'Host' })).join('\n'));
    for (const text of [JSON.stringify(issues), inspect(issues, { depth: 9 }), inspect(error), error.stack ?? '', error.message]) {
      expect(text).not.toContain('hunter2-fixture');
      expect(text).not.toContain('424242');
    }
  });

  it('a shown value that cannot be parsed as a URL is hidden, and a long shown value is cut', () => {
    expect(parse({ HOST_PUBLIC_URL: `not a url ${SECRET}` }).issues[0]!.received).toEqual({ kind: 'hidden', length: 59 });
    expect(parse({ HOST_MODE: 'x'.repeat(5000) }).issues[0]!.received).toEqual({ kind: 'shown', text: `${'x'.repeat(120)}…` });
  });
});

describe('formatEnvIssue: exact text', () => {
  const text = (env: Record<string, string>) => parse(env).issues.map(issue => formatEnvIssue({ issue, product: 'Host' }));

  it('a rejected value: the variable, what was expected, what is used, the fix', () => {
    expect(text({ HOST_RATE_LIMIT: 'abc' })).toEqual([
      'HOST_RATE_LIMIT is set to "abc". Host expected a whole number from 1 to 1000.\nHost is using 60 instead.\nTo fix: set HOST_RATE_LIMIT to a number such as 60, or remove it.']);
    expect(text({ HOST_DEBUG: 'yes' })).toEqual([
      'HOST_DEBUG is set to "yes". Host expected 1 or true to turn it on, or 0 or false to turn it off.\nHost is using 0 instead.\nTo fix: set HOST_DEBUG to 1 or 0, or remove it.']);
    expect(text({ HOST_MODE: 'cloud' })).toEqual(['HOST_MODE is set to "cloud". Host expected one of: local, hosted.\nHost is using local instead.\nTo fix: set HOST_MODE to local or hosted.']);
  });

  it('a hidden value with a secret default, and a setting with no default: neither names a replacement', () => {
    expect(text({ HOST_API_KEY: 'whatever-value' })).toEqual([
      'HOST_API_KEY is set (14 characters, not shown). Host expected a whole number of 100000 or more.\nHost is not using this value.\nTo fix: set HOST_API_KEY again.']);
    expect(text({ HOST_SITE_ORIGIN: 'https://example.com/path' })).toEqual([
      'HOST_SITE_ORIGIN is set to "https://example.com/path". Host expected a web address with no path, such as https://example.com.\nHost is not using this value.\nTo fix: set HOST_SITE_ORIGIN to an address with no path.']);
  });

  it('an unknown name, with and without a near match', () => {
    expect(text({ HOST_PUBIC_URL: 'x', HOST_ZZZ: 'y' })).toEqual([
      'HOST_PUBIC_URL is set, but Host has no setting with that name. Did you mean HOST_PUBLIC_URL?\nNothing was changed. To fix: rename it where you set it.',
      'HOST_ZZZ is set, but Host has no setting with that name.\nNothing was changed. To fix: check the spelling where you set it, or remove it.']);
  });

  it('every issue is returned, in schema order and then unknown names by name', () => {
    expect(parse({ HOST_ZZZ: '1', HOST_MODE: 'cloud', HOST_RATE_LIMIT: 'abc', HOST_AAA: '1' }).issues.map(issue => issue.name)).toEqual(['HOST_RATE_LIMIT', 'HOST_MODE', 'HOST_AAA', 'HOST_ZZZ']);
  });
});

it('explains the expected type or maximum for settings with no minimum', () => {
  expect([
    describeExpected({ spec: { ...SPECS[11]!, type: 'string' } }),
    describeExpected({ spec: SPECS[6]! }),
    describeExpected({ spec: SPECS[4]! }),
    describeExpected({ spec: SPECS[7]! }),
    describeExpected({ spec: { ...SPECS[0]!, accepts: { max: 42 } } }),
    describeExpected({ spec: SPECS[9]! }),
  ]).toEqual([
    'text', 'a file or folder path', 'a full web address such as https://example.com/path',
    'a comma-separated list', 'a whole number of 42 or less', 'a whole number of milliseconds',
  ]);
});

it('reports missing environment values without calling them hidden or naming a substitute', () => {
  expect(formatEnvIssue({ product: 'Host', issue: {
    name: 'HOST_BIND', problem: 'missing', received: { kind: 'unset' }, expected: 'an address', fix: 'set HOST_BIND.',
  } })).toBe('HOST_BIND is not set. Host expected an address.\nHost is not using this value.\nTo fix: set HOST_BIND.');
});

it('returns no value or source if a mismatched schema default cannot be coerced', () => {
  const schema: EnvSchema<{ rateLimit: number | undefined }> = {
    specs: [{ ...SPECS[0]!, field: 'rateLimit', default: 'unlimited' }], ownedPrefixes: ['HOST_'],
  };
  expect(parseEnv({ schema, env: {} })).toEqual({ config: { rateLimit: undefined }, sources: {}, issues: [] });
});
