/** EXTRACT-S6 L1a: the declaration rules bound to a second host — its own field kinds, identifier
 * grammar, reserved keys and already-exists error — through the public `./host` barrel only. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContentTypeRecord } from '@jini-ai/core/contracts/content-types';
import * as host from '../../index.js';
import { PluginInvalidError as ActivationPluginInvalidError } from '../../activation.js';
import {
  createDeclarativeContentTypes,
  enableDeclaredPlugin,
  MAX_DECLARED_CONTENT_TYPES,
  MAX_DECLARED_FIELDS,
  MAX_DECLARED_QUERYABLE_FIELDS,
  PluginInvalidError,
  type DeclarativeContentTypesPort,
  type DeclaredContentTypeCms,
  type DeclaredContentTypeWritePorts,
  type PluginManifest,
} from '../../index.js';

/** A second host's vocabulary: not the CMS's kinds, grammar or error. */
class KeyTakenError extends Error {}
const SECOND_KINDS = ['text', 'json'] as const;
const secondCms: DeclaredContentTypeCms = {
  fieldKinds: SECOND_KINDS,
  isFieldKind: ({ value }) => SECOND_KINDS.includes(value as never),
  isIndexable: ({ value }) => value === 'text',
  validateIdentifier: ({ value }) => /^x[a-z]{1,8}$/.test(value),
  identifierGrammar: 'x + 1-8 lowercase letters',
  isAlreadyExists: ({ error }) => error instanceof KeyTakenError,
};

function store(seed: ContentTypeRecord[] = []) {
  const rows = new Map(seed.map((row) => [row.key, row]));
  const writes: Array<{ key: string; actorId: string }> = [];
  let reads = 0;
  let registerHook: ((key: string) => { ok: false; error: Error } | undefined) | undefined;
  const ports: DeclaredContentTypeWritePorts = {
    findByKey: async ({ key }) => { reads += 1; return rows.get(key) ?? null; },
    register: async ({ workspaceId, key, label, fields, actorId }) => {
      const refused = registerHook?.(key);
      if (refused) return refused;
      writes.push({ key, actorId });
      rows.set(key, { workspaceId, key, label, fields, status: 'active', version: 1 });
      return { ok: true };
    },
  };
  return { ports, rows, writes, reads: () => reads, onRegister: (hook: typeof registerHook) => { registerHook = hook; } };
}

const record = (key: string, fields: ContentTypeRecord['fields'], status: ContentTypeRecord['status'] = 'active'): ContentTypeRecord =>
  ({ workspaceId: 'ws', key, label: key, fields, status, version: 1 });
const decl = (key: string, kind = 'text') => ({ key, label: key.toUpperCase(), fields: [{ name: 'xbody', kind }] });

