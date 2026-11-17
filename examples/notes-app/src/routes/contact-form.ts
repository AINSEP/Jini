/** @file The contact form: submit (`POST /forms/:slug`) and list submissions. */
import type { Server } from '@jini-ai/core/contracts/server';
import { submitForm, FormRateLimitExceededError, FormSubmissionValidationError } from '@jini-ai/cms/forms';
import type { AppDeps } from '../app-deps.ts';
import { json, readForm, redirect } from '../pages.ts';
import { WORKSPACE_ID } from '../ports.ts';

type SubmitArgs = { request: Request; params: Readonly<Record<string, string>>; client: { readonly address: string } | undefined };

async function submitContact({ deps, request, params, client }: { deps: AppDeps } & SubmitArgs): Promise<Response> {
  const body = await readForm({ request });
  // The socket peer from the adapter, never a request header: the app binds to localhost and
  // trusts no proxy. A host behind a proxy applies resolveClientIp (@jini-ai/http-kit/rate-limit)
  // to this value. Without a peer, every such request shares one bucket rather than escaping it.
  const sourceIp = client?.address ?? 'unknown';
  const { ports } = deps;
  try {
    await submitForm({
      deps: {
        definitionRepo: deps.definitionRepo, submissionRepo: deps.submissionRepo, outbox: ports.outbox, dispatcher: ports.dispatcher,
        logger: ports.logger, clock: ports.clock, idGen: ports.idGen, crypto: globalThis.crypto, rateLimiter: ports.rateLimiter,
        transaction: (work) => deps.kernel.transaction(work),
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
}

async function listSubmissions({ deps, params }: { deps: AppDeps; params: Readonly<Record<string, string>> }): Promise<Response> {
  const definition = await deps.definitionRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: params.slug ?? '' });
  if (!definition) return json({ value: { error: 'not found' } }, { status: 404 });
  const page = await deps.submissionRepo.listByDefinition({ workspaceId: WORKSPACE_ID, formDefinitionId: definition.id, limit: 100 });
  return json({ value: { submissions: page.items.map((s) => ({ id: s.id, data: s.data, submittedAt: s.submittedAt })) } });
}

export function registerContactForm({ app, deps }: { app: Server; deps: AppDeps }, _optional: Record<string, never> = {}): void {
  app.route({ method: 'POST', path: '/forms/:slug', handler: ({ request, params, client }) => submitContact({ deps, request, params, client }) });
  app.route({ method: 'GET', path: '/api/forms/:slug/submissions', handler: ({ params }) => listSubmissions({ deps, params }) });
}
