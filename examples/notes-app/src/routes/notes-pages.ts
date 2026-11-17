/** @file The server-rendered note pages: list, create, detail, edit and publish. */
import type { Server } from '@jini-ai/core/contracts/server';
import { createEntry, listEntries, publishEntry, updateEntry } from '@jini-ai/cms/entries';
import { renderHtmlForm } from '@jini-ai/cms/forms/html-render';
import { CONTACT_SLUG, FORM_HOOKS, type AppDeps } from '../app-deps.ts';
import { noteBody } from '../note-body.ts';
import { html, json, listPage, notePage, readForm, redirect } from '../pages.ts';
import { NOTE_TYPE, WORKSPACE_ID } from '../ports.ts';

type Args = { request: Request; params: Readonly<Record<string, string>> };

const notePath = ({ slug }: { slug: string }): string => `/notes/${encodeURIComponent(slug)}`;

async function showList({ deps }: { deps: AppDeps }): Promise<Response> {
  const { items } = await listEntries({ repo: deps.entryRepo, workspaceId: WORKSPACE_ID }, { type: NOTE_TYPE });
  return html({ body: listPage({ notes: items }) });
}

async function createNote({ deps, request }: { deps: AppDeps } & Pick<Args, 'request'>): Promise<Response> {
  const form = await readForm({ request });
  const result = await createEntry({ deps: { ...deps.entryDeps, ids: deps.ports.idGen }, input: {
    ...deps.actor, workspaceId: WORKSPACE_ID, type: NOTE_TYPE, slug: form.slug ?? '', title: form.title ?? '',
    fieldsJson: { ext: { site: {} } }, bodyJson: { text: form.body ?? '' },
  } });
  if (!result.ok) return json({ value: { error: result.error.message } }, { status: 400 });
  return redirect({ location: notePath({ slug: result.value.entry.slug }) });
}

async function showNote({ deps, request, params }: { deps: AppDeps } & Args): Promise<Response> {
  const note = await deps.findNoteBySlug({ slug: params.slug ?? '' });
  if (!note) return html({ body: '<h1>Not found</h1>' }, { status: 404 });
  const { contactForm } = deps;
  const contactHtml = renderHtmlForm({
    slug: contactForm.slug, fields: contactForm.fields, hooks: FORM_HOOKS,
    action: `/forms/${CONTACT_SLUG}?note=${encodeURIComponent(note.slug)}`,
  });
  const sent = new URL(request.url).searchParams.get('sent') === '1';
  return html({ body: notePage({ note, body: noteBody({ entry: note }), contactHtml, sent }) });
}

async function editNote({ deps, request, params }: { deps: AppDeps } & Args): Promise<Response> {
  const note = await deps.findNoteBySlug({ slug: params.slug ?? '' });
  if (!note) return json({ value: { error: 'not found' } }, { status: 404 });
  const form = await readForm({ request });
  const result = await updateEntry({ deps: deps.entryDeps, input: {
    ...deps.actor, workspaceId: WORKSPACE_ID, id: note.id, expectedVersion: Number(form.version ?? note.version),
    ...(form.title !== undefined ? { title: form.title } : {}),
    ...(form.body !== undefined ? { bodyJson: { text: form.body } } : {}),
  } });
  if (!result.ok) return json({ value: { error: result.error.message } }, { status: 409 });
  return redirect({ location: notePath({ slug: note.slug }) });
}

async function publishNote({ deps, params }: { deps: AppDeps } & Pick<Args, 'params'>): Promise<Response> {
  const note = await deps.findNoteBySlug({ slug: params.slug ?? '' });
  if (!note) return json({ value: { error: 'not found' } }, { status: 404 });
  const result = await publishEntry({ deps: deps.entryDeps, input: { ...deps.actor, workspaceId: WORKSPACE_ID, id: note.id, expectedVersion: note.version } });
  if (!result.ok) return json({ value: { error: result.error.message } }, { status: 409 });
  return redirect({ location: notePath({ slug: note.slug }) });
}

export function registerNotesPages({ app, deps }: { app: Server; deps: AppDeps }, _optional: Record<string, never> = {}): void {
  app.route({ method: 'GET', path: '/', handler: () => showList({ deps }) });
  app.route({ method: 'POST', path: '/notes', handler: ({ request }) => createNote({ deps, request }) });
  app.route({ method: 'GET', path: '/notes/:slug', handler: ({ request, params }) => showNote({ deps, request, params }) });
  app.route({ method: 'POST', path: '/notes/:slug/edit', handler: ({ request, params }) => editNote({ deps, request, params }) });
  app.route({ method: 'POST', path: '/notes/:slug/publish', handler: ({ params }) => publishNote({ deps, params }) });
}
