// GAP: G6 no Server registrar for an AdminEntityPort (admin ships no entity adapters)
/**
 * @file JSON routes for one entity port on the `Server` contract: list, get, create, patch and (only when the
 * port can remove) delete. Generic over the port; request bodies go through core's bounded `readJsonBody`.
 * A port signals a client mistake by throwing an error carrying `code` VALIDATION, NOT_FOUND or CONFLICT;
 * any other error is not hidden: it propagates to the adapter, which reports it and answers 500.
 */
import { apiErrorBody, readJsonBody, statusForError, type Server, type ServerApiError } from '@jini-ai/core/contracts/server';
import type { AdminEntityListQuery, AdminErasedEntityPort } from '@jini-ai/admin/core';

const PORT_CODES = new Set(['VALIDATION', 'NOT_FOUND', 'CONFLICT']);
const STATUS: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409 };
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

const reply = ({ status, value }: { status: number; value: unknown }): Response => Response.json(value, { status });
const failure = ({ error }: { error: ServerApiError }): Response => reply({ status: statusForError({ error }), value: apiErrorBody({ error }) });
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Runs `work`, turning a port's coded error into its HTTP answer; anything else is rethrown. */
async function answering({ work }: { work: () => Promise<Response> }): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    if (typeof code !== 'string' || !PORT_CODES.has(code)) throw error;
    return reply({ status: STATUS[code] ?? 400, value: apiErrorBody({ error: { code, message: (error as Error).message } }) });
  }
}

function readQuery({ url }: { url: string }): { query: AdminEntityListQuery } | { bad: string } {
  const params = new URL(url).searchParams;
  const limit = params.get('limit');
  if (limit !== null && !/^[1-9]\d*$/.test(limit)) return { bad: 'limit must be a positive whole number' };
  const cursor = params.get('cursor');
  const search = params.get('search');
  return { query: { ...(limit === null ? {} : { limit: Number(limit) }), ...(cursor ? { cursor } : {}), ...(search ? { search } : {}) } };
}

async function readObjectBody({ request, maxBytes }: { request: Request; maxBytes: number }): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  const read = await readJsonBody({ request }, { maxBytes });
  if (!read.ok) return { response: failure({ error: read.error }) };
  if (!isPlainObject(read.value)) return { response: failure({ error: { code: 'BAD_REQUEST', message: 'The request body must be a JSON object.' } }) };
  return { body: read.value };
}

const notFound = (): Response => failure({ error: { code: 'NOT_FOUND', message: 'No row has this id.' } });

/** Registers the routes for `port` under `basePath` (for example `/api/entities/things`). */
export function registerEntityRoutes(
  { app, port, basePath }: { readonly app: Server; readonly port: AdminErasedEntityPort; readonly basePath: string },
  { maxBodyBytes = DEFAULT_MAX_BODY_BYTES }: { readonly maxBodyBytes?: number } = {},
): void {
  const withBody = (handle: (body: Record<string, unknown>) => Promise<Response>) => async ({ request }: { request: Request }): Promise<Response> => {
    const read = await readObjectBody({ request, maxBytes: maxBodyBytes });
    return 'response' in read ? read.response : answering({ work: () => handle(read.body) });
  };
  app.route({ method: 'GET', path: basePath, handler: ({ request }) => answering({ work: async () => {
    const parsed = readQuery({ url: request.url });
    return 'bad' in parsed ? failure({ error: { code: 'BAD_REQUEST', message: parsed.bad } }) : reply({ status: 200, value: await port.list(parsed.query) });
  } }) });
  app.route({ method: 'GET', path: `${basePath}/:id`, handler: ({ params }) => answering({ work: async () => {
    const row = await port.get(params.id ?? '');
    return row === null ? notFound() : reply({ status: 200, value: row });
  } }) });
  app.route({ method: 'POST', path: basePath, handler: withBody(async (body) => reply({ status: 201, value: await port.create(body) })) });
  app.route({ method: 'PATCH', path: `${basePath}/:id`, handler: ({ request, params }) =>
    withBody(async (body) => reply({ status: 200, value: await port.update(params.id ?? '', body) }))({ request }) });
  const { remove } = port;
  if (remove) {
    app.route({ method: 'DELETE', path: `${basePath}/:id`, handler: ({ params }) => answering({ work: async () => {
      await remove.call(port, params.id ?? '');
      return new Response(null, { status: 204 });
    } }) });
  }
}
