import { describe, expect, it } from 'vitest';
import { probeCopilotSdk, probeDroidSdk } from '../model-discovery-sdk.js';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/chosen/cli', cwd: '/project', env: { HOME: '/fake' } };
describe('official metadata SDK category', () => {
  it('reads Copilot catalog metadata without creating a session and closes the client', async () => {
    const calls: string[] = [];
    const result = await probeCopilotSdk(context, new AbortController().signal, { createClient: async (scope) => {
      expect(scope).toBe(context);
      return { start: async () => { calls.push('start'); }, listModels: async () => { calls.push('models'); return [{ id: 'gpt-new', name: 'GPT New' }, { id: 'auto', name: 'Auto' }]; }, forceStop: async () => { calls.push('stop'); } };
    } });
    expect(result.models).toEqual([{ id: 'gpt-new', label: 'GPT New', identityKind: 'concrete' }, { id: 'auto', label: 'Auto', identityKind: 'routing-mode' }]);
    expect(calls).toEqual(['start', 'models', 'stop']);
  });
  it('stops a Copilot handshake when the probe is cancelled', async () => {
    const controller = new AbortController(); let stops = 0;
    await expect(probeCopilotSdk(context, controller.signal, { createClient: async () => ({
      start: async () => { controller.abort(); }, listModels: async () => { throw new Error('Must not request models after cancellation'); }, forceStop: async () => { stops++; },
    }) })).rejects.toThrow('timeout');
    expect(stops).toBeGreaterThanOrEqual(1);
  });
  it('uses the selected Droid executable, cwd, and process-tree cancellation through a fake port', async () => {
    const process: ModelDiscoveryDeps['process'] = { async run(input) {
      expect(input.context.cwd).toBe('/project');
      expect(input.context.executable).toBe('python3');
      expect(input.args.at(-1)).toBe('/chosen/cli');
      expect(input.args[1]).toContain('list_models');
      expect(input.args[1]).not.toContain('session');
      expect(input.terminateProcessTree).toBe(true);
      return { stdout: '{"models":[{"id":"claude-new","name":"Claude New","provider":"anthropic"}]}', stderr: '' };
    } };
    const result = await probeDroidSdk(context, { process } as ModelDiscoveryDeps, new AbortController().signal);
    expect(result.models).toEqual([{ id: 'claude-new', label: 'Claude New', provider: 'anthropic', identityKind: 'concrete' }]);
  });
});
