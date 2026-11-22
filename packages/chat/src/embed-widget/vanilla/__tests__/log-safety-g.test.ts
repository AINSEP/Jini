import { afterEach, expect, it, vi } from 'vitest';
import { createVanillaChatController } from '../state.js';
import type { ChatTransport } from '../../../core/transport.js';

// Split from core's log-safety-g test: core tests must not import the embed widget.
const sentinel = 'ochre owl private inlet';
const failure = () => Object.assign(new Error(sentinel), { stack: sentinel });
afterEach(() => vi.restoreAllMocks());

it.each([failure(), sentinel])('vanilla failure settles a failed reply with fixed public copy', async error => {
  const save = vi.fn();
  const transport = { startRun: async () => { throw error; } } as unknown as ChatTransport;
  const controller = createVanillaChatController({ transport, session: { load: () => ({ open: true, messages: [] }), save, clear: vi.fn() }, agentId: 'agent', ids: () => 'id', createAbortController: () => new AbortController(), onChange: vi.fn() });
  expect(await controller.send({ text: 'hello' })).toBe(true);
  expect(controller.getState().error).toBe('The message could not be sent to the agent; send it again.');
  expect(controller.getState().busy).toBe(false);
  expect(controller.getState().messages.at(-1)?.runStatus).toBe('failed');
  expect(save).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(controller.getState())).not.toContain(sentinel);
  expect(JSON.stringify(save.mock.calls)).not.toContain(sentinel);
});
