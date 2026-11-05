import { describe, expect, it } from 'vitest';
import { createChatSettingsSnapshot, createChatSettingsGetRegistration } from '../../chat-settings.js';

const permissions = { enabled: true, capabilities: { shell: true, fileWrite: true, userMcp: false, subagents: true, userSettings: true, web: true, workflows: true, loginEnvironment: true } };
const input = { agentId: 'claude', model: 'sonnet', effort: 'high', permissions, plan: { verdict: 'RUN' as const, loadsOwn: false }, isolation: 'perRun' as const,
  toolIds: ['site_read', 'plugin_action'], servers: [{ id: 'external', transport: 'http', url: 'https://user:SENTINEL_PASSWORD@tools.example.test/private/SENTINEL_PATH?token=SENTINEL_TOKEN' }, { id: 'local', transport: 'stdio', args: ['SENTINEL_ARGS'], env: { key: 'SENTINEL_ENV' } }] };

describe('run-bound chat settings', () => {
  it('projects the actual launch snapshot and hostname only, excluding foreign secrets', () => {
    const snapshot = createChatSettingsSnapshot(input, {});
    expect(snapshot.capabilities.userMcp).toBe(false);
    expect(snapshot.source).toBe('provided');
    expect(snapshot.servers).toEqual([{ id: 'external', host: 'tools.example.test' }, { id: 'local', host: 'local command' }]);
    expect(snapshot.toolIds).toEqual(['site_read', 'plugin_action']);
    expect(JSON.stringify(snapshot)).not.toContain('SENTINEL');
    permissions.capabilities.shell = false;
    expect(snapshot.capabilities.shell).toBe(true);
    permissions.capabilities.shell = true;
  });
  it('bounds UTF-8 output to 2 KiB and explicitly marks a truncated inventory', () => {
    const snapshot = createChatSettingsSnapshot({ ...input, toolIds: Array.from({ length: 1000 }, (_, i) => `tool_${i}_${'x'.repeat(100)}`), servers: Array.from({ length: 100 }, (_, i) => ({ id: `server-${i}`, transport: 'http', url: 'https://tools.example.test/secret' })) }, {});
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(2048);
    expect(snapshot.truncated).toBe(true);
  });
  it('projects host-locked and per-agent origins without accepting arbitrary plan details', () => {
    const snapshot = createChatSettingsSnapshot({ ...input, sourceByKey: { enabled: 'host_locked', userMcp: 'byAgent' }, plan: { verdict: 'SETUP', reason: 'host_locked', keys: ['userMcp'] } }, {});
    expect(snapshot.sources.enabled).toBe('host_locked');
    expect(snapshot.sources.userMcp).toBe('byAgent');
    expect(snapshot.keys).toEqual(['userMcp']);
    expect(snapshot.reason).toBe('host_locked');
  });
  it('binds the argument-free tool to the authenticated execution context', async () => {
    const seen: unknown[] = [];
    const snapshot = createChatSettingsSnapshot(input, {});
    const tool = createChatSettingsGetRegistration({ readSnapshot: query => { seen.push(query); return query.runId === 'own' && query.principalId === 'owner' ? snapshot : undefined; } }, {});
    const ctx = { executionId: 'call', principal: { id: 'owner' }, run: { id: 'own' }, input: {}, signal: new AbortController().signal } as Parameters<typeof tool.handler>[0];
    expect(await tool.handler(ctx)).toEqual(snapshot);
    expect(seen).toEqual([{ runId: 'own', principalId: 'owner' }]);
    for (const input of [{ runId: 'foreign' }, { site: 'other' }, { principalId: 'other' }, null, []]) {
      await expect(tool.handler({ ...ctx, input })).rejects.toThrow('takes no arguments');
    }
    await expect(tool.handler({ ...ctx, run: { id: 'foreign' } })).rejects.toThrow('unavailable for this run');
    expect(tool.descriptor.requiresConfirmation).toBe(false);
    expect(tool.descriptor.readOnly).toBe(true);
  });
});
