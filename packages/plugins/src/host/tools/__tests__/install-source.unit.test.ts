/** The install and source registrations, imported from their source modules (the public-entry test
 * covers the same builders through the built package entry). Every port is an injected recorder. */
import { describe, expect, it } from 'vitest';
import { createApprovalHandler, ToolInputError, type AgentToolDefinition, type ToolExecutionContext } from '@jini-ai/core';
import { buildPluginInstallRegistrations, pluginInstallDerivedRiskFor } from '../install.js';
import { buildPluginSourceRegistrations, pluginSourceDerivedRiskFor } from '../source.js';
import { PluginInstallError, PluginSourceError } from '../../plugin-tool-errors.js';
import type { PluginApprovalPort, PluginInstallToolsRequired } from '../contract.js';
import type { PluginInstallPreview } from '../../node/install.js';
import type { PluginSourcePort } from '../../node/source-drafts.js';

const ctx = (input: unknown, signal = new AbortController().signal): ToolExecutionContext => ({ executionId: 'call-1', principal: { id: 'human-1' }, run: { id: 'run-1' }, signal, input });
const preview: PluginInstallPreview = { id: 'tally', name: 'Tally', version: '2.0.0', tier: 'tier-3', capabilities: [], hooks: [], hasCode: true, digest: 'digest-a', contentTypes: [], conflicts: [] };

function installFixture(patch: Partial<PluginInstallToolsRequired<{ archive: string }>> = {}) {
  const events: unknown[] = [];
  const deps: PluginInstallToolsRequired<{ archive: string }> = {
    registration: { domain: 'inst', catalogModule: 'inst/catalog', catalog: [{ name: 'inst_install', description: 'install', sideEffects: 'mutates-durable-state', authorization: { permission: 'inst.write' }, inputSchema: { type: 'object' } }], metadata: {} },
    workspaceId: 'ws-1',
    authorize: async (input) => { events.push(['authorize', input]); return { allowed: true, reason: 'ok' }; },
    toolId: 'inst_install', permission: 'inst.write', entityType: 'inst-package',
    parseRequest: ({ input }) => { events.push(['parse', input]); return { archive: 'a1' }; },
    localInstallEnabled: () => true,
    installInput: async (required) => { events.push(['input', required]); return { archive: new Uint8Array([7]) }; },
    installer: {
      preview: async (input) => { events.push(['preview', input]); return preview; },
      install: async (input) => { events.push(['install', input]); return { ...preview, upgradeFrom: '1.0.0' }; },
    },
    riskSentence: ({ preview: seen }) => `risk:${seen.id}`,
    messages: { localInstallDisabledNote: 'local install off', installedNote: ({ name, version }) => `installed ${name}@${version} OFF`, retryInstallHint: ' retry hint' },
    telemetry: { installed: (input) => events.push(['installed', input]), installFailed: (input) => events.push(['failed', input]) },
    ...patch,
  };
  const handler = buildPluginInstallRegistrations(deps)[0]!.handler;
  return { events, handler };
}

