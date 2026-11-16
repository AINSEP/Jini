/**
 * @file Public-behaviour tests for `buildPluginSourceRegistrations`: per-operation port calls,
 * field validation, owner-missing refusal, error relay and the approval-gated delete.
 */
import { describe, expect, it, vi } from 'vitest';
import { ToolInputError, type AgentToolDefinition, type ToolExecutionContext, type ToolRegistration } from '@jini-ai/core';
import { buildPluginSourceRegistrations, pluginSourceDerivedRiskFor } from '../source.js';
import { PluginInstallError, PluginSourceError } from '../../plugin-tool-errors.js';
import type { PluginApprovalPort, PluginSourceToolsRequired } from '../contract.js';

const toolIds = { create: 's_create', open: 's_open', list: 's_list', read: 's_read', write: 's_write', edit: 's_edit', delete: 's_delete', seal: 's_seal', rollback: 's_rollback' };
const risk = pluginSourceDerivedRiskFor({ toolIds });
const catalog: AgentToolDefinition[] = Object.values(toolIds).map(name => ({
  name, description: `${name} tool`, sideEffects: risk.get(name)!, authorization: { permission: `perm.${name}` }, inputSchema: { type: 'object' },
}));

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: 'e1', principal: { id: 'p1' }, run: { id: 'r1' }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

function makePort() {
  return {
    create: vi.fn(async () => ({ created: true })), open: vi.fn(async () => ({ created: false })),
    list: vi.fn(async () => ({ files: [{ path: 'a.js', bytes: 3 }] })),
    read: vi.fn(async () => ({ content: 'hi', bytes: 2, digest: 'dg1' })),
    write: vi.fn(async () => ({ bytesWritten: 4 })), edit: vi.fn(async () => ({ bytesWritten: 5, replacements: 2 })),
    delete: vi.fn(async () => ({ deleted: true as const })),
    seal: vi.fn(async () => ({ sealed: true })), rollback: vi.fn(async () => ({ rolledBack: true })),
    isSealedHere: vi.fn(), readApproval: vi.fn(), recordApproval: vi.fn(),
  };
}

function setup(overrides: Partial<PluginSourceToolsRequired<string>> = {}) {
  const port = makePort();
  const authorize = vi.fn(async () => ({ allowed: true as const }));
  const handlerSteps: { flag?: string }[] = [];
  const approvals: PluginApprovalPort<string> = {
    handler: ((steps: { prepare: Function; describe: Function; run: Function }, options: { flag?: string } = {}) => {
      handlerSteps.push(options);
      return async (c: ToolExecutionContext, o: never) => {
        const prepared = await steps.prepare({ ctx: c }, o);
        const description = await steps.describe({ ctx: c, prepared });
        const out = await steps.run({ ctx: c, prepared, confirmer: {} }, o);
        return { description, out };
      };
    }) as never,
    notConfirmed: vi.fn() as never,
  };
  const deps: PluginSourceToolsRequired<string> = {
    registration: { domain: 'plugins', catalogModule: 'catalog.ts', catalog, metadata: {} },
    workspaceId: 'ws1', authorize: authorize as never, toolIds, enablePermission: 'perm.enable', entityType: 'plugin',
    pluginSource: port as never, approvals, describeDelete: ({ target }) => `delete ${target.id}/${target.path}`, ...overrides,
  };
  const regs = buildPluginSourceRegistrations(deps);
  const by = (id: string): ToolRegistration => regs.find(r => r.descriptor.id === id)!;
  return { port, authorize, by, regs, handlerSteps };
}

