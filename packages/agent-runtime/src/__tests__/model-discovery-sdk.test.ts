import { describe, expect, it } from 'vitest';
import { probeDroidSdk } from '../model-discovery-sdk.js';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/chosen/cli', cwd: '/project', env: { HOME: '/fake' } };
describe('official metadata SDK category', () => {
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
  it.each([
    ['not JSON', 'nope'],
    ['no models array', '{"models":{}}'],
  ])('refuses Droid SDK output that is %s', async (_label, stdout) => {
    const process: ModelDiscoveryDeps['process'] = { async run() { return { stdout, stderr: '' }; } };
    await expect(probeDroidSdk(context, { process } as ModelDiscoveryDeps, new AbortController().signal)).rejects.toThrow('malformed-response');
  });
  it('drops Droid rows without a string id and labels unnamed rows by id', async () => {
    const process: ModelDiscoveryDeps['process'] = { async run() { return { stdout: '{"models":[{"id":7},{"id":"droid-x"}]}', stderr: '' }; } };
    const result = await probeDroidSdk(context, { process } as ModelDiscoveryDeps, new AbortController().signal);
    expect(result.models).toEqual([{ id: 'droid-x', label: 'droid-x', provider: undefined, identityKind: 'concrete' }]);
  });
});
