/**
 * @file Registers the notes app's routes on any `Server` (core contract). Wiring only: the note
 * lifecycle is `@jini-ai/cms/entries`, the contact form is `@jini-ai/cms/forms`.
 */
import type { Server } from '@jini-ai/core/contracts/server';
import { executeCommand } from '@jini-ai/cms/core';
import { createEntry, listEntries, publishEntry, updateEntry, type EntryRecord } from '@jini-ai/cms/entries';
import {
  createFormDefinition, submitForm, FormRateLimitExceededError, FormSubmissionValidationError,
  type FieldDescriptor, type FormDefinitionRecord,
} from '@jini-ai/cms/forms';
import { formDefinitionRepoFor, formSubmissionRepoFor } from '@jini-ai/cms/forms/sql';
import { renderHtmlForm } from '@jini-ai/cms/forms/html-render';
import { FORMS_TABLES, type AppKernel } from './db.ts';
import { createSqlEntryRepo } from './notes-repo.ts';
import { authorize, createAppPorts, NOTE_TYPE, OWNER_ID, WORKSPACE_ID } from './ports.ts';
import { html, json, listPage, notePage, readForm, redirect } from './pages.ts';

const CONTACT_SLUG = 'contact';
const CONTACT_FIELDS: FieldDescriptor[] = [
  { id: 'name', label: 'Your name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'message', label: 'Message', type: 'textarea', required: true },
];
// The hooks are the CSS/data-attribute anchors renderHtmlForm writes; no default set is exported.
const FORM_HOOKS = { field: 'data-field', form: 'data-form', success: 'data-form-success', error: 'data-form-error' };

const noteBody = ({ entry }: { entry: EntryRecord }, _optional: Record<string, never> = {}): string => {
  const body = entry.bodyJson as { text?: unknown } | null;
  return typeof body?.text === 'string' ? body.text : '';
};

export async function registerNotesApp({ app, kernel }: { app: Server; kernel: AppKernel }, _optional: Record<string, never> = {}) {
  const ports = await createAppPorts();
  const entryRepo = createSqlEntryRepo({ kernel });
  const definitionRepo = formDefinitionRepoFor({ kernel, tables: FORMS_TABLES });
  const submissionRepo = formSubmissionRepoFor({ kernel, tables: FORMS_TABLES });
  const entryDeps = {
    entryRepo, contentTypeRepo: ports.contentTypeRepo, clock: ports.clock, authorize, outbox: ports.entryOutbox,
  };
  const actor = { actorId: OWNER_ID, principalKind: 'user' as const };

  // Seed the contact form once; the definition row lives in SQLite, so later boots find it.
  let contact: FormDefinitionRecord | null = await definitionRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: CONTACT_SLUG });
  if (!contact) {
    ({ definition: contact } = await createFormDefinition({
      deps: {
        executeCommand, repo: definitionRepo, clock: ports.clock, idGen: ports.idGen, changeSets: ports.changeSets,
        permission: 'admin.forms.manage', reservedSlugs: new Set(), authorize,
      },
      input: { workspaceId: WORKSPACE_ID, actor: { id: OWNER_ID, kind: 'user' }, name: 'Contact', slug: CONTACT_SLUG, fields: CONTACT_FIELDS },
    }));
  }
  const contactForm = contact;

  const findBySlug = ({ slug }: { slug: string }, _optional: Record<string, never> = {}) => entryRepo.findBySlug({ workspaceId: WORKSPACE_ID, type: NOTE_TYPE, slug });

  app.route({ method: 'GET', path: '/', handler: async () => {
    const { items } = await listEntries({ repo: entryRepo, workspaceId: WORKSPACE_ID }, { type: NOTE_TYPE });
    return html({ body: listPage({ notes: items }) });
  } });

  app.route({ method: 'GET', path: '/api/notes', handler: async () => {
    const { items } = await listEntries({ repo: entryRepo, workspaceId: WORKSPACE_ID }, { type: NOTE_TYPE });
    return json({ value: { notes: items.map((n) => ({ slug: n.slug, title: n.title, body: noteBody({ entry: n }), status: n.status, version: n.version })) } });
  } });

  app.route({ method: 'POST', path: '/notes', handler: async ({ request }) => {
    const form = await readForm({ request });
    const result = await createEntry({ deps: { ...entryDeps, ids: ports.idGen }, input: {
      ...actor, workspaceId: WORKSPACE_ID, type: NOTE_TYPE, slug: form.slug ?? '', title: form.title ?? '',
      fieldsJson: { ext: { site: {} } }, bodyJson: { text: form.body ?? '' },
    } });
    if (!result.ok) return json({ value: { error: result.error.message } }, { status: 400 });
    return redirect({ location: `/notes/${encodeURIComponent(result.value.entry.slug)}` });
  } });

  app.route({ method: 'GET', path: '/notes/:slug', handler: async ({ request, params }) => {
    const note = await findBySlug({ slug: params.slug ?? '' });
    if (!note) return html({ body: '<h1>Not found</h1>' }, { status: 404 });
    const contactHtml = renderHtmlForm({
      slug: contactForm.slug, fields: contactForm.fields, hooks: FORM_HOOKS,
      action: `/forms/${CONTACT_SLUG}?note=${encodeURIComponent(note.slug)}`,
    });
    const sent = new URL(request.url).searchParams.get('sent') === '1';
    return html({ body: notePage({ note, body: noteBody({ entry: note }), contactHtml, sent }) });
  } });

  app.route({ method: 'POST', path: '/notes/:slug/edit', handler: async ({ request, params }) => {
    const note = await findBySlug({ slug: params.slug ?? '' });
    if (!note) return json({ value: { error: 'not found' } }, { status: 404 });
    const form = await readForm({ request });
    const result = await updateEntry({ deps: entryDeps, input: {
      ...actor, workspaceId: WORKSPACE_ID, id: note.id, expectedVersion: Number(form.version ?? note.version),
      ...(form.title !== undefined ? { title: form.title } : {}),
      ...(form.body !== undefined ? { bodyJson: { text: form.body } } : {}),
    } });
    if (!result.ok) return json({ value: { error: result.error.message } }, { status: 409 });
    return redirect({ location: `/notes/${encodeURIComponent(note.slug)}` });
  } });

  app.route({ method: 'POST', path: '/notes/:slug/publish', handler: async ({ params }) => {
    const note = await findBySlug({ slug: params.slug ?? '' });
    if (!note) return json({ value: { error: 'not found' } }, { status: 404 });
    const result = await publishEntry({ deps: entryDeps, input: { ...actor, workspaceId: WORKSPACE_ID, id: note.id, expectedVersion: note.version } });
    if (!result.ok) return json({ value: { error: result.error.message } }, { status: 409 });
    return redirect({ location: `/notes/${encodeURIComponent(note.slug)}` });
  } });

  app.route({ method: 'POST', path: '/forms/:slug', handler: async ({ request, params, client }) => {
    const body = await readForm({ request });
    // The socket peer from the adapter, never a request header: the app binds to localhost and
    // trusts no proxy. A host behind a proxy applies resolveClientIp (@jini-ai/http-kit/rate-limit)
    // to this value. Without a peer, every such request shares one bucket rather than escaping it.
    const sourceIp = client?.address ?? 'unknown';
    try {
      await submitForm({
        deps: {
          definitionRepo, submissionRepo, outbox: ports.outbox, dispatcher: ports.dispatcher, logger: ports.logger,
          clock: ports.clock, idGen: ports.idGen, rateLimiter: ports.rateLimiter, transaction: (work) => kernel.transaction(work),
        },
        input: { workspaceId: WORKSPACE_ID, slug: params.slug ?? '', body, sourceIp },
      });
    } catch (error) {
      if (error instanceof FormSubmissionValidationError) return json({ value: { error: error.message } }, { status: 422 });
      if (error instanceof FormRateLimitExceededError) return json({ value: { error: error.message } }, { status: 429 });
      throw error;
    }
    const note = new URL(request.url).searchParams.get('note');
    return note ? redirect({ location: `/notes/${encodeURIComponent(note)}?sent=1` }) : json({ value: { status: 'accepted' } }, { status: 202 });
  } });

  app.route({ method: 'GET', path: '/api/forms/:slug/submissions', handler: async ({ params }) => {
    const definition = await definitionRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: params.slug ?? '' });
    if (!definition) return json({ value: { error: 'not found' } }, { status: 404 });
    const page = await submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: definition.id, limit: 100 });
    return json({ value: { submissions: page.items.map((s) => ({ id: s.id, data: s.data, submittedAt: s.submittedAt })) } });
  } });

}
