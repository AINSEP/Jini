/**
 * @file Registers the notes app's routes on any `Server` (core contract). Wiring only: the note
 * lifecycle is `@jini-ai/cms/entries`, the contact form is `@jini-ai/cms/forms`.
 */
import { withServerMiddleware, type Server } from '@jini-ai/core/contracts/server';
import type { AppKernel } from './db.ts';
import { createAppDeps } from './app-deps.ts';
import { createOriginGuard } from './gaps/origin-guard.ts';
import { registerContactForm } from './routes/contact-form.ts';
import { registerNotesApi } from './routes/notes-api.ts';
import { registerNotesPages } from './routes/notes-pages.ts';

/**
 * Every route registered here sits behind the Host/Origin guard. `port` is the real bound port,
 * read per request (it is only known after `listen`), never taken from a request header.
 */
export async function registerNotesApp(
  { app, kernel, port }: { app: Server; kernel: AppKernel; port: () => number },
  _optional: Record<string, never> = {},
): Promise<void> {
  const deps = await createAppDeps({ kernel });
  const guarded = withServerMiddleware({ server: app, middleware: [createOriginGuard({ port })] });
  registerNotesPages({ app: guarded, deps });
  registerNotesApi({ app: guarded, deps });
  registerContactForm({ app: guarded, deps });
}
