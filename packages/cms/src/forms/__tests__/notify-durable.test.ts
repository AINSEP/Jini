import assert from 'node:assert/strict';
import { test } from 'vitest';
import { registerFormNotifySubscriber, FORM_NOTIFY_DELIVERY_EVENT, FormNotificationError } from '../notify-subscriber.js';
import { InMemoryEventBus } from './eventing.fixture.js';
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from './repo.fixture.js';
import type { DomainEvent } from '@jini-ai/core/contracts/events';
import type { MailerPort } from '../ports.js';

async function fixture(mailer?: MailerPort) {
  const bus = new InMemoryEventBus(), definitions = new InMemoryFormDefinitionRepo(), submissions = new InMemoryFormSubmissionRepo();
  const queued: DomainEvent[] = [], calls: string[] = [];
  let failure: 'retry' | 'permanent' | 'throw' | undefined;
  await definitions.create({ id: 'f', workspaceId: 'w', slug: 'contact', name: 'Contact', fields: [], notify: { enabled: true, recipients: ['a@example.com', 'b@example.com'] }, version: 1, status: 'active', createdAt: 'now', updatedAt: 'now' });
  await submissions.create({ id: 's', workspaceId: 'w', formDefinitionId: 'f', data: { message: 'private' }, sourceIp: null, submittedAt: 'now' });
  const stop = await registerFormNotifySubscriber({ bus, sender: { email: 'sender@example.com' }, logger: { warn() {} }, formDefinitionRepo: definitions, formSubmissionRepo: submissions,
    outbox: { enqueue: async event => { if (!queued.some(row => row.id === event.id)) queued.push(event); } },
    mailer: mailer ?? { send: async ({ message }) => {
      calls.push(message.to.email);
      if (failure === 'throw') throw new Error('provider unavailable token=secret');
      if (failure) return { ok: false, retryable: failure === 'retry', errorCode: 'PROVIDER_REFUSED', message: 'token=secret' };
      return { ok: true, providerMessageId: 'sent', acceptedAt: 'now' };
    } },
  });
  const source = { id: 'e', name: 'form.submission.received', occurredAt: '2026-11-04T00:00:00Z', workspaceId: 'w', payload: { workspaceId: 'w', formDefinitionId: 'f', submissionId: 's' } };
  return { bus, queued, calls, stop, source, fail: (value: typeof failure) => { failure = value; } };
}

test('source retries enqueue stable recipient jobs without answers and leave sibling subscribers running', async () => {
  const f = await fixture(); let sibling = 0;
  await f.bus.subscribe({ eventName: f.source.name, handler: async () => { sibling++; } });
  await f.bus.publish(f.source); await f.bus.publish(f.source);
  assert.equal(sibling, 2); assert.equal(f.queued.length, 2); assert.deepEqual(f.calls, []);
  assert.ok(f.queued.every(event => event.name === FORM_NOTIFY_DELIVERY_EVENT));
  assert.equal(JSON.stringify(f.queued).includes('private'), false);
  await f.bus.publish(f.queued[1]!);
  assert.deepEqual(f.calls, ['b@example.com']);
  await f.stop(); await f.bus.publish(f.queued[0]!);
  assert.equal(f.calls.length, 1);
});