describe('buildPluginSourceRegistrations', () => {
  it('registers one tool per catalog entry and classifies risks per operation', () => {
    const { regs } = setup();
    expect(regs.map(r => r.descriptor.id).sort()).toEqual(Object.values(toolIds).sort());
    expect([...risk.entries()].filter(([, v]) => v === 'none').map(([k]) => k).sort()).toEqual(['s_list', 's_read']);
    expect(risk.get('s_delete')).toBe('deletes-durable-state');
  });

  it('create reads name and description and authorizes with the tool permission', async () => {
    const { by, port, authorize } = setup();
    expect(await by('s_create').handler(ctx({ id: 'acme', name: 'Acme', description: 'd' }))).toEqual({ created: true });
    expect(port.create).toHaveBeenCalledWith({ id: 'acme', name: 'Acme', description: 'd' }, {});
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: 'perm.s_create', principalId: 'p1', workspaceId: 'ws1', entityType: 'plugin' }));
  });

  it('routes open, list, read, write, seal and rollback to the matching port call', async () => {
    const { by, port } = setup();
    expect(await by('s_open').handler(ctx({ id: 'a' }))).toEqual({ created: false });
    expect(await by('s_list').handler(ctx({ id: 'a' }))).toEqual({ files: [{ path: 'a.js', bytes: 3 }] });
    expect(await by('s_read').handler(ctx({ id: 'a', path: 'x.js' }))).toEqual({ content: 'hi', bytes: 2, digest: 'dg1' });
    expect(await by('s_write').handler(ctx({ id: 'a', path: 'x.js', content: 'zz' }))).toEqual({ bytesWritten: 4 });
    expect(await by('s_seal').handler(ctx({ id: 'a' }))).toEqual({ sealed: true });
    expect(await by('s_rollback').handler(ctx({ id: 'a' }))).toEqual({ rolledBack: true });
    expect(port.open).toHaveBeenCalledWith({ id: 'a' }, {});
    expect(port.list).toHaveBeenCalledWith({ id: 'a' }, {});
    expect(port.read).toHaveBeenCalledWith({ id: 'a', path: 'x.js' }, {});
    expect(port.write).toHaveBeenCalledWith({ id: 'a', path: 'x.js', content: 'zz' }, {});
    expect(port.seal).toHaveBeenCalledWith({ id: 'a' }, {});
    expect(port.rollback).toHaveBeenCalledWith({ id: 'a' }, {});
  });

  it('edit forwards replaceAll only when supplied and rejects a non-boolean', async () => {
    const { by, port } = setup();
    const base = { id: 'a', path: 'x', oldString: 'o', newString: 'n' };
    await by('s_edit').handler(ctx(base));
    expect(port.edit).toHaveBeenLastCalledWith(base, {});
    await by('s_edit').handler(ctx({ ...base, replaceAll: true }));
    expect(port.edit).toHaveBeenLastCalledWith({ ...base, replaceAll: true }, {});
    await expect(by('s_edit').handler(ctx({ ...base, replaceAll: 'yes' }))).rejects.toThrow('replaceAll must be a boolean.');
    expect(port.edit).toHaveBeenCalledTimes(2);
  });

  it('names the offending field when a string argument is missing or mistyped', async () => {
    const { by } = setup();
    await expect(by('s_create').handler(ctx({ id: 'a', name: 5, description: 'd' }))).rejects.toThrow('name must be a string.');
    await expect(by('s_write').handler(ctx({ id: 'a', path: 'p' }))).rejects.toThrow('content must be a string.');
    await expect(by('s_open').handler(ctx({}))).rejects.toBeInstanceOf(ToolInputError);
  });

  it('refuses before the port is touched when authorization is denied', async () => {
    const { by, port } = setup({ authorize: (async () => ({ allowed: false, reason: 'no' })) as never });
    await expect(by('s_list').handler(ctx({ id: 'a' }))).rejects.toThrow("principal 'p1' is not authorized for 'perm.s_list' (no)");
    expect(port.list).not.toHaveBeenCalled();
  });

  it('reports a missing plugin directory as a ToolInputError', async () => {
    const { by } = setup({ pluginSource: undefined });
    await expect(by('s_list').handler(ctx({ id: 'a' }))).rejects.toThrow('Site plugin source authoring is unavailable: this site has no plugin directory.');
  });

  it('relays typed source and install refusals as input errors and rethrows anything else', async () => {
    const { by, port } = setup();
    port.read.mockRejectedValueOnce(new PluginSourceError('SRC_X', 'bad path'));
    await expect(by('s_read').handler(ctx({ id: 'a', path: 'p' }))).rejects.toThrow('SRC_X: bad path');
    port.seal.mockRejectedValueOnce(new PluginInstallError('INST_Y', 'cannot seal'));
    const seen = await by('s_seal').handler(ctx({ id: 'a' })).catch((e: unknown) => e);
    expect(seen).toBeInstanceOf(ToolInputError);
    expect((seen as Error).message).toContain('INST_Y: cannot seal');
    const boom = new Error('io');
    port.seal.mockRejectedValueOnce(boom);
    await expect(by('s_seal').handler(ctx({ id: 'a' }))).rejects.toBe(boom);
  });

  it('delete reads the file first, pins its digest and authorizes with the enable permission', async () => {
    const { by, port, authorize, handlerSteps } = setup();
    const result = await by('s_delete').handler(ctx({ id: 'a', path: 'x.js' }));
    expect(result).toEqual({ description: 'delete a/x.js', out: { deleted: true } });
    expect(port.read).toHaveBeenCalledWith({ id: 'a', path: 'x.js' }, {});
    expect(port.delete).toHaveBeenCalledWith({ id: 'a', path: 'x.js' }, { expectedDigest: 'dg1' });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: 'perm.enable' }));
    expect(handlerSteps).toEqual([{ flag: 'deleted' }]);
  });

  it('delete refuses a missing owner and relays a failing delete', async () => {
    const missing = setup({ pluginSource: undefined });
    await expect(missing.by('s_delete').handler(ctx({ id: 'a', path: 'p' }))).rejects.toThrow('no plugin directory');
    const { by, port } = setup();
    port.delete.mockRejectedValueOnce(new PluginSourceError('SRC_STALE', 'changed'));
    await expect(by('s_delete').handler(ctx({ id: 'a', path: 'p' }))).rejects.toThrow('SRC_STALE: changed');
  });
});
