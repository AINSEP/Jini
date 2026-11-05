import { test, expect } from 'vitest';
import { createFormCollectionRegistry, resolveFormCollectionPlan } from '../provider.js';
import { encodeFormFields, decodeFormFields } from '../fields-json.js';


const definition = { slug: 'contact', fields: [], provider: { id: 'formspree', config: { endpoint: 'https://formspree.io/f/abc123' } } };
test('definition codec preserves provider for Builder and HTML, old arrays retain built-in default', () => {
  for (const mode of ['builder', 'html'] as const) {
    const stored = { ...definition, mode, html: '<input name="email">' };
    expect(decodeFormFields({ json: encodeFormFields({ definition: stored as never }) }).provider).toEqual(definition.provider);
  }
  expect(decodeFormFields({ json: '[]' }).provider).toBeUndefined();
});
test('provider registry isolates instances, handles absent plugin, and switches back without changing fields', () => {
  const providers = createFormCollectionRegistry({});
  expect(resolveFormCollectionPlan({ definition, providers })).toMatchObject({ kind: 'unavailable', code: 'provider_unavailable' });
  providers.contribute({ pluginId: 'jini/formspree', definition: { id: 'formspree', provider: { plan: ({ config }) => ({ kind: 'post', action: config.endpoint!, external: true, capabilities: { answers: 'external', validation: 'external', spamProtection: 'external' } }) } } });
  expect(resolveFormCollectionPlan({ definition, providers })).toMatchObject({ kind: 'post', action: definition.provider.config.endpoint, external: true });
  expect(resolveFormCollectionPlan({ definition: { ...definition, provider: { id: 'builtin', config: {} } }, providers })).toMatchObject({ kind: 'post', action: '/forms/contact/submit', external: false });
  expect(resolveFormCollectionPlan({ definition, providers: createFormCollectionRegistry({}) })).toMatchObject({ kind: 'unavailable' });
});

import { FormFieldValidationError } from '../errors.js';
import { renderFormCollection } from '../html-render.js';
import { createFormDefinition, updateFormDefinition, setFormDefinitionStatus } from '../write-service.js';
import { executeCommand } from '../../core/index.js';
import { InMemoryFormDefinitionRepo } from '../repo.memory.js';
import { InMemoryChangeSetRepo } from './change-set.fixture.js';
import { createContactFormResolver } from '../../widgets/resolvers/contact-form.js';

const hooks = { form: 'data-tovu-form', field: 'data-tovu-field', success: 'data-tovu-form-success', error: 'data-tovu-form-error' };
const external = { kind: 'post' as const, action: 'https://formspree.io/f/abc123', external: true, capabilities: { answers: 'Formspree', validation: 'Formspree', spamProtection: 'Formspree' } };
test('Builder and HTML collection render native external actions without built-in interception hooks', () => {
  for (const html of [undefined, '<label>Question<input name="email"></label><button>Send</button>']) {
    const rendered = renderFormCollection({ slug: 'contact', fields: [{ id: 'email', type: 'email', required: true, label: 'Email' }], hooks, plan: external }, html ? { html } : {});
    expect(rendered).toContain('method="post" action="https://formspree.io/f/abc123"');
    expect(rendered).toContain('name="email"');
    expect(rendered).not.toMatch(/data-tovu-form=|data-form-slug|name="_hp"|\/forms\/contact\/submit/);
  }
  expect(renderFormCollection({ slug: 'contact', fields: [], hooks, plan: { kind: 'unavailable', code: 'provider_unavailable', message: 'Formspree is unavailable <script>' } })).toContain('Formspree is unavailable &lt;script&gt;');
});
test('audited create, old-client field update, authoring/status and SQL envelope keep provider selection', async () => {
  let id = 0;
  const deps = { repo: new InMemoryFormDefinitionRepo(), executeCommand, clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++id}` }, changeSets: new InMemoryChangeSetRepo(), authorize: async () => ({ allowed: true, reason: 'test' }), permission: 'forms.manage', reservedSlugs: new Set<string>() };
  const actor = { id: 'owner', kind: 'user' as const };
  const { definition: created } = await createFormDefinition({ deps, input: { workspaceId: 'ws', actor, name: 'Contact', ...definition, fields: [{ id: 'question', label: 'Question', type: 'text', required: false }] } });
  const { definition: renamed } = await updateFormDefinition({ deps, input: { workspaceId: 'ws', actor, formId: created.id, patch: { name: 'Renamed' } } });
  const { definition: disabled } = await setFormDefinitionStatus({ deps, input: { workspaceId: 'ws', actor, formId: created.id, status: 'disabled' } });
  for (const stored of [created, renamed, disabled]) expect(decodeFormFields({ json: encodeFormFields({ definition: stored }) }).provider).toEqual(definition.provider);
  await expect(updateFormDefinition({ deps, input: { workspaceId: 'ws', actor, formId: created.id, patch: { provider: { id: 'formspree', config: { apiKey: 'never-store-this' } } } } })).rejects.toBeInstanceOf(FormFieldValidationError);
});
test('widget resolves the plan from the host registry and reports inactive providers visibly', async () => {
  const record = { id: 'contact', status: 'active', ...definition };
  const providers = createFormCollectionRegistry({});
  providers.contribute({ pluginId: 'test', definition: { id: 'formspree', provider: { plan: () => external } } });
  const deps = { formDefinitionRepo: { findById: async () => record, findBySlug: async () => record } };
  const instance = { id: 'widget', widgetType: 'contact-form' as const, config: { formDefinitionId: 'contact' } };
  const context = { workspaceId: 'ws', preview: false };
  const result = (await createContactFormResolver({ ...deps, formCollectionProviders: () => providers }).resolveMany([instance], context)).get('widget');
  expect(result).toMatchObject({ ok: true, ir: { props: { collectionPlan: external } } });
  const absent = (await createContactFormResolver(deps).resolveMany([instance], context)).get('widget');
  expect(absent).toMatchObject({ ok: true, ir: { props: { collectionPlan: { kind: 'unavailable' } } } });
});
