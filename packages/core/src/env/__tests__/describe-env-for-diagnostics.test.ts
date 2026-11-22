import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EnvSchema } from '../../contracts/env.js';
import { describeEnvForDiagnostics } from '../describe-env-for-diagnostics.js';

const base = { kind: 'config', secret: false, type: 'string', readers: ['host'], phase: 'boot', setBy: 'operator', validation: 'schema',
  doc: { section: 'Host', summary: 'A host setting.', fix: 'set the value or remove it.' } } as const;
const schema: EnvSchema<Record<string, unknown>> = { ownedPrefixes: ['HOST_'], specs: [
  { ...base, name: 'HOST_MODE', field: 'mode', display: 'value', default: 'local' },
  { ...base, name: 'HOST_SECRET', field: 'secret', secret: true, display: 'value' },
  { ...base, name: 'HOST_PRIVATE', field: 'private', display: 'presence' },
  { ...base, name: 'HOST_DEFAULT_DISPLAY', field: 'defaultDisplay' },
  { ...base, name: 'HOST_URL', field: 'url', type: 'url', display: 'value' },
  { ...base, name: 'HOST_ORIGIN', field: 'origin', type: 'origin', display: 'value' },
] };
const emptySchema: EnvSchema<Record<string, unknown>> = { specs: [], ownedPrefixes: [] };

describe('describeEnvForDiagnostics', () => {
  // Mutation: show raw text when no spec exists instead of returning a hidden echo.
  it('shows only presence for unlisted names, including families and names outside owned prefixes', () => {
    const connection = 'postgres://admin:unlisted-pass@db.internal/prod';
    const result = describeEnvForDiagnostics({ schema, env: { HOST_UNLISTED: connection, SAVED_STORAGE_DSN: connection } });
    expect(result).toMatchObject({ HOST_UNLISTED: `set (${connection.length} characters)`, SAVED_STORAGE_DSN: `set (${connection.length} characters)` });
    for (const text of [JSON.stringify(result), inspect(result)]) {
      expect(text).not.toContain(connection);
      expect(text).not.toContain('unlisted-pass');
      expect(text).not.toContain('db.internal');
    }
  });

  // Mutation: remove the secret check while keeping display: 'value'.
  it('never exposes a secret with no recognizable vendor shape, even with display value', () => {
    const secret = 'plain-fixture-value';
    const result = describeEnvForDiagnostics({ schema, env: { HOST_SECRET: secret } });
    expect(result.HOST_SECRET).toBe('set (19 characters)');
    const error = new Error(JSON.stringify(result));
    for (const text of [JSON.stringify(result), inspect(result), inspect(error), error.stack ?? '', error.message]) {
      expect(text).not.toContain(secret);
    }
  });

  // Mutation: treat display absence or 'presence' as permission to show a non-secret value.
  it('requires explicit value display for non-secrets', () => {
    const result = describeEnvForDiagnostics({ schema, env: { HOST_PRIVATE: 'private-fixture', HOST_DEFAULT_DISPLAY: 'default-fixture' } });
    expect(result).toMatchObject({ HOST_PRIVATE: 'set (15 characters)', HOST_DEFAULT_DISPLAY: 'set (15 characters)' });
    expect(JSON.stringify(result)).not.toContain('fixture');
  });

  // Mutation: use the spec default, or treat blank strings as set.
  it('describes absent and blank values as not set without applying defaults', () => {
    for (const value of [undefined, '', '  ', '\t\n']) {
      expect(describeEnvForDiagnostics({ schema, env: { HOST_MODE: value, HOST_SECRET: value, UNKNOWN: value } })).toEqual({
        HOST_MODE: 'not set', HOST_SECRET: 'not set', HOST_PRIVATE: 'not set', HOST_DEFAULT_DISPLAY: 'not set',
        HOST_URL: 'not set', HOST_ORIGIN: 'not set', UNKNOWN: 'not set',
      });
    }
  });

  // Mutation: hide every value, or coerce the value before displaying it.
  it('shows explicitly permitted raw values including zero and false', () => {
    for (const value of ['local', '0', 'false', '  yes  ']) {
      expect(describeEnvForDiagnostics({ schema, env: { HOST_MODE: value } }).HOST_MODE).toBe(value);
    }
  });

  // Mutation: omit the URL stripper for either url or origin.
  it.each(['HOST_URL', 'HOST_ORIGIN'])('strips userinfo, query and fragment from %s', (name) => {
    const raw = 'https://fixture-user:fixture-pass@example.com/path?anything=query-fixture#fragment-fixture';
    const result = describeEnvForDiagnostics({ schema, env: { [name]: raw } });
    expect(result[name]).toBe('https://example.com/path');
    expect(JSON.stringify(result)).not.toMatch(/fixture-user|fixture-pass|query-fixture|fragment-fixture/);
  });

  // Mutation: return malformed URL text when parsing fails.
  it('hides malformed URLs rather than echoing their text', () => {
    const result = describeEnvForDiagnostics({ schema, env: { HOST_URL: 'not a URL', HOST_ORIGIN: 'not an origin' } });
    expect(result).toMatchObject({ HOST_URL: 'set (9 characters)', HOST_ORIGIN: 'set (13 characters)' });
  });

  // Mutation: skip shape redaction, or truncate before redaction so only a credential prefix remains.
  it('redacts credential shapes before truncation while retaining ordinary long identifiers', () => {
    const token = `ghp_${'A'.repeat(36)}`;
    expect(describeEnvForDiagnostics({ schema, env: { HOST_MODE: token } }).HOST_MODE).toBe('[REDACTED:github_token]');
    const prefix = ' '.repeat(115);
    expect(describeEnvForDiagnostics({ schema, env: { HOST_MODE: prefix + token } }).HOST_MODE).toBe(`${prefix}[REDA…`);
    expect(describeEnvForDiagnostics({ schema, env: { HOST_MODE: 'x'.repeat(5000) } }).HOST_MODE).toBe(`${'x'.repeat(120)}…`);
  });

  // Mutation: reuse the preceding entry's spec, or key diagnostics by config field instead of env name.
  it('keeps disclosure decisions independent in a mixed map and does not mutate inputs', () => {
    const env = Object.freeze({ HOST_MODE: 'local', HOST_SECRET: 'plain-fixture-value', HOST_PRIVATE: 'private-fixture', UNKNOWN: 'unknown-fixture' });
    const result = describeEnvForDiagnostics({ schema, env });
    expect(result).toEqual({ HOST_MODE: 'local', HOST_SECRET: 'set (19 characters)', HOST_PRIVATE: 'set (15 characters)',
      HOST_DEFAULT_DISPLAY: 'not set', HOST_URL: 'not set', HOST_ORIGIN: 'not set', UNKNOWN: 'set (15 characters)' });
    expect(env).toEqual({ HOST_MODE: 'local', HOST_SECRET: 'plain-fixture-value', HOST_PRIVATE: 'private-fixture', UNKNOWN: 'unknown-fixture' });
    expect(schema.specs[0]!.default).toBe('local');
  });

  // Mutation: skip names when there are no specs, or accumulate results across calls.
  it('handles empty schemas and calls independently, including object-property names', () => {
    const env = Object.fromEntries([['__proto__', 'fixture'], ['constructor', 'fixture']]);
    expect(describeEnvForDiagnostics({ schema: emptySchema, env })).toEqual(Object.fromEntries([
      ['__proto__', 'set (7 characters)'], ['constructor', 'set (7 characters)'],
    ]));
    expect(describeEnvForDiagnostics({ schema: emptySchema, env: {} })).toEqual({});
  });
});