describe('buildPluginInstallRegistrations', () => {
  it('authorizes, parses, previews, then installs the previewed digest and reports the plugin OFF', async () => {
    const { events, handler } = installFixture();
    expect(await handler(ctx({ any: 1 }), {})).toEqual({
      installed: true, enabled: false,
      plugin: { id: 'tally', name: 'Tally', version: '2.0.0', tier: 'tier-3', upgradeFrom: '1.0.0' },
      warning: 'risk:tally', note: 'installed Tally@2.0.0 OFF',
    });
    expect(events).toEqual([
      ['authorize', { workspaceId: 'ws-1', principalId: 'human-1', permission: 'inst.write', entityType: 'inst-package' }],
      ['parse', { any: 1 }],
      ['input', { request: { archive: 'a1' }, ownerId: 'human-1', runId: 'run-1' }],
      ['preview', { archive: new Uint8Array([7]) }],
      ['install', { archive: new Uint8Array([7]), expectedDigest: 'digest-a' }],
      ['installed', { principalId: 'human-1', pluginId: 'tally' }],
    ]);
  });

  it('omits upgradeFrom for a first install', async () => {
    const { handler } = installFixture({ installer: { preview: async () => preview, install: async () => preview } });
    expect(await handler(ctx({}), {})).toMatchObject({ plugin: { id: 'tally', name: 'Tally', version: '2.0.0', tier: 'tier-3' } });
    expect(Object.keys(((await handler(ctx({}), {})) as { plugin: object }).plugin)).toEqual(['id', 'name', 'version', 'tier']);
  });

  it('refuses before any input is built when local install is off or no installer exists', async () => {
    for (const patch of [{ localInstallEnabled: () => false }, { installer: undefined }]) {
      const { events, handler } = installFixture(patch);
      expect(await handler(ctx({}), {})).toEqual({ installed: false, reason: 'PLUGIN_LOCAL_INSTALL_DISABLED', note: 'local install off' });
      expect(events.map((event) => (event as unknown[])[0])).toEqual(['authorize', 'parse']);
    }
  });

  it('stops at a denied permission before parsing', async () => {
    const { events, handler } = installFixture({ authorize: async () => ({ allowed: false, reason: 'nope' }) });
    await expect(handler(ctx({}), {})).rejects.toThrow("principal 'human-1' is not authorized for 'inst.write' (nope)");
    expect(events).toEqual([]);
  });

  it('turns a preview refusal into a model input error and rethrows any other preview failure', async () => {
    const refused = installFixture({ installer: { preview: async () => { throw new PluginInstallError('PLUGIN_MANIFEST_INVALID', 'bad manifest'); }, install: async () => preview } });
    const error = await refused.handler(ctx({}), {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toBe('PLUGIN_MANIFEST_INVALID: bad manifest');
    const crash = new Error('disk gone');
    const broken = installFixture({ installer: { preview: async () => { throw crash; }, install: async () => preview } });
    await expect(broken.handler(ctx({}), {})).rejects.toBe(crash);
  });

  it('does not install after the call was aborted during preview', async () => {
    const abort = new AbortController();
    const { events, handler } = installFixture({ installer: { preview: async () => { abort.abort(new Error('user stopped')); return preview; }, install: async () => { throw new Error('must not install'); } } });
    await expect(handler(ctx({}, abort.signal), {})).rejects.toThrow('user stopped');
    expect(events.some((event) => (event as unknown[])[0] === 'failed')).toBe(false);
  });

  it('relays an install refusal with the retry hint only for a changed package, and records refused', async () => {
    for (const [code, note] of [['PLUGIN_CHANGED_SINCE_PREVIEW', 'Nothing was installed: changed retry hint'], ['PLUGIN_INSTALL_BUSY', 'Nothing was installed: changed']] as const) {
      const { events, handler } = installFixture({ installer: { preview: async () => preview, install: async () => { throw new PluginInstallError(code, 'changed'); } } });
      expect(await handler(ctx({}), {})).toEqual({ installed: false, pluginId: 'tally', reason: code, note });
      expect(events.at(-1)).toEqual(['failed', { principalId: 'human-1', reasonClass: 'refused' }]);
    }
  });

  it('rethrows an internal install failure after recording it, and works without telemetry', async () => {
    const crash = new Error('write failed');
    const { events, handler } = installFixture({ installer: { preview: async () => preview, install: async () => { throw crash; } } });
    await expect(handler(ctx({}), {})).rejects.toBe(crash);
    expect(events.at(-1)).toEqual(['failed', { principalId: 'human-1', reasonClass: 'internal' }]);
    const silent = installFixture({ telemetry: undefined, installer: { preview: async () => preview, install: async () => { throw crash; } } });
    await expect(silent.handler(ctx({}), {})).rejects.toBe(crash);
    const ok = installFixture({ telemetry: undefined });
    expect(await ok.handler(ctx({}), {})).toMatchObject({ installed: true });
  });

  it('derives durable-write risk for the install tool id', () => {
    expect([...pluginInstallDerivedRiskFor({ toolId: 'x_install' })]).toEqual([['x_install', 'mutates-durable-state']]);
  });
});

const ops = ['create', 'open', 'list', 'read', 'write', 'edit', 'delete', 'seal', 'rollback'] as const;
const toolIds = Object.fromEntries(ops.map((op) => [op, `src_${op}`])) as Record<typeof ops[number], string>;
const catalog: AgentToolDefinition[] = ops.map((op) => ({ name: toolIds[op], description: op, sideEffects: op === 'list' || op === 'read' ? 'none' : op === 'delete' ? 'deletes-durable-state' : 'mutates-durable-state', authorization: { permission: `perm.${op}` }, inputSchema: { type: 'object' } }));

const sealed = { installed: true as const, plugin: preview, reloaded: false };
function sourceFixture(options: { port?: Partial<PluginSourcePort> | null; confirmed?: boolean; allow?: (permission: string) => boolean } = {}) {
  const calls: unknown[] = [];
  const record = <T>(name: string, result: T) => async (...args: unknown[]): Promise<T> => { calls.push([name, ...args]); return result; };
  const port: PluginSourcePort = {
    create: record('create', { created: true }), open: record('open', { created: false }), list: record('list', { files: [] }),
    read: record('read', { content: 'old', bytes: 3, digest: 'dg-1' }), write: record('write', { bytesWritten: 3 }),
    edit: record('edit', { bytesWritten: 4, replacements: 1 }), delete: record('delete', { deleted: true }),
    seal: record('seal', sealed), rollback: record('rollback', { ...sealed, rollbackFrom: '1.0.0' }),
    isSealedHere: record('isSealedHere', false), readApproval: record<readonly string[] | undefined>('readApproval', undefined), recordApproval: record<void>('recordApproval', undefined),
    ...(options.port ?? {}),
  };
  const approvals: PluginApprovalPort<string> = {
    handler: (steps, approvalOptions) => createApprovalHandler({
      prepare: steps.prepare,
      describe: async ({ ctx: context, prepared }) => ({ ask: true, description: await steps.describe({ ctx: context, prepared }) }),
      askHuman: async ({ description }) => { calls.push(['ask', description]); return options.confirmed === false ? { confirmed: false, reason: 'declined' } : { confirmed: true }; },
      run: ({ ctx: context, prepared, confirmer, choice }, execution) => steps.run({ ctx: context, prepared, confirmer, ...(choice === undefined ? {} : { choice }) }, execution),
      notConfirmed: () => ({ [approvalOptions?.flag ?? 'done']: false }),
    }),
    notConfirmed: () => ({ cancelled: true, note: 'no' }),
  };
  const registrations = buildPluginSourceRegistrations({
    registration: { domain: 'src', catalogModule: 'src/catalog', catalog, metadata: {} }, workspaceId: 'ws-1',
    authorize: async (input) => { calls.push(['auth', input.permission]); return { allowed: options.allow?.(input.permission) ?? true, reason: 'policy' }; },
    toolIds, enablePermission: 'perm.enable', entityType: 'src-package', approvals,
    describeDelete: ({ target }) => `delete ${target.id}/${target.path}`,
    ...(options.port === null ? {} : { pluginSource: port }),
  });
  const run = (op: typeof ops[number], input: unknown) => registrations.find((r) => r.descriptor.id === toolIds[op])!.handler(ctx(input), {});
  return { calls, run };
}

describe('buildPluginSourceRegistrations', () => {
  it('dispatches each direct operation to its port method with the fields it reads, under the catalog permission', async () => {
    const { calls, run } = sourceFixture();
    expect(await run('create', { id: 'p1', name: 'P', description: 'D' })).toEqual({ created: true });
    expect(await run('open', { id: 'p1' })).toEqual({ created: false });
    expect(await run('list', { id: 'p1' })).toEqual({ files: [] });
    expect(await run('read', { id: 'p1', path: 'a.mjs' })).toEqual({ content: 'old', bytes: 3, digest: 'dg-1' });
    expect(await run('write', { id: 'p1', path: 'a.mjs', content: 'new' })).toEqual({ bytesWritten: 3 });
    expect(await run('edit', { id: 'p1', path: 'a.mjs', oldString: 'o', newString: 'n' })).toEqual({ bytesWritten: 4, replacements: 1 });
    await run('edit', { id: 'p1', path: 'a.mjs', oldString: 'o', newString: 'n', replaceAll: true });
    expect(await run('seal', { id: 'p1' })).toEqual(sealed);
    expect(await run('rollback', { id: 'p1' })).toEqual({ ...sealed, rollbackFrom: '1.0.0' });
    expect(calls).toEqual([
      ['auth', 'perm.create'], ['create', { id: 'p1', name: 'P', description: 'D' }, {}],
      ['auth', 'perm.open'], ['open', { id: 'p1' }, {}],
      ['auth', 'perm.list'], ['list', { id: 'p1' }, {}],
      ['auth', 'perm.read'], ['read', { id: 'p1', path: 'a.mjs' }, {}],
      ['auth', 'perm.write'], ['write', { id: 'p1', path: 'a.mjs', content: 'new' }, {}],
      ['auth', 'perm.edit'], ['edit', { id: 'p1', path: 'a.mjs', oldString: 'o', newString: 'n' }, {}],
      ['auth', 'perm.edit'], ['edit', { id: 'p1', path: 'a.mjs', oldString: 'o', newString: 'n', replaceAll: true }, {}],
      ['auth', 'perm.seal'], ['seal', { id: 'p1' }, {}],
      ['auth', 'perm.rollback'], ['rollback', { id: 'p1' }, {}],
    ]);
  });

  it('names a non-string field and a non-boolean replaceAll as input errors without calling the port', async () => {
    const { calls, run } = sourceFixture();
    await expect(run('create', { id: 'p1', name: 'P', description: 3 })).rejects.toThrow(new ToolInputError({ message: 'description must be a string.' }));
    await expect(run('write', { id: 'p1', path: 'a.mjs' })).rejects.toThrow('content must be a string.');
    await expect(run('edit', { id: 'p1', path: 'a', oldString: 'o', newString: 'n', replaceAll: 'yes' })).rejects.toThrow('replaceAll must be a boolean.');
    expect(calls.filter((call) => (call as unknown[])[0] !== 'auth')).toEqual([]);
  });

  it('reports a missing source owner before reading fields, and refuses a denied permission before anything', async () => {
    const missing = sourceFixture({ port: null });
    await expect(missing.run('create', { id: 'p1' })).rejects.toThrow('Site plugin source authoring is unavailable: this site has no plugin directory.');
    const denied = sourceFixture({ allow: () => false });
    await expect(denied.run('list', { id: 'p1' })).rejects.toThrow("principal 'human-1' is not authorized for 'perm.list' (policy)");
    expect(denied.calls).toEqual([['auth', 'perm.list']]);
  });

  it('relays source and install refusals as coded input errors and rethrows anything else unchanged', async () => {
    const sourceRefusal = sourceFixture({ port: { open: async () => { throw new PluginSourceError('SOURCE_SEALED', 'sealed'); } } });
    await expect(sourceRefusal.run('open', { id: 'p1' })).rejects.toThrow(new ToolInputError({ message: 'SOURCE_SEALED: sealed' }));
    const installRefusal = sourceFixture({ port: { seal: async () => { throw new PluginInstallError('PLUGIN_INSTALL_BUSY', 'busy'); } } });
    await expect(installRefusal.run('seal', { id: 'p1' })).rejects.toThrow('PLUGIN_INSTALL_BUSY: busy');
    const crash = new Error('io');
    const other = sourceFixture({ port: { list: async () => { throw crash; } } });
    await expect(other.run('list', { id: 'p1' })).rejects.toBe(crash);
  });

  it('asks before deleting, then deletes the approved file pinned to the digest read at preparation', async () => {
    const { calls, run } = sourceFixture();
    expect(await run('delete', { id: 'p1', path: 'a.mjs' })).toEqual({ deleted: true });
    expect(calls).toEqual([
      ['auth', 'perm.enable'], ['read', { id: 'p1', path: 'a.mjs' }, {}],
      ['ask', 'delete p1/a.mjs'],
      ['auth', 'perm.enable'], ['delete', { id: 'p1', path: 'a.mjs' }, { expectedDigest: 'dg-1' }],
    ]);
  });

  it('deletes nothing when the human declines', async () => {
    const { calls, run } = sourceFixture({ confirmed: false });
    expect(await run('delete', { id: 'p1', path: 'a.mjs' })).toEqual({ deleted: false });
    expect(calls.some((call) => (call as unknown[])[0] === 'delete')).toBe(false);
  });

  it('derives read-only risk for list/read, deletion for delete, and durable writes for the rest', () => {
    expect(Object.fromEntries(pluginSourceDerivedRiskFor({ toolIds }))).toEqual({
      src_create: 'mutates-durable-state', src_open: 'mutates-durable-state', src_list: 'none', src_read: 'none',
      src_write: 'mutates-durable-state', src_edit: 'mutates-durable-state', src_delete: 'deletes-durable-state',
      src_seal: 'mutates-durable-state', src_rollback: 'mutates-durable-state',
    });
  });
});
