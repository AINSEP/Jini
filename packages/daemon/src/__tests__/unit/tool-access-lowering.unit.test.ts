import { describe, expect, it } from 'vitest';
import { stopRunsForToolAccessChange } from '../../tool-access-lowering.js';

describe('tool access lowering', () => {
  it('revokes every affected run before cancelling any, awaits cleanup, and leaves unrelated answers alone', async () => {
    const events: string[] = [];
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const work = stopRunsForToolAccessChange({
      runs: [{ runId: 'one', agentId: 'claude', serverIds: ['source'] }, { runId: 'two', agentId: 'codex', serverIds: ['source'] }, { runId: 'other', agentId: 'claude', serverIds: ['different'] }],
      change: { serverIds: ['source'] },
      revoke: ({ runId }) => { events.push(`revoke:${runId}`); },
      cancel: async ({ runId }) => { events.push(`cancel:${runId}`); },
      waitForCleanup: async ({ runId }) => { events.push(`wait:${runId}`); await waiting; },
      notice: async ({ runId, message }) => { events.push(`notice:${runId}:${message}`); },
    });
    await Promise.resolve(); await Promise.resolve();
    expect(events.slice(0, 2)).toEqual(['revoke:one', 'revoke:two']);
    expect(events.some(value => value.includes('other'))).toBe(false);
    let settled = false; void work.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    finish();
    expect(await work).toEqual({ stoppedRunIds: ['one', 'two'], failedRunIds: [] });
    expect(events).toContain('notice:one:Stopped because tool access changed.');
  });

  it('reports cleanup failure and continues stopping other affected runs', async () => {
    const notices: string[] = [];
    const result = await stopRunsForToolAccessChange({
      runs: [{ runId: 'broken', agentId: 'agy', pluginIds: ['mail'] }, { runId: 'ok', agentId: 'agy', pluginIds: ['mail'] }],
      change: { pluginIds: ['mail'] }, revoke: () => {}, cancel: async () => {},
      waitForCleanup: async ({ runId }) => { if (runId === 'broken') throw new Error('sentinel-secret'); },
      notice: async ({ message }) => { notices.push(message); },
    });
    expect(result).toEqual({ stoppedRunIds: ['ok'], failedRunIds: ['broken'] });
    expect(notices).toContain("Couldn't stop everything the agent started after tool access changed.");
    expect(JSON.stringify(result) + notices.join()).not.toContain('sentinel-secret');
  });

  it('still cancels and awaits cleanup when the status emission fails', async () => {
    const steps: string[] = [];
    const result = await stopRunsForToolAccessChange({ runs: [{ runId: 'one', agentId: 'a' }], change: { agentIds: ['a'] },
      revoke: () => { steps.push('revoke'); }, cancel: async () => { steps.push('cancel'); }, waitForCleanup: async () => { steps.push('cleanup'); }, notice: async () => { throw new Error('closed stream'); } });
    expect(steps).toEqual(['revoke', 'cancel', 'cleanup']);
    expect(result.failedRunIds).toEqual([]);
  });

  it('matches the selected agent without stopping another agent', async () => {
    const revoked: string[] = [];
    await stopRunsForToolAccessChange({ runs: [{ runId: 'one', agentId: 'a' }, { runId: 'two', agentId: 'b' }], change: { agentIds: ['a'] },
      revoke: ({ runId }) => { revoked.push(runId); }, cancel: async () => {}, waitForCleanup: async () => {}, notice: async () => {} });
    expect(revoked).toEqual(['one']);
  });
});

describe('admitted tool sources', () => {
  it('keeps source ownership across federation, plugin guidance, capabilities and executable tools', async () => {
    const { admittedToolSources } = await import('../../tool-access-lowering.js');
    expect(admittedToolSources({ tools: [
      { id: 'mcp__mail-source__read' }, { id: 'mcp__mail-source__write' },
      { id: 'agent_plugin_acme_mail' }, { id: 'plugin_capability_site_tools' },
      { id: 'p_acme_mail__send' }, { id: 'p_vendor.office__list' }, { id: 'content_read' },
    ] })).toEqual({ serverIds: ['mail-source'], pluginIds: ['acme-mail', 'site-tools', 'vendor.office'] });
  });
});


it('includes provisioned plugin ownership from the admitted descriptor without configuration reads', async () => {
  const { admittedToolSources } = await import('../../tool-access-lowering.js');
  expect(admittedToolSources({ tools: [{ id: 'mcp__mail__read', metadata: { mcpSource: { id: 'mail', host: 'mail.example', pluginId: 'mail-plugin' } } }] })).toEqual({ serverIds: ['mail'], pluginIds: ['mail-plugin'] });
});


it('never delays Stop for a status emitter that remains pending', async () => {
  const steps: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const work = stopRunsForToolAccessChange({ runs: [{ runId: 'one', agentId: 'a' }], change: { agentIds: ['a'] },
    revoke: () => {}, cancel: async () => { steps.push('cancel'); }, waitForCleanup: async () => { steps.push('cleaned'); }, notice: () => held });
  await Promise.resolve(); await Promise.resolve();
  expect(steps).toEqual(['cancel', 'cleaned']);
  release(); await work;
});
