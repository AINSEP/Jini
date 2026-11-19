import { expect, it, vi } from 'vitest';
import { createConsoleLogger } from '@jini-ai/core/primitives';
import { startWebhookDeliveryWorker, WEBHOOK_DELIVERY_FAILED_LINE, WEBHOOK_DELIVERY_STOP_LATE_LINE, type WebhookDeliveryScheduler } from '../worker.js';

it('reports the original failed pass through the typed bag, retries and retains the legacy callback', async () => {
  const failure = new Error('PRIVATE_WEBHOOK_SENTINEL');
  failure.stack = 'PRIVATE_WEBHOOK_STACK_SENTINEL';
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const legacy = vi.fn();
  let calls = 0;
  const worker = startWebhookDeliveryWorker({ processDue: async () => { if (++calls === 1) throw failure; } }, {
    report: createConsoleLogger({ prefix: '' }),
  });
  try {
    await worker.tick(); await worker.tick();
    expect(calls).toBe(2);
    expect(consoleError).toHaveBeenCalledOnce(); expect(consoleError).toHaveBeenCalledWith(WEBHOOK_DELIVERY_FAILED_LINE, 'Error');
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/PRIVATE_WEBHOOK_(STACK_)?SENTINEL/);
    const legacyWorker = startWebhookDeliveryWorker({ processDue: async () => { throw failure; } }, { log: legacy });
    await legacyWorker.tick(); await legacyWorker.stop();
    expect(legacy).toHaveBeenCalledOnce(); expect(legacy).toHaveBeenCalledWith(`${WEBHOOK_DELIVERY_FAILED_LINE}: Error`);
  } finally { await worker.stop(); consoleError.mockRestore(); }
});

it('reports a late stop once, cancels scheduling and suppresses future passes', async () => {
  let grace!: () => void;
  const cancel = vi.fn();
  const scheduler: WebhookDeliveryScheduler = { every: () => ({ cancel }), after: ({ run }) => { grace = run; return { cancel: vi.fn() }; } };
  const warn = vi.fn();
  const processDue = vi.fn(() => new Promise(() => {}));
  const worker = startWebhookDeliveryWorker({ processDue }, { scheduler, report: { warn, error: vi.fn() } });
  void worker.tick();
  const stopping = worker.stop();
  grace(); await stopping;
  await worker.tick();
  expect(warn).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledWith({ message: WEBHOOK_DELIVERY_STOP_LATE_LINE });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(processDue).toHaveBeenCalledTimes(1);
});
