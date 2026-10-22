import { describe, expect, it } from 'vitest';
import { createCopilotMetadataClient, probeCopilotSdk, probeDroidSdk } from '../model-discovery-sdk.js';
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
  it('stops without starting when the probe was already cancelled, tolerating a failing stop', async () => {
    const controller = new AbortController(); controller.abort();
    const calls: string[] = [];
    await expect(probeCopilotSdk(context, controller.signal, { createClient: async () => ({
      start: async () => { calls.push('start'); }, listModels: async () => [], forceStop: async () => { calls.push('stop'); throw new Error('already gone'); },
    }) })).rejects.toThrow('timeout');
    expect(calls).toEqual(['stop']);
  });
  it('a cancellation during listing stops the client through the abort listener, even if stopping fails', async () => {
    const controller = new AbortController(); let stops = 0;
    await expect(probeCopilotSdk(context, controller.signal, { createClient: async () => ({
      start: async () => undefined,
      listModels: async () => { controller.abort(); throw new Error('listing interrupted'); },
      forceStop: async () => { stops++; throw new Error('stop failed'); },
    }) })).rejects.toThrow('listing interrupted');
    expect(stops).toBe(2);
  });
  it('labels a Copilot model by its id when the SDK row has no name', async () => {
    const result = await probeCopilotSdk(context, new AbortController().signal, { createClient: async () => ({
      start: async () => undefined, listModels: async () => [{ id: 'gpt-unnamed' }], forceStop: async () => undefined,
    }) });
    expect(result.models).toEqual([{ id: 'gpt-unnamed', label: 'gpt-unnamed', identityKind: 'concrete' }]);
  });
  it('builds the client over the current SDK RuntimeConnection with string env only', async () => {
    const built: unknown[] = [];
    const connection = { kind: 'stdio' };
    const forStdio = (input: unknown) => { built.push(input); return connection; };
    const client = await createCopilotMetadataClient({ ...context, env: { HOME: '/fake', UNSET: undefined } }, { importSdk: async (name) => {
      expect(name).toBe('@github/copilot-sdk');
      return { RuntimeConnection: { forStdio }, CopilotClient: class { constructor(options: Record<string, unknown>) { built.push(options); } start = async () => undefined; listModels = async () => []; forceStop = async () => undefined; } };
    } });
    expect(typeof client.listModels).toBe('function');
    expect(built).toEqual([{ path: '/chosen/cli', env: { HOME: '/fake' } }, { connection, workingDirectory: '/project', autoRestart: false }]);
  });
  it('falls back to the older SDK cliPath/cwd/useStdio options without RuntimeConnection', async () => {
    const built: unknown[] = [];
    await createCopilotMetadataClient(context, { importSdk: async () => ({
      CopilotClient: class { constructor(options: Record<string, unknown>) { built.push(options); } start = async () => undefined; listModels = async () => []; forceStop = async () => undefined; },
    }) });
    expect(built).toEqual([{ cliPath: '/chosen/cli', cwd: '/project', env: { HOME: '/fake' }, useStdio: true, autoRestart: false }]);
  });
  it('the default importer loads the installed SDK and builds an unstarted client', async () => {
    const client = await createCopilotMetadataClient(context);
    expect(typeof client.start).toBe('function');
    expect(typeof client.listModels).toBe('function');
    await client.forceStop().catch(() => undefined);
  });
  it('by default builds the installed SDK client, and a pre-cancelled probe stops it without starting', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(probeCopilotSdk(context, controller.signal)).rejects.toThrow('timeout');
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
