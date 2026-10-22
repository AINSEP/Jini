import { expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireNoInput, requireString, optionalString, withSchemaOnRejection } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../index.js";
import type { AuthorizeFn } from '../../commands/command.js';

it('reads named input without confusing a payload input key with the argument envelope', () => {
  const input = { input: { nested: true }, name: 'asset' };
  expect(requireInputRecord({ input })).toBe(input);
  expect(requireString({ input, key: 'name' })).toBe('asset');
  expect(optionalString({ input, key: 'missing' })).toBeUndefined();
  expect(() => requireNoInput({ input })).toThrow(ToolInputError);
  expect(() => requireNoInput({ input: {} })).not.toThrow();
});

it('forwards optional entity scope to the existing authorization port and fails closed', async () => {
  const calls: unknown[] = [];
  const authorize = async (request: Parameters<AuthorizeFn>[0]) => {
    calls.push(request);
    return { allowed: false, reason: 'scope_denied' };
  };
  await expect(requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize }), workspaceId: 'w', principalId: 'p', permission: 'media.read' },
    { entityType: 'media', entityId: 'asset' })).rejects.toMatchObject({ reason: 'scope_denied' });
  expect(calls).toEqual([{ workspaceId: 'w', principalId: 'p', permission: 'media.read', entityType: 'media', entityId: 'asset' }]);
});

it('decorates only shape errors and calls the named predicate with its error envelope', async () => {
  const error = new Error('missing name');
  const seen: unknown[] = [];
  await expect(withSchemaOnRejection({ toolId: 'read', catalog: new Map(),
    isShapeRejection: ({ error: caught }) => { seen.push(caught); return true; },
    fn: async () => { throw error; },
  })).rejects.toThrow(ToolInputError);
  expect(seen).toEqual([error]);
  await expect(withSchemaOnRejection({ toolId: 'read', catalog: new Map(),
    isShapeRejection: () => false, fn: async () => { throw error; },
  })).rejects.toBe(error);
});

it('keeps optional unwired ids explicit while enforcing every catalog entry in mixed batches', () => {
  const catalog = indexCatalogById({ catalog: [
    { name: 'read', description: 'read', authorization: { permission: 'read' }, sideEffects: 'none' as const, inputSchema: { type: 'object' } },
    { name: 'later', description: 'later', authorization: { permission: 'read' }, sideEffects: 'none' as const, inputSchema: { type: 'object' } },
  ] });
  const required = { domain: 'assets', catalogModule: 'catalog', catalog,
    handlers: { read: async () => ({}) }, derivedRisk: new Map([['read', 'none' as const]]) };
  expect(() => buildDomainRegistrations(required)).toThrow("'later' is neither wired nor declared unwired");
  expect(buildDomainRegistrations(required, { unwiredToolIds: new Set(['later']) }).map(({ descriptor }) => descriptor.readOnly)).toEqual([true]);
});


it('allows authorized requests and returns synchronous evaluator failures as rejections', async () => {
  const required = { workspaceId: 'w', principalId: 'p', permission: 'media.read' };
  await expect(requireToolPermission({ ...required, authorize: async () => ({ allowed: true, reason: 'matched' }) })).resolves.toBeUndefined();
  const failure = new Error('evaluator unavailable');
  await expect(requireToolPermission({ ...required, authorize: () => { throw failure; } })).rejects.toBe(failure);
});
