/**
 * @file Registers the notes app's routes on any `Server` (core contract). Wiring only: the note
 * lifecycle is `@jini-ai/cms/entries`, the contact form is `@jini-ai/cms/forms`.
 */
import type { Server } from '@jini-ai/core/contracts/server';
import type { AppKernel } from './db.ts';
import { createAppDeps } from './app-deps.ts';
import { registerContactForm } from './routes/contact-form.ts';
import { registerNotesApi } from './routes/notes-api.ts';
import { registerNotesPages } from './routes/notes-pages.ts';

export async function registerNotesApp({ app, kernel }: { app: Server; kernel: AppKernel }, _optional: Record<string, never> = {}): Promise<void> {
  const deps = await createAppDeps({ kernel });
  registerNotesPages({ app, deps });
  registerNotesApi({ app, deps });
  registerContactForm({ app, deps });
}
