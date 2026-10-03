import { expect, it } from 'vitest';
import { CredentialNotFoundError, CredentialedRequestValidationError, CredentialedRequestTransportError, ConsoleCredentialedRequestAuditLog, InMemoryCredentialedRequestAuditLog, makeCredentialedRequest } from '../credentialed-http/index.js';
import { WebhookSubscriptionNotFoundError, WebhookSubscriptionValidationError, WebhookDeliveryVetoedError, createSubscription, enqueueDelivery, processDueDeliveries, createFixedSecretSigner, verifySignature } from '../webhooks/index.js';
import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import { InMemoryWebhookSubscriptionRepo, InMemoryWebhookDeliveryRepo, InMemoryDeliveryEnvelopeStore } from '../webhooks/__tests__/memory-fixtures.js';

// REGRESSION: fails if makeCredentialedRequest passes body in send's second argument.
it('sends the complete canonical request without losing audit data', async () => {
  const requiredCalls: HttpRequest[] = [];
  const optionalCalls: { redirect?: import("@jini-ai/core/primitives").RequestRedirect }[] = [];
  const httpClient: HttpClientPort = {
    async send(required, optional = {}) {
      requiredCalls.push(required.request);
      optionalCalls.push(optional);
      return { status: 200, headers: {}, bodyText: 'ok' };
    },
  };
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = {
    httpClient, audit,
    clock: { nowMs: () => Date.parse('2026-10-01T00:00:00.000Z') },
    schemeRegistry: { load: async () => [] },
    resolver: {
      describe: async () => ({ baseUrl: 'https://api.example', additionalHosts: [] }),
      resolve: async () => ({ baseUrl: 'https://api.example', additionalHosts: [], connection: { token: 'long-synthetic-token' } }),
    },
  };
  const input = { workspaceId: 'workspace', label: 'endpoint', method: 'POST', url: 'https://api.example/resource' };
  await makeCredentialedRequest({ deps, input }, { body: 'payload' });
  await makeCredentialedRequest({ deps, input });
  expect(requiredCalls).toEqual([0, 1].map(i => ({ method: 'POST', url: input.url, headers: { Authorization: 'Bearer long-synthetic-token' }, timeoutMs: 10_000, ...(i === 0 ? { body: 'payload' } : {}) })));
  expect(optionalCalls).toEqual([{}, {}]);
  expect(audit.entries.map(({ bodyBytes }) => bodyBytes)).toEqual([7, 0]);
});

it('accepts required message objects and optional causes on extracted error constructors', () => {
  const cause = new Error('upstream');
  for (const ErrorType of [CredentialNotFoundError, CredentialedRequestValidationError, CredentialedRequestTransportError, WebhookSubscriptionNotFoundError, WebhookSubscriptionValidationError, WebhookDeliveryVetoedError]) {
    const error = new ErrorType({ message: 'validation failed' }, { options: { cause } });
    expect(error.message).toBe('validation failed');
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(ErrorType);
  }
});

it('wraps audit entries and log lines without changing the recorded diagnostic', () => {
  const lines: string[] = [];
  const memory = new InMemoryCredentialedRequestAuditLog();
  const consoleLog = new ConsoleCredentialedRequestAuditLog({ prefix: '[example]', log: ({ line }) => lines.push(line) });
  const entry = { label: 'endpoint', host: 'api.example', method: 'POST', status: 0, bodyBytes: 7, at: '2026-10-01T00:00:00.000Z', egressRefusal: 'peer rejected' };
  memory.record({ entry });
  consoleLog.record({ entry });
  expect(memory.entries).toEqual([entry]);
  expect(lines).toEqual(['[example] request label=endpoint host=api.example method=POST status=0 bodyBytes=7 at=2026-10-01T00:00:00.000Z egressRefusal="peer rejected"']);
});

// REGRESSION: fails if processDueDeliveries puts signed body in send's optional argument.
it('sends the exact signed webhook body and retains the optional dead-letter timestamp', async () => {
  const now = '2026-10-01T00:00:00.000Z';
  const clock = { nowMs: () => Date.parse(now) };
  let sequence = 0;
  const idGenerator = { newId: () => `id-${++sequence}` };
  const subscriptionRepo = new InMemoryWebhookSubscriptionRepo();
  const deliveryRepo = new InMemoryWebhookDeliveryRepo();
  const envelopeStore = new InMemoryDeliveryEnvelopeStore();
  const { subscription } = await createSubscription({
    deps: { repo: subscriptionRepo, clock, idGenerator, isAllowedTarget: async () => true },
    input: { workspaceId: 'workspace', ownerPrincipalId: 'owner', createdByPrincipalId: 'owner', label: 'endpoint', targetUrl: 'https://hooks.example/receive', topics: ['example.created'] },
  });
  const event = { id: 'event-1', workspaceId: 'workspace', name: 'example.created', occurredAt: now, payload: { count: 2 } };
  const enqueueArgs = { deps: { subscriptionRepo, deliveryRepo, envelopeStore, clock, idGenerator }, input: { event } };
  const { enqueued } = await enqueueDelivery(enqueueArgs);
  const requests: HttpRequest[] = [];
  const requiredBodies: unknown[] = [];
  const httpClient: HttpClientPort = {
    async send(required, optional = {}) {
      requiredBodies.push(Object.hasOwn(required.request, 'body'));
      requests.push(required.request);
      return { status: 500, headers: {}, bodyText: 'retry' };
    },
  };
  const secret = Buffer.from('synthetic webhook secret');
  const vocabulary = { timestampField: 'time', signatureField: 'sha256' };
  const signer = createFixedSecretSigner({ secrets: new Map([[subscription.id, secret]]), vocabulary });
  const result = await processDueDeliveries({ deps: {
    subscriptionRepo, deliveryRepo, envelopeStore, httpClient, signer, clock,
    headers: { signature: 'receiver-signature', eventId: 'receiver-event-id', deliveryId: 'receiver-delivery-id' },
  } }, { maxAttempts: 1 });
  expect(result).toEqual({ processed: 1, delivered: 0, failed: 0, dead: 1 });
  expect(requiredBodies).toEqual([true]);
  const request = requests[0]!;
  expect(JSON.parse(request.body!)).toEqual({ deliveryId: enqueued[0]!.id, eventId: event.id, topic: event.name, workspaceId: event.workspaceId, occurredAt: now, data: event.payload });
  expect(verifySignature({ vocabulary, secret, rawBody: request.body!, header: request.headers['receiver-signature']!, nowSeconds: Date.parse(now) / 1000, toleranceSeconds: 0 })).toBe(true);
  const stored = await deliveryRepo.findById({ workspaceId: 'workspace', id: enqueued[0]!.id });
  expect(stored?.deadAt).toBe(now);
  expect(stored?.status).toBe('dead');
  expect((await enqueueDelivery(enqueueArgs)).enqueued).toEqual([]);
});