for (const [hint, expected] of [[90_000, 90_000], [7_200_000, 3_600_000], [-1, undefined], [NaN, undefined], [Infinity, undefined]] as const) {
  test(`notification retries preserve the bounded provider delay ${hint}`, async () => {
    const f = await fixture({ send: async () => ({ ok: false, retryable: true, errorCode: 'MAIL_RATE_LIMITED', message: 'token=secret', retryAfterMs: hint }) });
    await f.bus.publish(f.source);
    await assert.rejects(f.bus.publish(f.queued[0]!), error => {
      assert.ok(error instanceof FormNotificationError);
      assert.equal(error.retryAfterMs, expected);
      assert.equal(error.retryable, true);
      assert.equal(error.outcome, 'not-applied');
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  });
}

test('an uncertain notification is terminal even when the provider also says retryable', async () => {
  const f = await fixture({ send: async () => ({ ok: false, retryable: true, unknown: true, errorCode: 'MAIL_OUTCOME_UNKNOWN', message: 'private answer' }) });
  await f.bus.publish(f.source);
  await assert.rejects(f.bus.publish(f.queued[0]!), error => {
    assert.ok(error instanceof FormNotificationError);
    assert.equal(error.retryable, false);
    assert.equal(error.outcome, 'unknown');
    assert.equal(error.code, 'outcome-unknown');
    assert.equal(error.message.includes('private answer'), false);
    return true;
  });
});

test('a typed notification failure thrown by the host retains its outcome and retry hint', async () => {
  const refusal = new FormNotificationError({ submissionId: 's', retryable: false, retryAfterMs: 90_000, outcome: 'unknown' });
  const f = await fixture({ send: async () => { throw refusal; } });
  await f.bus.publish(f.source);
  await assert.rejects(f.bus.publish(f.queued[0]!), error => {
    assert.strictEqual(error, refusal);
    assert.equal(error.retryable, false);
    assert.equal(error.retryAfterMs, 90_000);
    assert.equal(error.outcome, 'unknown');
    return true;
  });
});
for (const kind of ['retry', 'permanent', 'throw'] as const) test(`${kind} mail failures reach the durable job with safe details`, async () => {
  const f = await fixture(); await f.bus.publish(f.source); f.fail(kind);
  await assert.rejects(f.bus.publish(f.queued[0]!), error => {
    assert.ok(error instanceof FormNotificationError);
    assert.equal(error.retryable, kind !== 'permanent');
    if (kind === 'throw') assert.equal(error.outcome, undefined, 'an unclassified host exception must not claim definitive non-delivery');
    assert.equal(error.message.includes('secret'), false);
    assert.match(error.message, /s/);
    return true;
  });
  f.fail(undefined); await f.bus.publish(f.queued[1]!);
  assert.equal(f.calls.at(-1), 'b@example.com');
});

test('a delivery job whose submission or form was purged sends nothing and settles', async () => {
  const f = await fixture();
  await f.bus.publish(f.source);
  const job = f.queued[0]!;
  const purged = (payload: Record<string, string>) => ({ ...job, payload: { ...(job.payload as Record<string, string>), ...payload } });
  await f.bus.publish(purged({ submissionId: 'gone' }));
  await f.bus.publish(purged({ formDefinitionId: 'gone' }));
  assert.deepEqual(f.calls, []);
  await f.bus.publish(job);
  assert.deepEqual(f.calls, ['a@example.com']);
});

test('a durable host fails source planning when the outbox refuses, so the source event is retried', async () => {
  const bus = new InMemoryEventBus(), definitions = new InMemoryFormDefinitionRepo(), submissions = new InMemoryFormSubmissionRepo();
  await definitions.create({ id: 'f', workspaceId: 'w', slug: 'contact', name: 'Contact', fields: [], notify: { enabled: true, recipients: ['a@example.com'] }, version: 1, status: 'active', createdAt: 'now', updatedAt: 'now' });
  const refusal = new Error('outbox unavailable');
  const warnings: unknown[] = [];
  await registerFormNotifySubscriber({ bus, sender: { email: 'sender@example.com' }, logger: { warn: (...args: unknown[]) => { warnings.push(args); } },
    formDefinitionRepo: definitions, formSubmissionRepo: submissions,
    outbox: { enqueue: async () => { throw refusal; } },
    mailer: { send: async () => { throw new Error('unexpected send'); } } });
  await assert.rejects(bus.publish({ id: 'e', name: 'form.submission.received', occurredAt: '2026-11-04T00:00:00Z', workspaceId: 'w', payload: { workspaceId: 'w', formDefinitionId: 'f', submissionId: 's' } }),
    error => error === refusal);
  assert.deepEqual(warnings, []);
});

test('a legacy mailer that throws a bare undefined is logged without an error field', async () => {
  const bus = new InMemoryEventBus(), definitions = new InMemoryFormDefinitionRepo(), submissions = new InMemoryFormSubmissionRepo();
  await definitions.create({ id: 'f', workspaceId: 'w', slug: 'contact', name: 'Contact', fields: [], notify: { enabled: true, recipients: ['a@example.com'] }, version: 1, status: 'active', createdAt: 'now', updatedAt: 'now' });
  await submissions.create({ id: 's', workspaceId: 'w', formDefinitionId: 'f', data: { message: 'hi' }, sourceIp: null, submittedAt: 'now' });
  const warnings: unknown[] = [];
  await registerFormNotifySubscriber({ bus, sender: { email: 'sender@example.com' }, logger: { warn: (...args: unknown[]) => { warnings.push(args); } },
    formDefinitionRepo: definitions, formSubmissionRepo: submissions,
    mailer: { send: async () => { const nonError: unknown = undefined; throw nonError; } } });
  await bus.publish({ id: 'e', name: 'form.submission.received', occurredAt: '2026-11-04T00:00:00Z', workspaceId: 'w', payload: { workspaceId: 'w', formDefinitionId: 'f', submissionId: 's' } });
  assert.deepEqual(warnings, [[{ message: "[forms:notify] mail send threw for submission 's' (recipient address withheld from logs)" }, {}]]);
});

test('a legacy host logger that throws while reporting a refusal cannot stop the other recipients or sibling subscribers', async () => {
  const bus = new InMemoryEventBus(), definitions = new InMemoryFormDefinitionRepo(), submissions = new InMemoryFormSubmissionRepo();
  await definitions.create({ id: 'f', workspaceId: 'w', slug: 'contact', name: 'Contact', fields: [], notify: { enabled: true, recipients: ['a@example.com', 'b@example.com'] }, version: 1, status: 'active', createdAt: 'now', updatedAt: 'now' });
  await submissions.create({ id: 's', workspaceId: 'w', formDefinitionId: 'f', data: { message: 'hi' }, sourceIp: null, submittedAt: 'now' });
  const attempts: string[] = [];
  let logged = 0;
  await registerFormNotifySubscriber({ bus, sender: { email: 'sender@example.com' }, logger: { warn: () => { logged++; throw new Error('log sink down'); } },
    formDefinitionRepo: definitions, formSubmissionRepo: submissions,
    mailer: { send: async ({ message }) => { attempts.push(message.to.email); return { ok: false, retryable: false, errorCode: 'REFUSED', message: 'no' }; } } });
  let sibling = 0;
  await bus.subscribe({ eventName: 'form.submission.received', handler: async () => { sibling++; } });
  await bus.publish({ id: 'e', name: 'form.submission.received', occurredAt: '2026-11-04T00:00:00Z', workspaceId: 'w', payload: { workspaceId: 'w', formDefinitionId: 'f', submissionId: 's' } });
  assert.deepEqual([attempts, logged, sibling], [['a@example.com', 'b@example.com'], 2, 1]);
});
