/**
 * Structural invariants of the built-in permission data. `runtime-boundary.test.ts` and
 * `runtime.test.ts` pin the exact values against `builtins.fixture.json`, but a fixture regenerated
 * from a broken list would pin the breakage too. These checks hold regardless of the fixture:
 * the catalog Map silently collapses duplicate ids, and a migration that fans out to an
 * unregistered string would grant something no route ever checks.
 */
import { expect, it } from 'vitest';
import { BUILTIN_PERMISSIONS, BUILTIN_PERMISSION_MIGRATIONS } from '../builtin-permissions.js';

const ids = BUILTIN_PERMISSIONS.map((p) => p.id);
const registered = new Set(ids);

it('registers every built-in permission id exactly once', () => {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  expect(duplicates).toEqual([]);
});

it('never registers the owner wildcard and only uses dotted lower-case ids', () => {
  expect(registered.has('*')).toBe(false);
  for (const id of ids) expect(id).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
});

it('gives every descriptor an owner and a non-empty description', () => {
  for (const p of BUILTIN_PERMISSIONS) {
    expect(p.owner.trim(), p.id).not.toBe('');
    expect(p.description.trim(), p.id).not.toBe('');
  }
});

it('fans every migration out only to registered permissions, without duplicates', () => {
  for (const migration of BUILTIN_PERMISSION_MIGRATIONS) {
    expect(migration.to.length, migration.from).toBeGreaterThan(0);
    expect(new Set(migration.to).size, migration.from).toBe(migration.to.length);
    for (const target of migration.to) expect(registered.has(target), `${migration.from} -> ${target}`).toBe(true);
    expect(migration.to, migration.from).not.toContain(migration.from);
    expect(migration.reason.trim(), migration.from).not.toBe('');
  }
});

it('keys migrations by a unique source permission (the registry Map would drop a repeat)', () => {
  const sources = BUILTIN_PERMISSION_MIGRATIONS.map((m) => m.from);
  expect(new Set(sources).size).toBe(sources.length);
});

it('keeps the deprecated sources still registered, so existing grants stay valid catalog entries', () => {
  // Additive migrations never remove `from`; a still-shipped deprecated string must stay known.
  for (const deprecated of ['media.write', 'settings.write']) expect(registered.has(deprecated)).toBe(true);
  expect(BUILTIN_PERMISSION_MIGRATIONS.find((m) => m.from === 'media.write')?.to).toContain('media.read');
});
