import { afterEach, expect, test, vi } from 'vitest';
import { createResolvedMailer } from '../resolve-mailer.js';
import { FAILED, fixture, SEND } from './resolver-fixtures.js';

afterEach(() => vi.restoreAllMocks());

test('default production diagnostics warn once while the unconfigured router consistently refuses delivery', async () => {
  const host = fixture({ setting: null, saved: false });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const resolved = createResolvedMailer(host.deps);
  await resolved.ready;
  const result = await resolved.mailer.send(SEND);
  expect(result).toEqual({ ok: false, retryable: false, errorCode: 'MAIL_UNCONFIGURED',
    message: '[mail] no transactional mail provider is configured; choose a provider and save its key.' });
  expect(await resolved.mailer.send(SEND)).toEqual(result);
  expect(warn.mock.calls).toEqual([['[mail] no transactional mail provider is configured; choose a provider and save its key.']]);
  expect(host.sends).toEqual([]);
});

test('the default clock timestamps a safe send failure without retaining the provider error body', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T12:00:00Z'));
  const host = fixture();
  host.answers.single = FAILED;
  const resolved = createResolvedMailer(host.deps);
  await resolved.ready;
  expect(await resolved.mailer.send(SEND)).toBe(FAILED);
  expect((await resolved.status()).lastError).toEqual({ providerId: 'api', source: 'send',
    message: 'The provider did not confirm acceptance. Check provider configuration.', at: '2026-10-28T12:00:00.000Z' });
});
