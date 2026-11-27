import { expect, it, vi } from 'vitest';
import type { Tracker } from '@jini-ai/core/contracts/site/diagnostics-observability';
import { captureMediaUploaded } from '../analytics.js';

function trackerFor(capture: Tracker['capture']): Tracker {
  return {
    capture,
    error: () => { throw new Error('unexpected error reporting'); },
    trace: async () => { throw new Error('unexpected span'); },
    metric: () => { throw new Error('unexpected metric'); },
  };
}

it('reports only the fixed size buckets and no raw upload size at threshold boundaries', () => {
  const capture = vi.fn<Tracker['capture']>();
  const tracker = trackerFor(capture);
  for (const byteLength of [99_999, 100_000, 999_999, 1_000_000, 9_999_999, 10_000_000]) {
    captureMediaUploaded({ tracker, actorId: 'editor-7', byteLength, kind: 'video', source: 'assistant' });
  }
  expect(capture.mock.calls).toEqual(['<100KB', '<1MB', '<1MB', '<10MB', '<10MB', '10MB+'].map(bytesBucket => [
    { name: 'media_uploaded', userId: 'editor-7' }, { properties: { bytesBucket, kind: 'video', source: 'assistant' } },
  ]));
});

it('suppresses a synchronous capture fault without retrying the event', () => {
  const capture = vi.fn<Tracker['capture']>(() => { throw new Error('telemetry unavailable'); });
  const event = { actorId: 'editor-7', byteLength: 4, kind: 'image' as const, source: 'admin' as const };
  captureMediaUploaded(event);
  expect(captureMediaUploaded({ ...event, tracker: trackerFor(capture) })).toBeUndefined();
  expect(capture.mock.calls).toEqual([[{ name: 'media_uploaded', userId: 'editor-7' },
    { properties: { kind: 'image', source: 'admin', bytesBucket: '<100KB' } }]]);
});
