import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createProviderRegistry, PROVIDER_ID_PATTERN, ProviderRegistryError,
  providerOk, providerRejected, providerUnknown,
} from '../provider-registry.js';

interface Mailer { readonly send: () => string }
const mailer = (tag: string): Mailer => ({ send: () => tag });
const validate = ({ provider }: { provider: Mailer }) => (typeof provider.send === 'function' ? undefined : 'send() is missing');

function thrown(fn: () => unknown): ProviderRegistryError {
  try { fn(); } catch (error) { assert.ok(error instanceof ProviderRegistryError); return error; }
  assert.fail('expected a ProviderRegistryError');
}

test('id grammar matches the plugin-tool name grammar', () => {
  assert.equal(PROVIDER_ID_PATTERN.source, '^[a-z][a-z0-9_]{0,63}$');
  assert.ok(PROVIDER_ID_PATTERN.test('smtp_relay2'));
  for (const bad of ['Smtp', '1smtp', 'smtp-relay', '', `a${'b'.repeat(64)}`]) assert.equal(PROVIDER_ID_PATTERN.test(bad), false, bad);
});

test('core registration: register/get/has/list in order, frozen entries keep provider identity', () => {
  const resend = mailer('resend');
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { seed: [{ id: 'smtp', provider: mailer('smtp'), label: 'SMTP' }] });
  registry.register({ definition: { id: 'resend', provider: resend } });
  assert.equal(registry.contract, 'mail');
  assert.equal(registry.has({ id: 'resend' }), true);
  assert.equal(registry.has({ id: 'console' }), false);
  assert.equal(registry.get({ id: 'console' }), undefined);
  const entry = registry.get({ id: 'resend' });
  assert.equal(entry?.provider, resend);
  assert.deepEqual(entry, { id: 'resend', provider: resend, origin: 'core' });
  assert.ok(Object.isFrozen(entry));
  assert.equal(registry.get({ id: 'smtp' })?.label, 'SMTP');
  const list = registry.list();
  assert.deepEqual(list.map(e => e.id), ['smtp', 'resend']);
  assert.ok(Object.isFrozen(list));
  assert.notEqual(registry.list(), list, 'list returns a fresh snapshot');
  assert.deepEqual(registry.refusals(), []);
});

test('core registration throws on bad id, invalid provider, and duplicate', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { validate });
  assert.equal(thrown(() => registry.register({ definition: { id: 'Bad-Id', provider: mailer('x') } })).code, 'invalid_id');
  assert.equal(thrown(() => registry.register({ definition: { id: 42 as unknown as string, provider: mailer('x') } })).message, "mail provider id '42' must match ^[a-z][a-z0-9_]{0,63}$");
  const invalid = thrown(() => registry.register({ definition: { id: 'smtp', provider: {} as Mailer } }));
  assert.deepEqual([invalid.code, invalid.message, invalid.name], ['invalid_provider', "mail provider 'smtp' is invalid: send() is missing", 'ProviderRegistryError']);
  registry.register({ definition: { id: 'smtp', provider: mailer('smtp') } });
  const dup = thrown(() => registry.register({ definition: { id: 'smtp', provider: mailer('again') } }));
  assert.deepEqual([dup.code, dup.message], ['duplicate', "mail provider 'smtp' is already registered"]);
  assert.equal(registry.get({ id: 'smtp' })?.provider.send(), 'smtp');
});

test('seed definitions follow the throwing policy', () => {
  assert.equal(thrown(() => createProviderRegistry<Mailer>({ contract: 'mail' }, { seed: [{ id: 'a', provider: mailer('a') }, { id: 'a', provider: mailer('b') }] })).code, 'duplicate');
});

