import { expect, test, vi } from 'vitest';
import { ClientFacingError } from '../../contracts/server/client-facing-error.js';
import { runOperation } from '../reporter.js';
import { createRecordingReporter } from '../testing.js';

const ID = 'ERR-1111-2222-3333-4444';
const fallback = { message: 'The site export could not be completed.', action: 'Try the export again.' };

test('an incident is reported once, ends failed and returns safe words with the action and ID', async () => {
  const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
  const end = vi.fn();
  const result = await runOperation({ deps: { observability: {
    trackOperation: () => ({ run: <T>(fn: () => T) => fn(), end }),
  }, reporter },
    operation: 'site.export', scope: 'sites', step: 'Export site', fallback,
    work: async () => { throw new Error('secret canary-XYZ'); },
  });
  expect(reports, 'one thrown incident sends one report').toHaveLength(1);
  expect(end.mock.calls, 'the incident ends once with a failed outcome').toEqual([[{ outcome: 'failed', failed: true }]]);
  expect(result, 'incident words include the operation action and shared error ID').toEqual({ ok: false,
    failure: { kind: 'incident', status: 500, error: {
      code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${ID})`, requestId: ID,
    } },
  });
  expect(JSON.stringify(result), 'secret error text never enters the returned failure').not.toContain('canary-XYZ');
});

test('a refusal sends no report and ends refused without marking a failure', async () => {
  const { reporter, reports } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
  const end = vi.fn();
  const result = await runOperation({ deps: { observability: {
    trackOperation: () => ({ run: <T>(fn: () => T) => fn(), end }),
  }, reporter }, operation: 'site.export', scope: 'sites', step: 'Export site', fallback,
  work: async () => { throw new ClientFacingError({ apiError: { code: 'FORBIDDEN', message: 'Ask an owner for export access.' } }); },
  });
  expect(reports, 'refusals send no incident report').toHaveLength(0);
  expect(end.mock.calls, 'the refusal ends once without a failed flag').toEqual([[{ outcome: 'refused', failed: false }]]);
  expect(result, 'the boundary returns the classified refusal').toEqual({ ok: false,
    failure: { kind: 'refusal', status: 403, error: { code: 'FORBIDDEN', message: 'Ask an owner for export access.' } },
  });
});

test('successful work returns its value and ends completed without marking a failure', async () => {
  const { reporter } = createRecordingReporter({ ids: [ID], iso: '2026-11-21T12:00:00.000Z' });
  const end = vi.fn();
  const result = await runOperation({ deps: { observability: {
    trackOperation: () => ({ run: <T>(fn: () => T) => fn(), end }),
  }, reporter }, operation: 'site.export', scope: 'sites', step: 'Export site', fallback, work: async () => 'exported' });
  expect(end.mock.calls, 'success ends once with a completed outcome').toEqual([[{ outcome: 'completed', failed: false }]]);
  expect(result, 'the boundary returns the successful work value').toEqual({ ok: true, value: 'exported' });
});
