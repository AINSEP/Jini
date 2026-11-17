/** @file The read-only JSON list of notes (`GET /api/notes`). */
import type { Server } from '@jini-ai/core/contracts/server';
import { listEntries } from '@jini-ai/cms/entries';
import type { AppDeps } from '../app-deps.ts';
import { noteBody } from '../note-body.ts';
import { json } from '../pages.ts';
import { NOTE_TYPE, WORKSPACE_ID } from '../ports.ts';

async function listNotes({ deps }: { deps: AppDeps }): Promise<Response> {
  const { items } = await listEntries({ repo: deps.entryRepo, workspaceId: WORKSPACE_ID }, { type: NOTE_TYPE });
  return json({ value: { notes: items.map((n) => ({ slug: n.slug, title: n.title, body: noteBody({ entry: n }), status: n.status, version: n.version })) } });
}

export function registerNotesApi({ app, deps }: { app: Server; deps: AppDeps }, _optional: Record<string, never> = {}): void {
  app.route({ method: 'GET', path: '/api/notes', handler: () => listNotes({ deps }) });
}
