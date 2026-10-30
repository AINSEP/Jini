import { afterEach, expect, test, vi } from 'vitest';
import { createMailPolicyWrapper } from '../delivery-wrapper.js';
import type { MailerPort } from '../ports.js';
import type { MailProviderModule } from '../provider.js';

afterEach(() => vi.restoreAllMocks());

test('an absent observer preserves delivery, and the default diagnostic warns once when observation fails', async () => {
  const result = { ok: true as const, providerMessageId: 'sent', acceptedAt: '2026-10-28T00:00:00Z' };
  const send = vi.fn(async () => result);
  const mailer: MailerPort = { capabilities: () => ({ driver: 'fixture', supportsIdempotencyKey: false,
    supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }), send,
    sendBatch: async () => { throw new Error('policy must deliver recipients separately'); } };
  const provider: MailProviderModule = { id: 'fixture', label: 'Fixture', credentialKeys: [],
    capabilities: { hosted: true, feedback: false, domainVerification: false }, create: () => mailer };
  const deps = { ledger: { reserve: async () => ({ status: 'reserved' as const }), mark: async () => {} },
    suppression: { isSuppressed: async () => false, suppress: async () => {} },
    readTestMode: async () => ({ mode: 'off' as const }), resendPolicy: () => 'on_unknown' as const };
  const message = { workspaceId: 'site', from: { email: 'sender@example.org' }, to: { email: 'reader@example.org' }, subject: 'Hello', text: 'Hello' };
  const input = { message, workspaceId: 'site', idempotencyKey: 'send', sourceContext: { module: 'fixture' } };
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await createMailPolicyWrapper(deps)({ providerId: 'fixture', provider, mailer }).send(input)).toBe(result);
  expect(warn).not.toHaveBeenCalled();
  const observed = createMailPolicyWrapper({ ...deps, observe: async () => { throw new Error('activity unavailable'); } })({ providerId: 'fixture', provider, mailer });
  expect(await observed.send(input)).toBe(result);
  expect(await observed.send({ ...input, idempotencyKey: 'second' })).toBe(result);
  expect(send).toHaveBeenCalledTimes(3);
  expect(warn.mock.calls).toEqual([['[mail] activity observation failed']]);
});
