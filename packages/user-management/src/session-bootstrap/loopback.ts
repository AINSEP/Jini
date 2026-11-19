// Names may resolve elsewhere; only the literal address bound by the host is admitted.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '[::1]']);

/**
 * Returns the parsed plain-HTTP loopback URL or throws a reason-specific refusal.
 * Call immediately before sending credentials; async transports turn refusal into
 * rejection before issuing a request. Parsing and normalization follow URL semantics.
 */
export function assertLoopbackHttpUrl(
  required: { url: string },
  optional: { message?: (required: { reason: 'invalid' | 'scheme' | 'host'; detail: string }, optional?: Record<string, never>) => string } = {},
): URL {
  const message: NonNullable<typeof optional.message> = optional.message ?? (({ reason, detail }) => `loopback guard refused: ${reason}: ${detail}`);
  let parsed: URL;
  try {
    parsed = new URL(required.url);
  } catch {
    throw new Error(message({ reason: 'invalid', detail: required.url }));
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(message({ reason: 'scheme', detail: parsed.protocol }));
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(message({ reason: 'host', detail: parsed.hostname }));
  }
  return parsed;
}
