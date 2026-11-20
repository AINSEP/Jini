/** collectPageEvidence skip classification for failures the browser-level suites do not reach. */
import { expect, it } from 'vitest';
import { collectPageEvidence, type CollectPageEvidenceOptions } from '../collect-page-evidence.js';
import type { SiteEvidenceBrowserPort } from '../browser-port.js';

function collect(observe: SiteEvidenceBrowserPort['observe'], input: CollectPageEvidenceOptions = {}) {
  const closed: string[] = [];
  const browser: SiteEvidenceBrowserPort = { observe, close: async () => { closed.push('closed'); } };
  const result = collectPageEvidence({
    workspaceId: 'workspace', paths: ['/page'],
    originRegistry: { canonicalOrigin: async () => ({ scheme: 'https', host: 'example.test', verifiedAt: '', source: 'host' }) },
    openBrowser: async () => ({ available: true, browser }),
    observationPolicy: { redactObservation: ({ observation }) => observation, redactMessage: ({ message }) => `[redacted] ${message}` },
  }, input);
  return { result, closed };
}

it('the performance opt-in reaches the browser port', async () => {
  const optional: unknown[] = [];
  const { result } = collect(async (_request, options) => { optional.push(options); return { ok: false, reason: 'stop here' }; }, { collectPerformance: true });
  await result;
  expect(optional).toEqual([{ collectPerformance: true }]);
});

it('a failed load without an off-origin URL is skipped with the port reason', async () => {
  const { result } = collect(async () => ({ ok: false, reason: 'net::ERR_CONNECTION_REFUSED' }));
  expect((await result).skipped).toEqual([{ path: '/page', reason: 'navigation-failed', message: '[redacted] net::ERR_CONNECTION_REFUSED' }]);
});

it('a failed load whose reported off-origin URL is really same-origin is an ordinary navigation failure', async () => {
  const { result, closed } = collect(async () => ({ ok: false, reason: 'net::ERR_ABORTED', offOriginUrl: 'https://example.test/elsewhere' }));
  expect((await result).skipped).toEqual([{ path: '/page', reason: 'navigation-failed', message: '[redacted] net::ERR_ABORTED' }]);
  expect(closed).toEqual(['closed']);
});

it('an unparseable off-origin URL is reported without echoing it', async () => {
  const { result } = collect(async () => ({ ok: false, reason: 'refused', offOriginUrl: 'not a url?token=secret' }));
  const { skipped } = await result;
  expect(skipped).toEqual([{ path: '/page', reason: 'off-origin-redirect',
    message: "[redacted] redirected off the inspected origin to '(unparseable URL)' — not inspected; this tool only observes https://example.test" }]);
});

it('a non-Error thrown by the port is skipped with its string form and the browser still closes', async () => {
  const { result, closed } = collect(async () => { throw 'adapter exploded'; });
  expect((await result).skipped).toEqual([{ path: '/page', reason: 'navigation-failed', message: '[redacted] adapter exploded' }]);
  expect(closed).toEqual(['closed']);
});
