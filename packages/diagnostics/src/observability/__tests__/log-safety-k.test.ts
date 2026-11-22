import { expect, it, vi } from 'vitest';
import { createTrackerWarning } from '../tracker.js';
import { openPlaywrightRenderBrowser } from '../../web-evidence/playwright-runtime.js';
import { collectPageEvidence } from '../../web-evidence/collect-page-evidence.js';

it('keeps the tracker warning once and uses the default safe warning sink', () => {
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const warn = createTrackerWarning({});
    warn(); warn();
    expect(consoleWarn).toHaveBeenCalledOnce(); expect(consoleWarn).toHaveBeenCalledWith('[tracker] a telemetry provider failed; application work continues');
  } finally { consoleWarn.mockRestore(); }
});

it.each(['import', 'launch'] as const)('keeps browser %s guidance and drops raw failure text', async stage => {
  const failure = new Error('PRIVATE_BROWSER_SENTINEL');
  failure.stack = 'PRIVATE_BROWSER_STACK_SENTINEL';
  const launch = vi.fn(async () => { throw failure; });
  const result = await openPlaywrightRenderBrowser({}, { moduleLoader: { load: async () => {
    if (stage === 'import') throw failure;
    return { chromium: { launch } };
  } } });
  expect(result.available).toBe(false);
  expect(result).toMatchObject({ reason: expect.stringContaining(stage === 'import' ? "npm install -D playwright" : 'npx playwright install --with-deps chromium') });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_BROWSER_(STACK_)?SENTINEL/);
  expect(launch).toHaveBeenCalledTimes(stage === 'import' ? 0 : 2);
});

it('sends a caught message only through the host observation policy and closes the browser', async () => {
  const failure = new TypeError('PRIVATE_OBSERVATION_SENTINEL');
  failure.stack = 'PRIVATE_OBSERVATION_STACK_SENTINEL';
  const close = vi.fn(async () => {});
  const redactMessage = vi.fn(({ message }: { message: string }) => `policy: ${message.replace('PRIVATE_OBSERVATION_SENTINEL', '[redacted]')}`);
  const result = await collectPageEvidence({ workspaceId: 'workspace', paths: ['/page'],
    originRegistry: { canonicalOrigin: async () => ({ scheme: 'https', host: 'example.test', verifiedAt: '', source: 'host' }) },
    openBrowser: async () => ({ available: true, browser: { observe: async () => { throw failure; }, close } }),
    observationPolicy: { redactObservation: ({ observation }) => observation, redactMessage },
  });
  expect(result.skipped).toEqual([{ path: '/page', reason: 'navigation-failed', message: 'policy: [redacted]' }]);
  expect(redactMessage).toHaveBeenCalledWith({ message: 'PRIVATE_OBSERVATION_SENTINEL' });
  expect(close).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_OBSERVATION_(STACK_)?SENTINEL/);
});
