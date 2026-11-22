import { FETCH_TIMEOUT_MS } from '@jini-ai/core/net';
import type { HttpClientPort, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import type { GithubApiRegistryClientOptions } from '../github-client.js';

const GITHUB_API = 'https://api.github.com';
/** Pinned per GitHub's own recommendation (`X-GitHub-Api-Version` header), matching `@jini-ai/deploy`'s `packages/agent-plugins/github-pages/targets/github-pages.mjs` — see that file's doc comment for the sourcing rationale. */
const GITHUB_API_VERSION = '2026-03-10';

/**
 * The single request builder: every call goes to `apiUrl` with the GitHub
 * headers (bearer auth only when a token is configured) and the QUICK
 * idle/total bounds. A JSON `body` adds the JSON content type.
 */
export function createGithubSender({ http, token }: { http: HttpClientPort; token: string | undefined }, options: Pick<GithubApiRegistryClientOptions, 'apiUrl'> = {}) {
  const apiUrl = options.apiUrl ?? GITHUB_API;
  return (method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<HttpResponse> => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const headers = githubHeaders(token, json === undefined ? {} : { 'Content-Type': 'application/json' });
    const request: HttpRequest = { url: `${apiUrl}${path}`, method, headers, idleTimeoutMs: FETCH_TIMEOUT_MS.QUICK, totalDeadlineMs: FETCH_TIMEOUT_MS.QUICK, ...(json === undefined ? {} : { body: json }) };
    return http.send({ request });
  };
}

function githubHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

