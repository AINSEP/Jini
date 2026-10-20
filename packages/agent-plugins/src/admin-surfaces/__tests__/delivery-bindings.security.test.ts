/**
 * @file Security pins for the admin-surface `deliveryBindings` port: a surface manages form-delivery
 * bindings only for the delivery adapters it declared and only through its declared connections; a
 * binding's config is bounded plain JSON that never carries a token the plugin obtained (on the way in
 * and on the way out); another adapter's binding can be neither listed, overwritten nor removed; every
 * call needs a signed-in admin; disabling the plugin revokes the port. The host is the shared typed
 * fake, which deliberately lists every binding in the workspace, so the filtering proven here is Jini's.
 */
import { describe, expect, test } from 'vitest';
import { REVOKED_MESSAGE, createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { FAKE_TOKEN, WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import { createAdminSurfaceActionDispatcher, createAdminSurfaceHandlerHost, parseAdminSurfacesFile, type AdminSurfaceCapabilityDeclarations, type AdminSurfaceDescriptor, type AdminSurfaceHandlerModule } from '../index.js';
import type { AdminSurfaceDeliveryBinding } from '../delivery-bindings.js';
import { ADMIN_SURFACE_STATE_LIMITS, openAdminSurfaceCapabilitySession, STATE_CREDENTIAL_MESSAGE } from '../surface-capabilities.js';
import { createFakeSurfaceHost } from './surface-support.js';

const PLUGIN = 'acme-office';
const DECLARED: AdminSurfaceCapabilityDeclarations = { connections: [{ id: 'account', startParams: [], callbackFields: [] }], deliveryAdapters: ['acme-rows'] };
const OURS: AdminSurfaceDeliveryBinding = { bindingId: 'ours-1', adapterId: 'acme-rows', connectionId: 'account', enabled: true, allForms: true, config: { tab: 7 } };
const FOREIGN: AdminSurfaceDeliveryBinding = { bindingId: 'foreign-1', adapterId: 'other-adapter', connectionId: 'account', enabled: true, formIds: ['contact'], config: { list: 'x' } };
const DRAFT = { adapterId: 'acme-rows', connectionId: 'account', enabled: true, formIds: ['contact'], config: { tab: 1 } } as const;
const NO_FORMS = 'A delivery binding must name its forms: formIds (a list; [] for none) or allForms: true for every current and future form, not both.';
const NO_ACTOR = 'Delivery settings need a signed-in admin. Open the surface from an authenticated admin page and retry.';
const NOT_OURS = (id: string) => `No delivery binding '${id}' belongs to this surface's delivery adapters; list the bindings and retry.`;

function open(optional: { readonly actorId?: string | null; readonly live?: () => boolean; readonly issued?: Set<string> } = {}) {
  const fake = createFakeSurfaceHost({ bindings: [OURS, FOREIGN] });
  const actorId = optional.actorId === undefined ? 'admin-1' : optional.actorId;
  const session = openAdminSurfaceCapabilitySession(
    { capabilities: fake.port({ pluginId: PLUGIN, workspaceId: WORKSPACE_ID }), isLive: optional.live ?? (() => true), declared: DECLARED, issued: optional.issued ?? new Set() },
    actorId === null ? {} : { actorId },
  );
  return { ...fake, ...session, bindingsPort: session.capabilities.deliveryBindings! };
}

const surfaceRaw = (extra: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, surfaces: [{
  id: 'destination', title: 'Destination', entry: 'surface/index.html', handlerModule: 'server/handlers.mjs',
  actions: [{ name: 'save', input: { type: 'object' }, result: { type: 'object', properties: { count: { type: 'integer' } } } }], ...extra,
}] });
const reasonFor = (extra: Record<string, unknown>) => {
  const parsed = parseAdminSurfacesFile({ raw: surfaceRaw(extra) });
  return parsed.ok ? 'accepted' : parsed.reason;
};

describe('the surfaces file declares which delivery adapters a surface manages', () => {
  test('deliveryAdapters without a handler module is refused', () => {
    expect(reasonFor({ handlerModule: undefined, actions: [], deliveryAdapters: ['acme-rows'] })).toBe('surfaces[0].deliveryAdapters needs a handlerModule that uses it');
  });
  test.each([
    ['not an array', 'acme-rows'],
    ['more than 8', Array.from({ length: 9 }, (_, index) => `adapter-${index}`)],
  ])('a deliveryAdapters list that is %s is refused', (_label, deliveryAdapters) => {
    expect(reasonFor({ deliveryAdapters })).toBe('surfaces[0].deliveryAdapters must be an array of at most 8');
  });
  test.each([['Acme-Rows'], ['../rows'], ['a'.repeat(65)], [7]])('a delivery adapter id %j that is not a lowercase hyphenated id is refused', (id) => {
    expect(reasonFor({ deliveryAdapters: ['acme-rows', id] })).toBe('surfaces[0].deliveryAdapters[1] must be a unique name matching ^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$');
  });
  test('a delivery adapter declared twice is refused', () => {
    expect(reasonFor({ deliveryAdapters: ['acme-rows', 'acme-rows'] })).toBe('surfaces[0].deliveryAdapters[1] must be a unique name matching ^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$');
  });
  test('declared adapters are parsed onto the descriptor', () => {
    const parsed = parseAdminSurfacesFile({ raw: surfaceRaw({ deliveryAdapters: ['acme-rows', 'a'.repeat(64)] }) });
    expect(parsed.ok && parsed.descriptors[0]!.deliveryAdapters).toStrictEqual(['acme-rows', 'a'.repeat(64)]);
  });
});

describe('the port exists only where it is declared and provided', () => {
  test('a surface that declares no delivery adapters gets no deliveryBindings port', () => {
    const session = openAdminSurfaceCapabilitySession({ capabilities: createFakeSurfaceHost().port({ pluginId: PLUGIN, workspaceId: WORKSPACE_ID }), isLive: () => true, declared: { connections: DECLARED.connections! }, issued: new Set() }, { actorId: 'admin-1' });
    expect(session.capabilities).not.toHaveProperty('deliveryBindings');
  });
  test('a host that provides no deliveryBindings port leaves it absent', () => {
    const session = openAdminSurfaceCapabilitySession({ capabilities: createFakeSurfaceHost({ deliveryBindings: false }).port({ pluginId: PLUGIN, workspaceId: WORKSPACE_ID }), isLive: () => true, declared: DECLARED, issued: new Set() }, { actorId: 'admin-1' });
    expect(session.capabilities).not.toHaveProperty('deliveryBindings');
  });
});

describe('save: only declared adapters and connections, bounded token-free config', () => {
  test('an undeclared adapter is refused before the host sees it', async () => {
    const session = open();
    await expect(session.bindingsPort.save({ ...DRAFT, adapterId: 'other-adapter' }))
      .rejects.toThrow("This admin surface does not declare delivery adapter 'other-adapter', so its handlers cannot manage its bindings. Declare it in the surface's deliveryAdapters.");
    expect(session.log.calls).toEqual([]);
  });
  test('a connection the surface did not declare is refused before the host sees it', async () => {
    const session = open();
    await expect(session.bindingsPort.save({ ...DRAFT, connectionId: 'other-plugins-account' }))
      .rejects.toThrow("Delivery bindings may only use this surface's declared connections; 'other-plugins-account' is not one of them.");
    expect(session.log.calls).toEqual([]);
  });
  test('a config one byte over the limit is refused and nothing is saved', async () => {
    const session = open();
    const config = { pad: 'x'.repeat(ADMIN_SURFACE_STATE_LIMITS.maxValueBytes - '{"pad":""}'.length + 1) };
    await expect(session.bindingsPort.save({ ...DRAFT, config })).rejects.toThrow('A settings value may be at most 16384 bytes of JSON.');
    expect(session.log.calls).toEqual([]);
  });
  test('a config mentioning a token the plugin obtained is refused and nothing is saved', async () => {
    const session = open();
    const token = await session.capabilities.connections.getAccessToken({ connectionId: 'account' });
    await expect(session.bindingsPort.save({ ...DRAFT, config: { header: `Bearer ${token}` } })).rejects.toThrow(STATE_CREDENTIAL_MESSAGE);
    expect(session.log.calls).toEqual([]);
  });
  test('a config mentioning a token an earlier call (or a tool) obtained is refused', async () => {
    const session = open({ issued: new Set([FAKE_TOKEN]) });
    await expect(session.bindingsPort.save({ ...DRAFT, config: { nested: [{ value: FAKE_TOKEN }] } })).rejects.toThrow(STATE_CREDENTIAL_MESSAGE);
    expect(session.bindings.get('binding-3')).toBeUndefined();
  });
  test("another adapter's binding cannot be overwritten through its binding id", async () => {
    const session = open();
    await expect(session.bindingsPort.save({ ...DRAFT, bindingId: 'foreign-1' })).rejects.toThrow(NOT_OURS('foreign-1'));
    expect(session.bindings.get('foreign-1')).toStrictEqual(FOREIGN);
    expect(session.log.calls).toEqual([`${PLUGIN}:bindings.list:{}`]);
  });
});

describe('list and remove never reach another adapter\'s bindings', () => {
  test('list returns only the declared adapters\' bindings, even when the host returns more', async () => {
    await expect(open().bindingsPort.list()).resolves.toStrictEqual([OURS]);
  });
  test('list withholds the bindings when one mentions a token the plugin obtained', async () => {
    const session = open({ issued: new Set([FAKE_TOKEN]) });
    session.bindings.set('ours-2', { ...OURS, bindingId: 'ours-2', config: { leaked: FAKE_TOKEN } });
    await expect(session.bindingsPort.list()).rejects.toThrow('A delivery binding held a connection credential, so it was withheld. Remove it and save it again.');
  });
  test("removing another adapter's binding is refused and it stays", async () => {
    const session = open();
    await expect(session.bindingsPort.remove({ bindingId: 'foreign-1' })).rejects.toThrow(NOT_OURS('foreign-1'));
    expect(session.bindings.get('foreign-1')).toStrictEqual(FOREIGN);
    expect(session.log.calls).not.toContain(`${PLUGIN}:bindings.remove:{"bindingId":"foreign-1"}`);
  });
});

describe('which forms a binding delivers is always stated (never an implicit "every form")', () => {
  const { formIds: _formIds, ...noForms } = DRAFT;
  test.each([
    ['neither formIds nor allForms', noForms],
    ['allForms: false', { ...noForms, allForms: false }],
    ['allForms as a string', { ...noForms, allForms: 'true' }],
    ['both formIds and allForms', { ...DRAFT, allForms: true }],
  ])('a draft with %s is refused before the host sees it', async (_label, draft) => {
    const session = open();
    // Malformed on purpose: a plugin is JavaScript and may send any of these.
    await expect(session.bindingsPort.save(draft as unknown as Parameters<typeof session.bindingsPort.save>[0])).rejects.toThrow(NO_FORMS);
    expect(session.log.calls).toEqual([]);
  });
  test('allForms: true reaches the host as stated, without a formIds key', async () => {
    const session = open();
    await expect(session.bindingsPort.save({ ...noForms, allForms: true })).resolves.toMatchObject({ allForms: true });
    expect(session.log.calls.at(-1)).toBe('acme-office:bindings.save:{"adapterId":"acme-rows","connectionId":"account","enabled":true,"allForms":true,"config":{"tab":1}}');
  });
  test('a binding the host lists without stating its forms is refused, never read as every form', async () => {
    const session = open();
    const { allForms: _allForms, ...unstated } = OURS as AdminSurfaceDeliveryBinding & { allForms: true };
    // Malformed on purpose: a host that still stores "absent = every form" must map it to allForms: true.
    session.bindings.set('ours-1', unstated as unknown as AdminSurfaceDeliveryBinding);
    await expect(session.bindingsPort.list()).rejects.toThrow("The host listed delivery binding 'ours-1' without formIds or allForms; fix the host's binding store.");
  });
});

describe('a signed-in admin and a live plugin are required', () => {
  test.each([
    ['list', (s: ReturnType<typeof open>) => s.bindingsPort.list()],
    ['save', (s: ReturnType<typeof open>) => s.bindingsPort.save(DRAFT)],
    ['remove', (s: ReturnType<typeof open>) => s.bindingsPort.remove({ bindingId: 'ours-1' })],
  ])('%s without a signed-in admin is refused before the host sees it', async (_name, call) => {
    const session = open({ actorId: null });
    await expect(call(session)).rejects.toThrow(NO_ACTOR);
    expect(session.log.calls).toEqual([]);
  });

  test.each([
    ['list', (s: ReturnType<typeof open>) => s.bindingsPort.list()],
    ['save', (s: ReturnType<typeof open>) => s.bindingsPort.save(DRAFT)],
    ['remove', (s: ReturnType<typeof open>) => s.bindingsPort.remove({ bindingId: 'ours-1' })],
  ])('%s on a revoked session is refused before the host sees it', async (_name, call) => {
    const session = open({ live: () => false });
    await expect(call(session)).rejects.toThrow(REVOKED_MESSAGE);
    expect(session.log.calls).toEqual([]);
  });

  test('a port a handler module kept is revoked once the plugin is disabled', async () => {
    const parsed = parseAdminSurfacesFile({ raw: surfaceRaw({ connections: [{ id: 'account' }], deliveryAdapters: ['acme-rows'] }) });
    const descriptor = (parsed.ok ? parsed.descriptors[0] : undefined) as AdminSurfaceDescriptor & { handlerModule: string };
    let kept: Parameters<AdminSurfaceHandlerModule['actions'][string]>[0]['capabilities'] | undefined;
    const fake = createFakeSurfaceHost({ bindings: [OURS] });
    const host = createAdminSurfaceHandlerHost({ hostKind: 'hosted', issuedTokens: createIssuedTokenMemories(), capabilities: fake.port });
    host.sync({ loaded: [{ pluginId: PLUGIN, descriptor, module: { actions: { save: async ({ capabilities }) => { kept = capabilities; return { count: (await capabilities.deliveryBindings!.list()).length }; } } } }], refusals: [] });
    const context = { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: PLUGIN, surfaceId: 'destination' };
    await expect(createAdminSurfaceActionDispatcher({ descriptor, handlers: host.handlersFor({ pluginId: PLUGIN, surfaceId: 'destination' }) }).dispatch({ action: 'save', payload: {}, context }))
      .resolves.toStrictEqual({ ok: true, result: { count: 1 } });
    host.sync({ loaded: [], refusals: [] });
    for (const call of [kept!.deliveryBindings!.list(), kept!.deliveryBindings!.save(DRAFT), kept!.deliveryBindings!.remove({ bindingId: 'ours-1' })]) await expect(call).rejects.toThrow(REVOKED_MESSAGE);
    expect(fake.bindings.get('ours-1')).toStrictEqual(OURS);
  });
});
