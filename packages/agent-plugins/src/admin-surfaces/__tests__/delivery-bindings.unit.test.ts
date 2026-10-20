/**
 * @file Unit tests for the admin-surface `deliveryBindings` port's shapes and bounds: what the host
 * receives on save (a checked copy with only the known fields), what the plugin gets back (the port's
 * shape, never the host's connection ref), updating and removing the surface's own bindings, and the
 * refusals for a malformed draft (enabled flag, form ids, config) or an unknown binding id. The host is the shared
 * typed fake; no network.
 */
import { describe, expect, test } from 'vitest';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import type { AdminSurfaceCapabilityDeclarations } from '../capability-declarations.js';
import type { AdminSurfaceDeliveryBinding, AdminSurfaceDeliveryBindingDraft } from '../delivery-bindings.js';
import { openAdminSurfaceCapabilitySession } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

const DECLARED: AdminSurfaceCapabilityDeclarations = { connections: [{ id: 'account', startParams: [], callbackFields: [] }], deliveryAdapters: ['acme-rows', 'acme-notes'] };
const OURS: AdminSurfaceDeliveryBinding = { bindingId: 'ours-1', adapterId: 'acme-rows', connectionId: 'account', enabled: false, formIds: ['contact'], config: { tab: 7 } };
const DRAFT: AdminSurfaceDeliveryBindingDraft = { adapterId: 'acme-rows', connectionId: 'account', enabled: true, config: { tab: 1 } };

function open() {
  const fake = createFakeSurfaceHost({ bindings: [OURS] });
  const session = openAdminSurfaceCapabilitySession(
    { capabilities: fake.port({ pluginId: 'acme-office', workspaceId: WORKSPACE_ID }), isLive: () => true, declared: DECLARED, issued: new Set() },
    { actorId: 'admin-1' },
  );
  return { ...fake, port: session.capabilities.deliveryBindings! };
}

describe('save', () => {
  test('a new binding reaches the host as a checked copy with only the known fields', async () => {
    const session = open();
    // Malformed on purpose: a draft carrying a host field must not pass it on.
    await session.port.save({ ...DRAFT, connectionRef: 'ref-from-plugin' } as AdminSurfaceDeliveryBindingDraft);
    expect(session.log.calls).toEqual(['acme-office:bindings.save:{"adapterId":"acme-rows","connectionId":"account","enabled":true,"config":{"tab":1}}']);
  });
  test('the saved binding comes back in the port shape, without the host\'s connection ref', async () => {
    await expect(open().port.save({ ...DRAFT, formIds: [] })).resolves.toStrictEqual({ bindingId: 'binding-2', adapterId: 'acme-rows', connectionId: 'account', enabled: true, formIds: [], config: { tab: 1 } });
  });
  test('the stored config is a copy the plugin cannot change afterwards', async () => {
    const session = open();
    const config = { tab: 1 };
    await session.port.save({ ...DRAFT, config });
    config.tab = 2;
    expect(session.bindings.get('binding-2')?.config).toStrictEqual({ tab: 1 });
  });
  test('the stored form ids are a copy the plugin cannot change afterwards', async () => {
    const session = open();
    const formIds = ['contact'];
    await session.port.save({ ...DRAFT, formIds });
    formIds.push('quote');
    expect(session.bindings.get('binding-2')?.formIds).toStrictEqual(['contact']);
  });
  test('the surface\'s own binding is updated in place through its id', async () => {
    const session = open();
    await expect(session.port.save({ ...DRAFT, bindingId: 'ours-1', adapterId: 'acme-notes', formIds: ['contact', 'quote'] }))
      .resolves.toStrictEqual({ bindingId: 'ours-1', adapterId: 'acme-notes', connectionId: 'account', enabled: true, formIds: ['contact', 'quote'], config: { tab: 1 } });
    expect(session.bindings.size).toBe(1);
  });
  test('64 form ids are accepted', async () => {
    const formIds = Array.from({ length: 64 }, (_, index) => `form-${index}`);
    await expect(open().port.save({ ...DRAFT, formIds })).resolves.toMatchObject({ formIds });
  });
  test('a config of exactly the size limit is accepted', async () => {
    const config = { pad: 'x'.repeat(16 * 1024 - '{"pad":""}'.length) };
    await expect(open().port.save({ ...DRAFT, config })).resolves.toMatchObject({ bindingId: 'binding-2' });
  });

  // Malformed drafts on purpose (a plugin is JavaScript): each is refused before the host sees it.
  test.each([
    ['not an object', null, 'A delivery binding must be an object.'],
    ['a non-boolean enabled flag', { ...DRAFT, enabled: 'yes' }, 'A delivery binding needs enabled: true or false.'],
    ['form ids that are not an array', { ...DRAFT, formIds: 'contact' }, 'formIds must be at most 64 unique short form ids.'],
    ['65 form ids', { ...DRAFT, formIds: Array.from({ length: 65 }, (_, index) => `form-${index}`) }, 'formIds must be at most 64 unique short form ids.'],
    ['a form id outside the short-id shape', { ...DRAFT, formIds: ['contact', 'a b'] }, 'formIds must be at most 64 unique short form ids.'],
    ['a form id listed twice', { ...DRAFT, formIds: ['contact', 'contact'] }, 'formIds must be at most 64 unique short form ids.'],
    ['a config that is an array', { ...DRAFT, config: [1] }, "A delivery binding's config must be a JSON object."],
    ['a config that is missing', { ...DRAFT, config: undefined }, "A delivery binding's config must be a JSON object."],
    ['a config that is not plain JSON', { ...DRAFT, config: { at: new Date(0) } }, 'A settings value must be plain JSON data'],
  ])('a draft with %s is refused', async (_label, draft, message) => {
    const session = open();
    await expect(session.port.save(draft as unknown as AdminSurfaceDeliveryBindingDraft)).rejects.toThrow(message);
    expect(session.log.calls).toEqual([]);
  });
  test('an undeclared adapter id is cut to 64 characters in the refusal', async () => {
    const long = `x${'y'.repeat(99)}`;
    await expect(open().port.save({ ...DRAFT, adapterId: long })).rejects.toThrow(`This admin surface does not declare delivery adapter '${long.slice(0, 64)}', so`);
  });
  test('an unknown binding id is refused', async () => {
    await expect(open().port.save({ ...DRAFT, bindingId: 'missing' })).rejects.toThrow("No delivery binding 'missing' belongs to this surface's delivery adapters; list the bindings and retry.");
  });
});

describe('list and remove', () => {
  test('a binding the host stores without form ids lists without a formIds key', async () => {
    const session = open();
    const { formIds: _formIds, ...everyForm } = OURS;
    session.bindings.set('ours-1', everyForm);
    await expect(session.port.list()).resolves.toStrictEqual([everyForm]);
  });
  test('the surface\'s own binding is removed through its id', async () => {
    const session = open();
    await expect(session.port.remove({ bindingId: 'ours-1' })).resolves.toBeUndefined();
    expect(session.bindings.size).toBe(0);
    expect(session.log.calls).toEqual(['acme-office:bindings.list:{}', 'acme-office:bindings.remove:{"bindingId":"ours-1"}']);
  });
  test('removing an unknown binding id is refused', async () => {
    await expect(open().port.remove({ bindingId: 'missing' })).rejects.toThrow("No delivery binding 'missing' belongs to this surface's delivery adapters; list the bindings and retry.");
  });
});
