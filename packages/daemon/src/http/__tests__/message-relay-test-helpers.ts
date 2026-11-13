import type { ServerHandler } from '@jini-ai/core/contracts/server';

/** Calls a `Server`-contract claim handler the way an adapter would: a web Request plus path params. */
export async function postClaim(
  { handler }: { readonly handler: ServerHandler },
  { token, runId, body = { via: 'tool-result' } }: { readonly token?: string | undefined; readonly runId?: string | undefined; readonly body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request('http://daemon/api/runs/x/messages/claim', { method: 'POST', headers, body: JSON.stringify(body) });
  return handler({ request, params: runId === undefined ? {} : { runId } });
}
