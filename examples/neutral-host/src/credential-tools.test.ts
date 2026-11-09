import { expect, it } from 'vitest';
import { createApprovalHandler, indexCatalogById, type AgentToolDefinition, type ToolExecutionContext, type LegacyToolAuthorizeFn } from '@jini-ai/core';
import type { SecretCardForm, SurfaceCardFormSpec } from '@jini-ai/core/contracts/cards';
import type { CredentialSetSummary, CredentialedRequestPort, SourceControlWritePort } from '@jini-ai/core/contracts/credentials';
import { askThenReport, createSurfaceExchangeStore } from '@jini-ai/daemon/surface-exchanges';
import {
  createCredentialSaveHandlers, createCredentialToolRegistrations, createCredentialCopyRegistrations,
  type CredentialToolOperations, type CustomCredentialToolHost, type CustomCredentialSecretCards, type CredentialCopyToolHost,
} from '@jini-ai/integrations/credentialed-http/tools';

const ids = { list: 'library_inventory', verify: 'library_check', setUsername: 'library_account', makeRequest: 'library_request', writeFiles: 'library_files', save: 'library_save' };
const row: CredentialSetSummary = { credentialType: 'custom', id: 'book-key', label: 'Catalog', category: 'books', baseUrl: 'https://catalog.library.test', additionalHosts: [],
  worksFor: ['library-provider'], configured: true, username: 'reader', createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z', tokenHint: { length: 23, last4: 'HINT' } };
const context = (input: unknown): ToolExecutionContext => ({ executionId: 'book-call', principal: { id: 'librarian' }, run: { id: 'library-run' }, input, signal: new AbortController().signal });
const unused = async (): Promise<never> => { throw new Error('unexpected library operation'); };

function wire() {
  const events: string[] = [];
  let next = 0;
  const exchanges = createSurfaceExchangeStore({ clock: { nowMs: () => 0 }, idGenerator: { newId: () => `book-x-${++next}` }, defaultChannel: 'mcp-ui', scheduler: { schedule: () => () => undefined } });
  const authorize: LegacyToolAuthorizeFn = async ({ permission, entityType }) => { events.push(`${permission}:${entityType ?? ''}`); return { allowed: true, reason: 'library grant' }; };
  const catalog: AgentToolDefinition[] = [ids.list, ids.verify, ids.setUsername, ids.makeRequest, ids.writeFiles].map(name => ({ name, description: `Library ${name}`, inputSchema: { type: 'object' }, sideEffects: name === ids.list || name === ids.verify ? 'none' : 'mutates-durable-state', authorization: { permission: 'library.change' } }));
  const host: CustomCredentialToolHost = { vocabulary: { domain: 'library-vault', entityType: 'book-secret', catalogModule: 'library/catalog.ts', permissions: { read: 'library.inspect', write: 'library.change' }, catalog: indexCatalogById({ catalog }), metadata: {} },
    cardIdentity: { uriNamespace: 'library', appNames: { create: { appName: 'library-create', appVersion: '3' }, createOutcome: { appName: 'library-created', appVersion: '3' }, setToken: { appName: 'library-rotate', appVersion: '3' }, setTokenOutcome: { appName: 'library-rotated', appVersion: '3' } } } };
  const form = (): SecretCardForm => ({ title: 'Library human input', submitLabel: 'Library accept', fields: [{ kind: 'string', name: 'token', label: 'Library private key', secret: true }] });
  const operations: CredentialToolOperations = {
    ids, derivedRisk: new Map(catalog.map(tool => [tool.name, tool.sideEffects])), modelFacingErrors: [], formErrors: [],
    sets: { list: async () => [row], describe: async () => row, byLabel: async () => row, resolve: unused, setUsername: unused, replace: unused, create: unused },
    approval: { handler: steps => createApprovalHandler(steps), askHuman: unused, describeDelete: () => ({ toolId: ids.makeRequest, errorCode: 'LIBRARY_DELETE', title: 'Library removal', confirmLabel: 'Library yes', details: [] }) },
    pluginCards: { load: async () => [], find: async () => undefined, readValues: () => { throw new Error('unexpected plugin input'); } },
    credentialCardForms: { create: form, rotate: form, buildPlugin: form, applyPlugin: ({ form: supplied }) => supplied,
      createOutcome: ({ state, message }) => ({ title: 'Library created', state, message }), rotateOutcome: ({ state, message }) => ({ title: 'Library replaced', state, message }) },
    recovery: { withSetup: ({ invoke }) => invoke() }, publish: { loadProviders: async () => [], prepareInvalidation: async () => () => undefined },
    locale: { resolve: async () => 'library-locale', text: ({ id }) => `Library ${id}`, hint: () => 'Library human hint', translate: ({ message }) => message },
    policy: { guardRepo: ({ store }) => store, cleanToken: ({ token }) => token, assertFreeField: () => undefined, normalizeWorksFor: () => [], defaultCategory: 'books', isProjectConflict: () => false, validateWriteFiles: () => { throw new Error('unexpected file input'); } },
    messages: { formSaveFailure: 'Library failed', noCreateChannel: 'Library create needs a human', noRotateChannel: 'Library rotate needs a human', noDeleteChannel: 'Library delete needs a human', runEnded: 'Library ended', invalidWorksFor: 'Library purposes invalid', unlabeled: 'Library untitled', missingUsername: 'Library account required', invalidUsername: 'Library account invalid', probeOriginMismatch: 'Library origin mismatch',
      unexpectedUsername: () => 'Library account fields', unexpectedToken: () => 'Library token fields', notFoundLabel: () => 'Library label absent', notFoundId: () => 'Library id absent', duplicateLabel: () => 'Library duplicate', missingPluginCard: () => 'Library provider absent', writeFailure: () => 'Library write failed', probeFailure: () => 'Library probe failed' },
    diagnostics: { describeError: () => 'LibraryError', createFailure: () => undefined, rotateFailure: () => undefined, writeFailure: () => undefined },
  };
  const request: CredentialedRequestPort = { request: unused, resolveTarget: unused, verify: unused, probe: async () => 'ok', classifyError: ({ error }) => ({ category: 'unknown', error }) };
  const sourceControlWrite: SourceControlWritePort = { build: unused, validateTarget: () => { throw new Error('unexpected provider'); }, planFileWrite: unused, commitFiles: unused };
  const actor = { authorize, workspaceId: 'library-workspace', loadAuthSchemes: async () => [] };
  const cards: CustomCredentialSecretCards = { askThenReport,
    defineSecretCardTool: (spec, options) => ({ toolId: spec.toolId, secretFieldNames: prep => spec.form({ prep }).fields.filter(field => field.secret).map(field => field.name),
      handler: deps => async ctx => {
        expect(deps.surfaceExchanges).toBe(exchanges);
        expect(options?.uriHost).toBe('library');
        expect(options?.text?.noEmitter).toMatch(/^Library /);
        const prep = await spec.prepare({ ctx });
        events.push(JSON.stringify(spec.form({ prep })));
        return spec.result({ prep, run: { status: 'cancelled' } });
      } }),
  };
  return { events, exchanges, authorize, actor, host, operations, cards, ports: { credentialedRequest: request, sourceControlWrite } };
}

it('createCredentialToolRegistrations consumes the second host catalog, ids, permissions and metadata-only projection', async () => {
  const f = wire();
  const registrations = createCredentialToolRegistrations({ routeDeps: f.actor, host: f.host, operations: f.operations, ports: f.ports }, {});
  expect(registrations.map(r => r.descriptor.id)).toEqual([ids.list, ids.verify, ids.setUsername, ids.makeRequest, ids.writeFiles]);
  const result = await registrations[0]!.handler(context({}));
  const { tokenHint: _humanHint, ...safe } = row;
  expect(result).toEqual({ credentials: [safe] });
  expect(f.events).toEqual(['library.inspect:book-secret']);
  expect(JSON.stringify(result)).not.toContain('HINT');
  expect(() => createCredentialToolRegistrations({ routeDeps: f.actor, host: { ...f.host, vocabulary: { ...f.host.vocabulary, catalog: new Map() } }, operations: f.operations, ports: f.ports }, {})).toThrow('library/catalog.ts');
});

it('createCredentialSaveHandlers consumes foreign permissions, card namespace, app identities and required messages', async () => {
  const f = wire();
  const handlers = createCredentialSaveHandlers({ routeDeps: f.actor, host: f.host, operations: f.operations, ports: f.ports, cards: f.cards, surfaces: { surfaceExchanges: f.exchanges } }, {});
  expect(await handlers.create(context({}))).toEqual({ created: false, reason: 'cancelled' });
  expect(await handlers.rotate(context({ label: row.label }))).toEqual({ saved: false, reason: 'cancelled' });
  expect(f.events.filter(value => value === 'library.change:book-secret')).toHaveLength(2);
  const forms = f.events.filter(value => value.startsWith('{')).map(value => JSON.parse(value));
  expect(forms.map(form => form.app)).toEqual([{ appName: 'library-create', appVersion: '3' }, { appName: 'library-rotate', appVersion: '3' }]);
  expect(forms.map(form => form.title)).toEqual(['Library human input', 'Library human input']);
  await expect(handlers.pluginProvider(context({ provider: 'missing-library-provider' }))).rejects.toThrow('Library provider absent');
});

it('createCredentialCopyRegistrations uses the foreign card path and SAME actor-bound exchange before granting the selected reference', async () => {
  const f = wire();
  const toolId = 'library_use_key';
  const host: CredentialCopyToolHost<SurfaceCardFormSpec> = {
    vocabulary: { toolId, domain: 'library-picker', catalogModule: 'library/picker.ts', ownerPermission: 'library.own', newKeyValue: ':library-new', cardPath: 'library-picker' }, cardIdentity: { uriNamespace: 'library' },
    catalog: [{ name: toolId, description: 'Library choose a key', sideEffects: 'mutates-durable-state', authorization: { permission: 'library.own' }, inputSchema: { type: 'object' } }], metadata: {}, derivedRisk: new Map([[toolId, 'mutates-durable-state']]),
    messages: { ownerOnly: 'Library owner only', instanceRefused: 'Library session denied', unexpectedField: 'Library field denied', notOffered: 'Library key absent', inputNotEmpty: 'Library empty input required', keysUnavailable: 'Library keys unavailable', needsInteractive: 'Library human required', cardTitle: 'Library choose', siteLabel: 'Library branch', siteFallback: 'Library unnamed branch', cardDescription: 'Library grant one reference', fieldLabel: 'Library keys', fieldPlaceholder: 'Library select', newKeyLabel: 'Library new', submitLabel: 'Library grant', cancelLabel: 'Library cancel' },
    protocol: { askThenReport, buildFormSurface: spec => spec },
  };
  const registrations = createCredentialCopyRegistrations({ host, surfaces: { surfaceExchanges: f.exchanges }, deps: { workspaceId: 'library-workspace', ownerPrincipalId: Promise.resolve('librarian'), authorize: f.authorize, gatedMutations: { gatewayDeps: {} },
    projectKeys: { site: { name: 'Library branch' }, list: async () => [{ keyId: 'library-key', name: 'Library catalog key' }], permissionFor: async () => 'library.grant', use: async ({ keyId }) => { f.events.push(`grant:${keyId}`); }, savedResult: async ({ result }) => result } } }, {});
  let emitted = '';
  const result = await registrations[0]!.handler(context({}), { emitSurface: async emission => {
    emitted = JSON.stringify(emission);
    const exchangeId = f.exchanges.findTypedAnswerTarget({ principalId: 'librarian', toolId })!;
    expect(f.exchanges.deliver({ exchangeId, principalId: 'librarian', params: { credentialId: 'library-key' } }, { toolId, channel: 'mcp-ui' })).toEqual({ ok: true });
  } });
  expect(result).toEqual({ granted: true, credentialId: 'library-key' });
  expect(emitted).toContain('ui://library/library-picker/book-x-1');
  expect(emitted).toContain('Library grant one reference');
  expect(emitted).toContain(':library-new');
  expect(f.events).toEqual(['library.own:', 'library.own:', 'library.grant:', 'grant:library-key']);
  expect(f.exchanges.size()).toBe(0);
});
