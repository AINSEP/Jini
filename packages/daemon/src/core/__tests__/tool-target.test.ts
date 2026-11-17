import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@jini-ai/core';
import { resolveToolTarget, unknownToolMessage, type ToolTarget } from '../tool-target.js';

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
