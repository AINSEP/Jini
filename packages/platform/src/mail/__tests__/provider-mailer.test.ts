import { expect, it, vi } from 'vitest';
import type { MailProviderModule, MailerPort, MailerSendRequired, MailerSendResult } from '@jini-ai/core/contracts/mail';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { createProviderMailer } from '../provider-mailer.js';

const credential = { token: 'saved-fixture-token', username: 'mail-fixture-user' };
const capabilities = { driver: 'fixture', supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 40, supportsAttachments: true };
const delivery: MailerSendRequired = {
  workspaceId: 'workspace-17', idempotencyKey: 'delivery-23', sourceContext: { module: 'forms', ref: 'submission-3' },
  message: { workspaceId: 'workspace-17', to: { email: 'to@example.test' }, from: { email: 'from@example.test' }, subject: 'Receipt' },
};
const success = { ok: true, providerMessageId: 'provider-19', acceptedAt: '2026-02-01T00:00:00.000Z' } satisfies MailerSendResult;
const refusal = { ok: false, errorCode: 'Rejected saved-fixture-token', message: 'Denied for mail-fixture-user', retryable: true, unknown: true, retryAfterMs: 450 } satisfies MailerSendResult;
const redacted = { ok: false, errorCode: 'Rejected [REDACTED:exact_secret]', message: 'Denied for [REDACTED:exact_secret]', retryable: true, unknown: true, retryAfterMs: 450 };

function fixture() {
  const httpClient: HttpClientPort = { send: async () => { throw new Error('Unexpected HTTP call'); } };
  const send = vi.fn<MailerPort['send']>();
  const sendBatch = vi.fn<MailerPort['sendBatch']>();
  const create = vi.fn<MailProviderModule['create']>(() => ({ capabilities: () => capabilities, send, sendBatch }));
  const provider: MailProviderModule = {
    id: 'fixture', label: 'Fixture Mail', credentialKeys: ['token', 'username'],
    capabilities: { hosted: true, feedback: false, domainVerification: false }, create,
  };
  return { httpClient, provider, create, send, sendBatch };
}

it('keeps provider delivery identity, options, success and retry details while redacting failures in both send APIs', async () => {
  const { httpClient, provider, create, send, sendBatch } = fixture();
  const mailer = createProviderMailer({ httpClient, provider, credential });
  const options = { timeoutMs: 800, lane: 'interactive', purpose: 'transactional' } as const;
  send.mockResolvedValueOnce(refusal).mockResolvedValueOnce(success);
  sendBatch.mockResolvedValueOnce([success, refusal]);
  expect(mailer.capabilities({})).toEqual(capabilities);
  expect(create.mock.calls).toEqual([[{ credential, kit: { httpClient } }]]);
  expect(await mailer.send(delivery, options)).toEqual(redacted);
  expect(await mailer.send(delivery)).toEqual(success);
  expect(send.mock.calls).toEqual([[delivery, options], [delivery, {}]]);
  const { message, ...identity } = delivery;
  const batch = { ...identity, messages: [message, { ...message, to: { email: 'other@example.test' } }] };
  expect(await mailer.sendBatch(batch, options)).toEqual([success, redacted]);
  expect(sendBatch.mock.calls).toEqual([[batch, options]]);
  expect(refusal.message).toBe('Denied for mail-fixture-user');
});

it('redacts Error and non-Error provider rejections without converting them into success results', async () => {
  const { httpClient, provider, send, sendBatch } = fixture();
  const mailer = createProviderMailer({ httpClient, provider, credential });
  send.mockRejectedValueOnce(new Error('Transport failed with saved-fixture-token'));
  sendBatch.mockRejectedValueOnce('Batch failed with mail-fixture-user');
  await expect(mailer.send(delivery)).rejects.toThrow(new Error('Transport failed with [REDACTED:exact_secret]'));
  const { message, ...identity } = delivery;
  await expect(mailer.sendBatch({ ...identity, messages: [message] })).rejects.toThrow(new Error('Batch failed with [REDACTED:exact_secret]'));
});