describe('createDeclarativeContentTypes with a second host', () => {
  it('is exported from the public ./host barrel with the plugin-domain bounds', () => {
    expect(typeof host.createDeclarativeContentTypes).toBe('function');
    expect([MAX_DECLARED_CONTENT_TYPES, MAX_DECLARED_FIELDS, MAX_DECLARED_QUERYABLE_FIELDS]).toEqual([20, 50, 20]);
  });

  it('uses the host reserved keys, grammar text and field kinds, not a built-in vocabulary', () => {
    const rules = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: ['xpage'] }, {});
    const { decls, errors } = rules.parse({ value: [
      decl('xpage'),
      { key: 'post', label: 'Post', fields: [{ name: 'xbody', kind: 'text' }] },
      decl('xnote', 'integer'),
      { key: 'xblob', label: 'Blob', fields: [{ name: 'xdata', kind: 'json', queryable: true }] },
      decl('xok'),
    ] });
    expect(decls.map((d) => d.key)).toEqual(['xok']);
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ['CONTENT_TYPE_DECL_INVALID', "content type key 'xpage' is reserved by core"],
      ['CONTENT_TYPE_DECL_INVALID', "content type key 'post' must match x + 1-8 lowercase letters"],
      ['CONTENT_TYPE_DECL_INVALID', "content type 'xnote' field 'xbody' has kind 'integer'; allowed: text|json"],
      ['CONTENT_TYPE_DECL_INVALID', "content type 'xblob' field 'xdata' has storage-only kind 'json' and cannot be queryable"],
    ]);
  });

  it('gives each instance its own reserved set, copied when it is created', () => {
    const reserved = ['xone'];
    const first = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: reserved }, {});
    const second = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: new Set(['xtwo']) }, {});
    reserved.push('xtwo');
    expect(first.parse({ value: [decl('xone'), decl('xtwo')] }).decls.map((d) => d.key)).toEqual(['xtwo']);
    expect(second.parse({ value: [decl('xone'), decl('xtwo')] }).decls.map((d) => d.key)).toEqual(['xone']);
  });

  it('keeps the tier-1 code-surface rule ahead of declaration errors and the type-count bound', () => {
    const rules = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: [] }, {});
    const result = rules.validateManifest({ manifest: { tier: 'tier-1', hooks: ['h'], contentTypes: [{ key: 1 }] } });
    expect(result.errors.map((e) => e.code)).toEqual(['TIER1_DECLARES_CODE_SURFACE', 'CONTENT_TYPE_DECL_INVALID', 'CONTENT_TYPE_DECL_INVALID', 'CONTENT_TYPE_DECL_INVALID']);
    const tooMany = Array.from({ length: 21 }, (_, i) => decl(`x${'abcdefghijklmnopqrstu'[i]}`));
    expect(rules.parse({ value: tooMany }).errors.map((e) => e.message)).toEqual(["'contentTypes' declares more than 20 content types"]);
  });

  it('plans read-only, keeps owner-added fields, skips tombstones, and a conflict writes nothing', async () => {
    const rules = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: [] }, {});
    const s = store([
      record('xkept', [{ name: 'xbody', kind: 'text', required: false, queryable: false }, { name: 'xowner', kind: 'json', required: false, queryable: false }]),
      record('xgone', [], 'tombstone'),
    ]);
    const { decls } = rules.parse({ value: [decl('xnew'), decl('xkept'), decl('xgone')] });
    const plan = await rules.plan({ ports: s.ports, workspaceId: 'ws', decls });
    expect(s.writes).toEqual([]);
    expect(await rules.apply({ ports: s.ports, workspaceId: 'ws', pluginId: 'demo', plan })).toEqual({ created: ['xnew'], kept: ['xkept'], skipped: ['xgone'] });
    expect(s.writes).toEqual([{ key: 'xnew', actorId: 'plugin:demo' }]);
    expect(s.rows.get('xkept')!.fields.map((f) => f.name)).toEqual(['xbody', 'xowner']);

    const conflict = await rules.plan({ ports: s.ports, workspaceId: 'ws', decls: rules.parse({ value: [decl('xother'), decl('xkept', 'json')] }).decls });
    expect(conflict).toEqual({ items: [], conflicts: ["content type 'xkept' already exists with field 'xbody' as 'text', not 'json'"] });
  });

  it('judges a lost create race only through the host classifier', async () => {
    const rules = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: [] }, {});
    const lose = (winner: ContentTypeRecord | undefined, error: Error) => {
      const s = store();
      s.onRegister((key) => { if (winner) s.rows.set(key, winner); return { ok: false, error }; });
      return s;
    };
    const apply = async (s: ReturnType<typeof store>, kind = 'text') => {
      const { decls } = rules.parse({ value: [decl('xrace', kind)] });
      const plan = await rules.plan({ ports: s.ports, workspaceId: 'ws', decls });
      return rules.apply({ ports: s.ports, workspaceId: 'ws', pluginId: 'demo', plan });
    };
    const textField = [{ name: 'xbody', kind: 'text' as const, required: false, queryable: false }];

    expect(await apply(lose(record('xrace', textField), new KeyTakenError('taken')))).toEqual({ created: [], kept: ['xrace'], skipped: [] });
    expect(await apply(lose(record('xrace', [], 'tombstone'), new KeyTakenError('taken')))).toEqual({ created: [], kept: [], skipped: ['xrace'] });

    const incompatible = await apply(lose(record('xrace', textField), new KeyTakenError('taken')), 'json').catch((error: unknown) => error);
    expect(incompatible).toBeInstanceOf(PluginInvalidError);
    expect(incompatible).toBeInstanceOf(ActivationPluginInvalidError);
    expect((incompatible as Error).message).toBe("plugin 'demo' cannot be turned on: content type 'xrace' already exists with field 'xbody' as 'text', not 'json'");

    const unrelated = new Error('disk full');
    const s = lose(record('xrace', textField), unrelated);
    await expect(apply(s)).rejects.toBe(unrelated);
    expect(s.reads()).toBe(1); // planning read only: an unrecognized error is never judged as a race

    const missingWinner = new KeyTakenError('taken but unreadable');
    await expect(apply(lose(undefined, missingWinner))).rejects.toBe(missingWinner);
  });

  it('is a DeclarativeContentTypesPort the enable path drives end to end', async () => {
    const port: DeclarativeContentTypesPort = createDeclarativeContentTypes({ cms: secondCms, reservedKeys: ['xpage'] }, {});
    const s = store();
    const manifest = { id: 'demo', name: 'Demo', version: '1.0.0', sdkRange: '^1', engine: 1, tier: 'tier-1',
      capabilities: [], hooks: [], fields: [], integrity: {}, contentTypes: [decl('xfaq')] } as unknown as PluginManifest;
    let loaded = false;
    await enableDeclaredPlugin({ declarativeContentTypes: port, pluginId: 'demo', workspaceId: 'ws', manifest,
      loadCode: async () => { loaded = true; }, unloadCode: () => {} }, { contentTypes: s.ports });
    expect(loaded).toBe(false);
    expect(s.writes).toEqual([{ key: 'xfaq', actorId: 'plugin:demo' }]);
  });

  it('imports no content-type implementation', () => {
    const source = readFileSync(new URL('../../declarative-content-types.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+["']@jini-ai\/(?!core\/contracts\/content-types["'])/);
    expect(source).not.toMatch(/instanceof\s+\w*AlreadyExists/);
  });
});
