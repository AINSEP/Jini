/**
 * @file How the characterization suite asks a route a question and writes the answer down. An
 * answer is one short string (`status` plus the error code, or the shape of a success body), so a
 * whole route family reads as a table and any change to a status, a code or a leak shows as one row.
 */
import { INTERNAL_FAILURE_MARKER, type RouteHarness } from './harness.js';

/** An origin no local policy accepts. */
export const FOREIGN_ORIGIN = 'http://evil.example';

/** The refusal every same-origin gate gives. */
export const CROSS_ORIGIN_MESSAGE = 'cross-origin request rejected';

export interface ProbeAnswer {
  /** `status code`, `status json{keys}`, `status error-string` or `status text:<body>`; ends in ` leaks-dependency-message` when the body carries the stand-in dependency's own error text. */
  readonly summary: string;
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** The parsed body, or undefined when it is not JSON. */
  readonly json: unknown;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function bodySummary({ json, text }: { json: unknown; text: string }): string {
  if (json === undefined || json === null || typeof json !== 'object') return `text:${text.slice(0, 60)}`;
  const error = (json as { error?: unknown }).error;
  if (typeof error === 'string') return 'error-string';
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : `json{${Object.keys(json).sort().join(',')}}`;
}

/** Every `:name` segment filled with a fixed value, so one request per route can be built from its path alone. */
export function concretePath(path: string): string {
  return path.replace(/:[A-Za-z]+/g, 'x1');
}

/**
 * Sends one request to `route` (`METHOD /path`). A body-carrying method sends `body` (default `{}`) as JSON.
 * @param optional.origin - Sent as the `Origin` header; omitted means a same-origin caller.
 */
export async function probe(
  { harness, route }: { harness: RouteHarness; route: string },
  { origin, headers = {}, body = '{}', contentType = 'application/json' }: { origin?: string; headers?: Record<string, string>; body?: string | Uint8Array; contentType?: string } = {},
): Promise<ProbeAnswer> {
  const [method = 'GET', path = '/'] = route.split(' ');
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const request = new Request(`http://harness.invalid${concretePath(path)}`, {
    method,
    headers: { ...(hasBody ? { 'content-type': contentType } : {}), ...(origin ? { origin } : {}), ...headers },
    ...(hasBody ? { body } : {}),
  });
  const response = await harness.fetch(request);
  const text = await response.text();
  const json = parseJson(text);
  const leak = text.includes(INTERNAL_FAILURE_MARKER) ? ' leaks-dependency-message' : '';
  return { summary: `${response.status} ${bodySummary({ json, text })}${leak}`, status: response.status, headers: response.headers, text, json };
}