test('plugin contribution: accepted entries record origin and pluginId', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { validate });
  assert.equal(registry.contribute({ definition: { id: 'postmark', provider: mailer('pm'), label: 'Postmark' }, pluginId: 'postmark', contract: 'mail' }), true);
  assert.equal(registry.contribute({ definition: { id: 'ses', provider: mailer('ses') }, pluginId: 'aws' }), true);
  assert.deepEqual(registry.get({ id: 'postmark' }), { id: 'postmark', provider: registry.get({ id: 'postmark' })?.provider, origin: 'plugin', label: 'Postmark', pluginId: 'postmark' });
  assert.deepEqual(registry.list().map(e => [e.id, e.origin, e.pluginId]), [['postmark', 'plugin', 'postmark'], ['ses', 'plugin', 'aws']]);
});

test('broken or duplicate plugin contributions are refused, never thrown', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { validate, seed: [{ id: 'smtp', provider: mailer('smtp') }] });
  assert.equal(registry.contribute({ definition: { id: 'x', provider: mailer('x') }, pluginId: 'p0', contract: 'dns' }), false);
  assert.equal(registry.contribute({ definition: { id: 'BAD', provider: mailer('x') }, pluginId: 'p1' }), false);
  assert.equal(registry.contribute({ definition: { id: 'broken', provider: {} as Mailer }, pluginId: 'p2' }), false);
  assert.equal(registry.contribute({ definition: { id: 'smtp', provider: mailer('evil') }, pluginId: 'p3' }), false);
  assert.equal(registry.contribute({ definition: { id: 'resend', provider: mailer('r1') }, pluginId: 'p4' }), true);
  assert.equal(registry.contribute({ definition: { id: 'resend', provider: mailer('r2') }, pluginId: 'p5' }), false);
  const refusals = registry.refusals();
  assert.ok(Object.isFrozen(refusals) && Object.isFrozen(refusals[0]));
  assert.deepEqual(refusals, [
    { code: 'contract_mismatch', pluginId: 'p0', providerId: 'x', message: "plugin 'p0' contributed provider 'x' for contract 'dns', not 'mail'" },
    { code: 'invalid_id', pluginId: 'p1', providerId: 'BAD', message: "mail provider id 'BAD' must match ^[a-z][a-z0-9_]{0,63}$" },
    { code: 'invalid_provider', pluginId: 'p2', providerId: 'broken', message: "mail provider 'broken' is invalid: send() is missing" },
    { code: 'duplicate', pluginId: 'p3', providerId: 'smtp', message: "mail provider 'smtp' from plugin 'p3' was not loaded: already registered by the built-in provider" },
    { code: 'duplicate', pluginId: 'p5', providerId: 'resend', message: "mail provider 'resend' from plugin 'p5' was not loaded: already registered by plugin 'p4'" },
  ]);
  assert.equal(registry.get({ id: 'smtp' })?.provider.send(), 'smtp');
  assert.equal(registry.get({ id: 'resend' })?.provider.send(), 'r1');
});

test('a throwing validator or provider getter is refused, and a later valid contribution still loads', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { validate: ({ provider }) => { if (provider.send() === 'bug') throw new Error('validator bug'); return undefined; } });
  assert.equal(registry.contribute({ definition: { id: 'buggy', provider: mailer('bug') }, pluginId: 'p1' }), false);
  const hostileProvider = Object.defineProperty({ id: 'hostile' }, 'provider', { get: () => { throw new Error('getter'); } }) as unknown as { id: string; provider: Mailer };
  assert.equal(registry.contribute({ definition: hostileProvider, pluginId: 'p2' }), false);
  const hostileId = Object.defineProperty({ provider: mailer('x') }, 'id', { get: () => { throw new Error('id getter'); } }) as unknown as { id: string; provider: Mailer };
  assert.equal(registry.contribute({ definition: hostileId, pluginId: 'p3' }), false);
  assert.equal(registry.contribute({ definition: { id: 'good', provider: mailer('good') }, pluginId: 'p4' }), true);
  assert.deepEqual(registry.list().map(entry => entry.id), ['good']);
  assert.deepEqual(registry.refusals().map(r => [r.code, r.pluginId, r.providerId, r.message]), [
    ['invalid_provider', 'p1', 'buggy', "mail provider from plugin 'p1' was not loaded: its definition could not be validated"],
    ['invalid_provider', 'p2', 'hostile', "mail provider from plugin 'p2' was not loaded: its definition could not be validated"],
    ['invalid_provider', 'p3', '', "mail provider from plugin 'p3' was not loaded: its definition could not be validated"],
  ]);
  assert.throws(() => registry.register({ definition: { id: 'core_bug', provider: mailer('bug') } }), /validator bug/);
});

