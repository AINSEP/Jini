import { expect, test, vi } from 'vitest';
const { postDaemonJson } = vi.hoisted(() => ({ postDaemonJson: vi.fn(async (_input: unknown, _options: unknown) => ({ result: { status: 'completed', output: {} } })) }));
vi.mock('../../daemon-client.js', () => ({ postDaemonJson }));
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from '../delegated-tool.js';

test('reading an approval card does not spend a six-minute delegated transport budget', async () => {
  for (const factory of [createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool]) {
    await factory({ runId: 'run' }).handler({ args: { toolId: 'save', input: {} }, ctx: { baseUrl: 'http://daemon', fetchImpl: fetch } });
    expect(postDaemonJson.mock.calls.at(-1)?.[1]).toMatchObject({ timeoutMs: null });
  }
});
