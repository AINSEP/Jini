/** @file Mounts the note entity port as JSON under `/api/entities/note`, and the fixed local-owner session. */
import type { Server } from '@jini-ai/core/contracts/server';
import type { AppDeps } from '../app-deps.ts';
import { registerEntityRoutes } from '../gaps/entity-routes.ts';
import { createNoteEntityPort } from '../notes-entity.ts';
import { json } from '../pages.ts';
import { OWNER_ID } from '../ports.ts';

export const NOTE_ENTITY_PATH = '/api/entities/note';

export function registerEntities({ app, deps }: { app: Server; deps: AppDeps }, _optional: Record<string, never> = {}): void {
  const port = createNoteEntityPort({ deps: { entryRepo: deps.entryRepo, entryDeps: deps.entryDeps, ids: deps.ports.idGen, actor: deps.actor } });
  registerEntityRoutes({ app, port, basePath: NOTE_ENTITY_PATH });
  // The app has one local owner and no login: the session is always that owner (AdminAuthUser shape).
  app.route({ method: 'GET', path: '/api/session', handler: () => json({ value: { user: { id: OWNER_ID, username: 'owner' } } }) });
}
