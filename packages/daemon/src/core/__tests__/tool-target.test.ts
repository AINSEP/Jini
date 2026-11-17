import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { resolveToolTarget, unknownToolDetails, unknownToolMessage, type ToolTarget } from '../tool-target.js';
import type { ToolFamilyPort } from '../tool-family.js';

function registryWith(ids: readonly string[]) {
  const registry = createToolRegistry({});
  for (const id of ids) registry.register({ descriptor: { id, readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => id });
  return registry;
}

function unknown(target: ToolTarget): Extract<ToolTarget, { kind: 'unknown' }> {
  if (target.kind !== 'unknown') throw new Error(`expected an unknown target, got ${target.kind}`);
  return target;
}

describe('resolveToolTarget', () => {
  it('returns the registered descriptor for a known id', () => {
    const target = resolveToolTarget({ toolId: 'content_read.menu', registry: registryWith(['content_read.menu']) });
    expect(target).toMatchObject({ kind: 'tool', toolId: 'content_read.menu', descriptor: { id: 'content_read.menu' } });
  });

  it('returns the closest ids for an unknown prefix', () => {
    const target = resolveToolTarget({ toolId: 'content_read', registry: registryWith(['content_read.menu', 'other']) });
    expect(target).toEqual({ kind: 'unknown', toolId: 'content_read', candidates: ['content_read.menu'] });
  });

  it('returns no candidates when nothing is close', () => {
    expect(resolveToolTarget({ toolId: 'zzz', registry: registryWith(['content_read.menu']) })).toEqual({ kind: 'unknown', toolId: 'zzz', candidates: [] });
  });

  it('answers a tool that exists only in another registry exactly as it answers a made-up id', () => {
    const other = registryWith(['hidden_tool']);
    const run = registryWith(['content_read.menu']);
    const hidden = resolveToolTarget({ toolId: 'hidden_tool', registry: run });
    const madeUp = resolveToolTarget({ toolId: 'hidden_tool', registry: registryWith(['content_read.menu']) });
    expect(other.list({}).map(({ id }) => id)).toEqual(['hidden_tool']);
    expect(hidden).toEqual(madeUp);
  });

  it('ranks with a content_read resource selector from the input without dispatching it', () => {
    const registry = registryWith(['content_read.theme', 'content_read.backup_restore_point']);
    const target = resolveToolTarget({ toolId: 'content_read', input: { resource: 'theme' }, registry });
    expect(unknown(target).candidates).toEqual(['content_read.theme', 'content_read.backup_restore_point']);
  });
});

describe('unknownToolMessage', () => {
  it('words an unknown id with the shared sentence', () => {
    const target = unknown(resolveToolTarget({ toolId: 'content_read', registry: registryWith(['content_read.menu']) }));
    expect(unknownToolMessage({ target })).toBe('There is no tool named "content_read". Closest names: content_read.menu. Find tools with search_tools.');
  });

  it('words an id with no candidates without a closest-names part', () => {
    const target = unknown(resolveToolTarget({ toolId: 'zzz', registry: registryWith([]) }));
    expect(unknownToolMessage({ target })).toBe('There is no tool named "zzz". Find tools with search_tools.');
  });

  it('keeps the MCP-local sentence for check_messages', () => {
    const target = unknown(resolveToolTarget({ toolId: 'check_messages', registry: registryWith([]) }));
    expect(unknownToolMessage({ target })).toBe('check_messages is an MCP-local tool; call check_messages directly, never as toolId in a delegated gateway');
  });
});

const FAM_SELECTOR = { keys: ['kind'], byValue: { a: 'fam.a', b: 'fam.b' } } as const;

function familyPort(description: ReturnType<ToolFamilyPort['describeFamily']>, asked: string[] = []): ToolFamilyPort {
  return { describeFamily: ({ familyId }) => { asked.push(familyId); return familyId === 'fam' ? description : undefined; } };
}

describe('resolveToolTarget: a tool family answers as a group', () => {
  it('words a family id as a group of tools and carries members and selector in the details', () => {
    const families = familyPort({ members: ['fam.a', 'fam.b'], selector: FAM_SELECTOR });
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(['fam.a', 'fam.b', 'other']) }, { families }));
    expect(unknownToolMessage({ target })).toBe('"fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.');
    expect(unknownToolDetails({ target })).toEqual({ family: { id: 'fam', members: ['fam.a', 'fam.b'], selector: FAM_SELECTOR } });
  });

  it('asks the port only about the unknown id, never about a registered tool', () => {
    const asked: string[] = [];
    const families = familyPort({ members: ['fam.a'] }, asked);
    resolveToolTarget({ toolId: 'fam.a', registry: registryWith(['fam.a']) }, { families });
    expect(asked).toEqual([]);
  });

  it('never trusts the port for visibility: a member the registry does not hold is dropped everywhere', () => {
    const families = familyPort({ members: ['fam.a', 'fam.c', 'fam.b'], selector: { keys: ['kind'], byValue: { a: 'fam.a', c: 'fam.c', b: 'fam.b' } } });
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(['fam.a', 'fam.b']) }, { families }));
    expect(unknownToolMessage({ target })).toBe('"fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.');
    expect(JSON.stringify(unknownToolDetails({ target }))).not.toContain('fam.c');
    expect(unknownToolDetails({ target })).toEqual({ family: { id: 'fam', members: ['fam.a', 'fam.b'], selector: FAM_SELECTOR } });
  });

  it('a family with no visible member is an ordinary unknown id', () => {
    const families = familyPort({ members: ['fam.c'], selector: { keys: ['kind'], byValue: { c: 'fam.c' } } });
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(['other']) }, { families }));
    expect(target.family).toBeUndefined();
    expect(unknownToolMessage({ target })).toBe('There is no tool named "fam". Find tools with search_tools.');
    expect(unknownToolDetails({ target })).toBeUndefined();
  });

  it('keeps only own, short, string selector entries and at most 64 members', () => {
    const ids = Array.from({ length: 70 }, (_, index) => `fam.m${index}`);
    const byValue = { ok: 'fam.m0', ['x'.repeat(65)]: 'fam.m1', num: 3 as unknown as string, gone: 'fam.zzz' };
    const families = familyPort({ members: ids, selector: { keys: ['kind', 'k'.repeat(65)], byValue } });
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(ids) }, { families }));
    expect(target.family?.members).toEqual(ids.slice(0, 64));
    expect(target.family?.selector).toEqual({ keys: ['kind'], byValue: { ok: 'fam.m0' } });
  });

  it('drops a selector whose values all fail the filter, keeping the members', () => {
    const families = familyPort({ members: ['fam.a'], selector: { keys: ['kind'], byValue: { z: 'fam.z' } } });
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(['fam.a']) }, { families }));
    expect(unknownToolDetails({ target })).toEqual({ family: { id: 'fam', members: ['fam.a'] } });
  });

  it('without a port the answer is today\'s', () => {
    const target = unknown(resolveToolTarget({ toolId: 'fam', registry: registryWith(['fam.a']) }));
    expect(unknownToolMessage({ target })).toBe('There is no tool named "fam". Closest names: fam.a. Find tools with search_tools.');
    expect(unknownToolDetails({ target })).toBeUndefined();
  });
});
