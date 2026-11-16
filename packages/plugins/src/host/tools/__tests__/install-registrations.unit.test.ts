/**
 * @file Public-behaviour tests for `buildPluginInstallRegistrations`: ordering of the
 * authorize -> parse -> opt-in gate -> preview -> install sequence and every result shape.
 */
import { describe, expect, it, vi } from 'vitest';
import { ToolInputError, type AgentToolDefinition, type ToolExecutionContext } from '@jini-ai/core';
import { buildPluginInstallRegistrations, pluginInstallDerivedRiskFor } from '../install.js';
import { PluginInstallError } from '../../plugin-tool-errors.js';
import type { PluginInstallToolsRequired } from '../contract.js';
import type { PluginInstallPreview } from '../../node/install.js';

const TOOL = 'plugin_install';
const catalog: AgentToolDefinition[] = [{
  name: TOOL, description: 'install a plugin', sideEffects: 'mutates-durable-state',
  authorization: { permission: 'plugins.install' }, inputSchema: { type: 'object' },
}];
const preview: PluginInstallPreview = {
  id: 'acme', name: 'Acme', version: '1.2.3', tier: 'tier-3', capabilities: [], hooks: [], hasCode: true,
  digest: 'sha-prev', contentTypes: [], conflicts: [],
};

function ctx(input: unknown = { dir: '/x' }): ToolExecutionContext {
  return { executionId: 'e1', principal: { id: 'p1' }, run: { id: 'r1' }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

function setup(overrides: Partial<PluginInstallToolsRequired<{ dir: string }>> = {}) {
  const installer = {
    preview: vi.fn(async () => preview),
    install: vi.fn(async () => ({ ...preview, upgradeFrom: undefined as string | undefined })),
  };
  const telemetry = { installed: vi.fn(), installFailed: vi.fn() };
  const authorize = vi.fn(async () => ({ allowed: true as const }));
  const deps: PluginInstallToolsRequired<{ dir: string }> = {
    registration: { domain: 'plugins', catalogModule: 'catalog.ts', catalog, metadata: {} },
    workspaceId: 'ws1', authorize: authorize as never, toolId: TOOL, permission: 'plugins.install', entityType: 'plugin',
    parseRequest: ({ input }) => input as { dir: string },
    localInstallEnabled: () => true,
    installInput: vi.fn(async ({ request }) => ({ sourceDir: request.dir })),
    installer, riskSentence: ({ preview: p }) => `risk:${p.id}`,
    messages: { localInstallDisabledNote: 'disabled-note', installedNote: ({ name, version }) => `installed ${name}@${version}`, retryInstallHint: ' RETRY' },
    telemetry, ...overrides,
  };
  const [registration] = buildPluginInstallRegistrations(deps);
  return { registration: registration!, installer, telemetry, authorize, deps };
}

describe('buildPluginInstallRegistrations', () => {
  it('registers the single tool with its catalog descriptor', () => {
    const { registration } = setup();
    expect(registration.descriptor).toMatchObject({ id: TOOL, description: 'install a plugin', sideEffects: 'mutates-durable-state', readOnly: false });
  });

  it('classifies the tool as a durable-state mutation', () => {
    expect(pluginInstallDerivedRiskFor({ toolId: 'x' }).get('x')).toBe('mutates-durable-state');
  });

  it('installs with the previewed digest and reports the plugin OFF with note and warning', async () => {
    const { registration, installer, telemetry, authorize } = setup();
    const result = await registration.handler(ctx());
    expect(result).toEqual({
      installed: true, enabled: false,
      plugin: { id: 'acme', name: 'Acme', version: '1.2.3', tier: 'tier-3' },
      warning: 'risk:acme', note: 'installed Acme@1.2.3',
    });
    expect(installer.preview).toHaveBeenCalledWith({ sourceDir: '/x' });
    expect(installer.install).toHaveBeenCalledWith({ sourceDir: '/x', expectedDigest: 'sha-prev' });
    expect(telemetry.installed).toHaveBeenCalledWith({ principalId: 'p1', pluginId: 'acme' });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ principalId: 'p1', permission: 'plugins.install', workspaceId: 'ws1' }));
  });

  it('includes upgradeFrom when the install replaced a version, and works without telemetry', async () => {
    const { registration, installer } = setup({ telemetry: undefined });
    installer.install.mockResolvedValueOnce({ ...preview, upgradeFrom: '1.0.0' });
    const result = await registration.handler(ctx()) as { plugin: Record<string, unknown> };
    expect(result.plugin).toEqual({ id: 'acme', name: 'Acme', version: '1.2.3', tier: 'tier-3', upgradeFrom: '1.0.0' });
  });

  it('refuses a denied principal before parsing or touching the installer', async () => {
    const parseRequest = vi.fn();
    const { registration, installer } = setup({ authorize: (async () => ({ allowed: false, reason: 'nope' })) as never, parseRequest });
    await expect(registration.handler(ctx())).rejects.toThrow("principal 'p1' is not authorized for 'plugins.install' (nope)");
    expect(parseRequest).not.toHaveBeenCalled();
    expect(installer.preview).not.toHaveBeenCalled();
  });

  it('returns the disabled result when local install is off', async () => {
    const { registration, installer } = setup({ localInstallEnabled: () => false });
    expect(await registration.handler(ctx())).toEqual({ installed: false, reason: 'PLUGIN_LOCAL_INSTALL_DISABLED', note: 'disabled-note' });
    expect(installer.preview).not.toHaveBeenCalled();
  });

  it('returns the disabled result when no installer is supplied', async () => {
    const { registration } = setup({ installer: undefined });
    expect(await registration.handler(ctx())).toEqual({ installed: false, reason: 'PLUGIN_LOCAL_INSTALL_DISABLED', note: 'disabled-note' });
  });

  it('turns a preview PluginInstallError into a ToolInputError carrying code and message', async () => {
    const { registration, installer } = setup();
    installer.preview.mockRejectedValueOnce(new PluginInstallError('PLUGIN_BAD', 'bad package'));
    const error = await registration.handler(ctx()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toContain('PLUGIN_BAD: bad package');
    expect(installer.install).not.toHaveBeenCalled();
  });

  it('rethrows non-install preview failures unchanged', async () => {
    const { registration, installer } = setup();
    const boom = new Error('disk gone');
    installer.preview.mockRejectedValueOnce(boom);
    await expect(registration.handler(ctx())).rejects.toBe(boom);
  });

  it('does not install when the run was aborted after preview', async () => {
    const { registration, installer } = setup();
    const controller = new AbortController();
    installer.preview.mockImplementationOnce(async () => { controller.abort(new Error('stopped')); return preview; });
    await expect(registration.handler({ ...ctx(), signal: controller.signal })).rejects.toThrow('stopped');
    expect(installer.install).not.toHaveBeenCalled();
  });

  it('relays an install-time refusal and appends the retry hint only for a changed preview', async () => {
    const { registration, installer, telemetry } = setup();
    installer.install.mockRejectedValueOnce(new PluginInstallError('PLUGIN_CHANGED_SINCE_PREVIEW', 'bytes changed'));
    expect(await registration.handler(ctx())).toEqual({
      installed: false, pluginId: 'acme', reason: 'PLUGIN_CHANGED_SINCE_PREVIEW', note: 'Nothing was installed: bytes changed RETRY',
    });
    expect(telemetry.installFailed).toHaveBeenCalledWith({ principalId: 'p1', reasonClass: 'refused' });
    installer.install.mockRejectedValueOnce(new PluginInstallError('PLUGIN_BUSY', 'locked'));
    expect(await registration.handler(ctx())).toEqual({
      installed: false, pluginId: 'acme', reason: 'PLUGIN_BUSY', note: 'Nothing was installed: locked',
    });
  });

  it('records internal failures in telemetry and rethrows them', async () => {
    const { registration, installer, telemetry } = setup();
    const boom = new Error('kaboom');
    installer.install.mockRejectedValueOnce(boom);
    await expect(registration.handler(ctx())).rejects.toBe(boom);
    expect(telemetry.installFailed).toHaveBeenCalledWith({ principalId: 'p1', reasonClass: 'internal' });
  });

  it('rethrows internal failures when telemetry is absent', async () => {
    const { registration, installer } = setup({ telemetry: undefined });
    const boom = new Error('kaboom');
    installer.install.mockRejectedValueOnce(boom);
    await expect(registration.handler(ctx())).rejects.toBe(boom);
  });
});
