import { describe, expect, it } from 'vitest';
import { createFakeChatTransport } from '../fake-transport.js';

/**
 * `fake-transport.ts` is itself a test-only utility, but per this package's
 * coverage bar it's still measured — a couple of its members
 * (`nextRunId`/`fetchRunStatus`) aren't exercised by any hook test because no
 * hook under test currently calls them, so they get a direct, minimal test
 * here.
 */
describe('createFakeChatTransport', () => {
  it('nextRunId() previews the id the next startRun() call will assign, without consuming it', async () => {
    const transport = createFakeChatTransport();
    expect(transport.nextRunId()).toBe('run-1');
    // Still "run-1" until an actual startRun() call bumps the counter.
    expect(transport.nextRunId()).toBe('run-1');
    await transport.startRun(
      { history: [], signal: new AbortController().signal },
      { onEvent: () => {}, onError: () => {}, onDone: () => {} },
    );
    expect(transport.nextRunId()).toBe('run-2');
  });

  it('nextRunId() honors a custom runIdPrefix', () => {
    const transport = createFakeChatTransport({ runIdPrefix: 'session' });
    expect(transport.nextRunId()).toBe('session-1');
  });

  it('fetchRunStatus() always resolves null (no persisted-run lookup in the fake)', async () => {
    const transport = createFakeChatTransport();
    await expect(transport.fetchRunStatus('any-run-id')).resolves.toBeNull();
  });
});
