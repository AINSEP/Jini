import { describe, expect, it, vi } from 'vitest';
import { resolveApproval } from '../approval.js';

/** L2 §8.5: the human-confirmation reducer under abort — before, during and racing the answer —
 *  always yields `abandoned`, never revives an aborted op, and never leaks its abort listener. */
function watched() {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  return { controller, signal: controller.signal, add, remove };
}

describe('resolveApproval', () => {
  it('an already-aborted signal is abandoned without asking or subscribing', async () => {
    const { controller, signal, add } = watched();
    controller.abort();
    const askHuman = vi.fn(async () => ({ confirmed: true as const }));
    await expect(resolveApproval({ signal, askHuman })).resolves.toEqual({ confirmed: false, reason: 'abandoned' });
    expect(askHuman).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('abort while waiting resolves abandoned and removes the same once-listener', async () => {
    const { controller, signal, add, remove } = watched();
    const pending = resolveApproval({ signal, askHuman: () => new Promise(() => undefined) });
    controller.abort();
    await expect(pending).resolves.toEqual({ confirmed: false, reason: 'abandoned' });
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });

  it('a yes that arrives after the abort is still abandoned (no revival)', async () => {
    const { controller, signal } = watched();
    const answer = await resolveApproval({ signal, askHuman: async () => { controller.abort(); return { confirmed: true, choice: 'go' }; } });
    expect(answer).toEqual({ confirmed: false, reason: 'abandoned' });
  });

  it.each([
    [{ confirmed: true, choice: 'a' }],
    [{ confirmed: false, reason: 'declined' }],
    [{ confirmed: false, reason: 'expired' }],
  ] as const)('passes a live answer %j through and unsubscribes', async (reply) => {
    const { signal, add, remove } = watched();
    await expect(resolveApproval({ signal, askHuman: async () => reply })).resolves.toEqual(reply);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });

  it('a transport failure propagates and still unsubscribes', async () => {
    const { signal, add, remove } = watched();
    const failure = new Error('socket closed');
    await expect(resolveApproval({ signal, askHuman: async () => { throw failure; } })).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });
});
