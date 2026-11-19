import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleLogger } from '@jini-ai/core';
import { parsePluginCredentialCards } from '../../lifecycle/credential-card-metadata.js';
import { mergePluginCredentialCards } from '../credential-cards.js';
import { loadPluginCredentialCardsSafely } from '../plugin-credential-card.js';
import { createAgentPluginToolGate } from '../../lifecycle/host-tools/skill-tool.js';
import type { AgentPluginHostToolPorts } from '../../lifecycle/host-tools/ports.js';
import { provisionAgentPluginMcpServers } from '../federate-mcp.js';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';

const secret = 'SENTINEL_PRIVATE_C';
afterEach(() => vi.restoreAllMocks());
describe('sheet C reporting and safe outcomes', () => {
  it('refuses malformed manifest JSON without returning parser input or stack', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePluginCredentialCards({ raw: `{ "token": "${secret}"` })).toEqual({ ok: false, reason: 'invalid credential cards' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
    const onWarning = vi.fn();
    expect(parsePluginCredentialCards({ raw: `{ \"token\": \"${secret}\"` }, { onWarning })).toEqual({ ok: false, reason: 'invalid credential cards' });
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith('[agent-plugins] Invalid credential cards.');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retains precise declaration refusals and existing warning-callback failure handling', () => {
    expect(parsePluginCredentialCards({ raw: '[]' })).toEqual({ ok: false, reason: 'plugin manifest must be an object' });
    expect(parsePluginCredentialCards({ raw: '{"extensions":{"jini":{"credentialCards":"bad"}}}' })).toEqual({ ok: false, reason: 'credentialCards must be an array of at most 32 cards' });
    const failure = new Error('Host warning refused');
    expect(parsePluginCredentialCards({ raw: '{"extensions":{"tovu":{"credentialCards":[]}}}' }, { onWarning: () => { throw failure; } })).toEqual({ ok: false, reason: 'Host warning refused' });
  });

  it('retains collision refusal callbacks and their safe default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const card: PluginCredentialCard = { providerId: 'one', label: 'Example', category: 'hosting', baseUrl: 'https://example.test', title: 'Connect', intro: 'Connect account', keyHint: 'Key' };
    const other = { ...card, pluginId: 'second' };
    const refusal = vi.fn();
    expect(mergePluginCredentialCards({ mailCards: [card], manifestCards: [other] }, { onRefusal: refusal })).toEqual([]);
    expect(refusal).toHaveBeenCalledTimes(2);
    expect(mergePluginCredentialCards({ mailCards: [card], manifestCards: [other] })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([new Error(secret), secret])('keeps optional lookup failure harmless and warns once', async failure => {
    const warn = vi.fn();
    expect(await loadPluginCredentialCardsSafely({ workspaceId: 'ws', loadCards: () => Promise.reject(failure) }, { warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
  });

  it('reports denied activation with fixed copy and performs no installation check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const installed = vi.fn();
    const ports = {
      report: createConsoleLogger({ prefix: '' }),
      layout: { forWorkspace: () => ({ root: '/ws', pluginPackagesDir: () => '/ws/plugins' }) },
      activations: { resolveAgentPluginActivation: async () => ({ verdict: 'undetermined', reason: secret }) },
      lifecycle: { isInstalledDigestPresent: installed },
    } as unknown as AgentPluginHostToolPorts;
    const gate = createAgentPluginToolGate({ workspaceId: 'ws', ports });
    expect(await gate.isCallable({ pluginId: 'plugin', archiveDigest: 'digest' })).toBe(false);
    expect(installed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Tool call denied: activation could not be established.');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
  });

  it.each([{ failure: new Error(secret), injected: true }, { failure: secret, injected: true }, { failure: new Error(secret), injected: false }])('reports caught provisioning once and returns no exception', async ({ failure, injected }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diagnostics: unknown[] = [];
    const report = createConsoleLogger({ prefix: '' }, { diagnostics: record => diagnostics.push(record.error) });
    const notify = vi.fn(async () => {});
    const deps = { repo: { findByServerId: () => Promise.reject(failure) }, saveServer: vi.fn(), projections: {}, classifyError: () => 'other', notifyRosterChanged: notify } as unknown as Parameters<typeof provisionAgentPluginMcpServers>[0];
    const result = await provisionAgentPluginMcpServers(deps, { workspaceId: 'ws', principalId: 'admin', pluginId: 'plugin', servers: { remote: { type: 'streamable-http', url: 'https://example.test/mcp' } }, classifyTrust: () => 'auto-admit', messages: { sseTransportUnsupported: () => 'Unsupported', headersUnsupported: () => 'Unsupported' } }, injected ? { report } : {});
    expect(result).toEqual({ provisioned: [], alreadyProvisioned: [], adopted: [], skipped: [], failed: [{ serverKey: 'remote', reason: 'MCP provisioning write failed' }] });
    expect(result.failed[0]).not.toHaveProperty('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
    expect(diagnostics).toEqual(injected ? [failure] : []);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

it.each([Object.assign(new Error(secret), { stack: secret }), secret])('keeps malformed JSON refusal fixed when its warning port throws', error => {
  const onWarning = vi.fn(() => { throw error; });
  expect(parsePluginCredentialCards({ raw: '{' }, { onWarning })).toEqual({ ok: false, reason: 'invalid credential cards' });
  expect(onWarning).toHaveBeenCalledTimes(1);
});
