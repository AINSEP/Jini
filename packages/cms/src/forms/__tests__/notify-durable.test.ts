import assert from 'node:assert/strict';
import { test } from 'vitest';
import { registerFormNotifySubscriber, FORM_NOTIFY_DELIVERY_EVENT, FormNotificationError } from '../notify-subscriber.js';
import { InMemoryEventBus } from './eventing.fixture.js';
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from './repo.fixture.js';
import type { DomainEvent } from '../../core/index.js';
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
for (const kind of ['retry', 'permanent', 'throw'] as const) test(`${kind} mail failures reach the durable job with safe details`, async () => {
  const f = await fixture(); await f.bus.publish(f.source); f.fail(kind);
  await assert.rejects(f.bus.publish(f.queued[0]!), error => {
    assert.ok(error instanceof FormNotificationError);
    assert.equal(error.retryable, kind !== 'permanent');
    assert.equal(error.message.includes('secret'), false);
    assert.match(error.message, /s/);
    return true;
  });
  f.fail(undefined); await f.bus.publish(f.queued[1]!);
  assert.equal(f.calls.at(-1), 'b@example.com');
});