test('public boundaries accept the reserved optional object', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, {});
  registry.register({ definition: { id: 'smtp', provider: mailer('smtp') } }, {});
  assert.equal(registry.contribute({ definition: { id: 'acme', provider: mailer('acme') }, pluginId: 'p' }, {}), true);
  assert.equal(registry.get({ id: 'smtp' }, {})?.id, 'smtp');
  assert.equal(registry.has({ id: 'acme' }, {}), true);
  assert.equal(registry.list({}, {}).length, 2);
  assert.equal(registry.getDefault({}, {}), undefined);
  assert.equal(registry.refusals({}, {}).length, 0);
  assert.deepEqual(providerOk({ value: 1 }, {}), { status: 'ok', value: 1 });
  assert.equal(providerRejected({ code: 'conflict', message: 'm' }, {}).status, 'rejected');
  assert.equal(providerUnknown({ code: 'network', message: 'm' }, {}).status, 'unknown');
});

test('core displaces an earlier plugin entry for the same id and records why', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' });
  registry.contribute({ definition: { id: 'resend', provider: mailer('plugin') }, pluginId: 'resend_plugin' });
  registry.contribute({ definition: { id: 'ses', provider: mailer('ses') }, pluginId: 'aws' });
  registry.register({ definition: { id: 'resend', provider: mailer('core') } });
  assert.deepEqual(registry.get({ id: 'resend' }), { id: 'resend', provider: registry.get({ id: 'resend' })?.provider, origin: 'core' });
  assert.equal(registry.get({ id: 'resend' })?.provider.send(), 'core');
  assert.deepEqual(registry.list().map(e => e.id), ['ses', 'resend']);
  assert.deepEqual(registry.refusals(), [{ code: 'displaced_by_core', pluginId: 'resend_plugin', providerId: 'resend', message: "mail provider 'resend' from plugin 'resend_plugin' was replaced by the built-in provider" }]);
});

test('default provider: none, named-but-unregistered, registered, and invalid id', () => {
  assert.equal(createProviderRegistry<Mailer>({ contract: 'mail' }).getDefault(), undefined);
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { defaultProviderId: 'smtp' });
  assert.equal(registry.getDefault(), undefined);
  registry.register({ definition: { id: 'smtp', provider: mailer('smtp') } });
  assert.equal(registry.getDefault()?.id, 'smtp');
  const bad = thrown(() => createProviderRegistry<Mailer>({ contract: 'mail' }, { defaultProviderId: 'SMTP' }));
  assert.deepEqual([bad.code, bad.message], ['invalid_id', "mail default provider id 'SMTP' must match ^[a-z][a-z0-9_]{0,63}$"]);
});

test('registries are independent', () => {
  const a = createProviderRegistry<Mailer>({ contract: 'mail' });
  const b = createProviderRegistry<Mailer>({ contract: 'mail' });
  a.register({ definition: { id: 'smtp', provider: mailer('a') } });
  assert.equal(b.has({ id: 'smtp' }), false);
});

test('ProviderResult constructors build the three outcomes and copy the error', () => {
  assert.deepEqual(providerOk({ value: 3 }), { status: 'ok', value: 3 });
  const rejectedError = { code: 'rate_limited' as const, message: 'slow down', retryAfterMs: 1000 };
  const rejected = providerRejected(rejectedError);
  assert.deepEqual(rejected, { status: 'rejected', error: rejectedError });
  assert.notEqual(rejected.status === 'rejected' && rejected.error, rejectedError);
  assert.deepEqual(providerUnknown({ code: 'timeout', message: 'no reply in 10s' }), { status: 'unknown', error: { code: 'timeout', message: 'no reply in 10s' } });
});
