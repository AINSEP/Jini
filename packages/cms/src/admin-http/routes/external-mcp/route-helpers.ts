import type { RateLimitResult } from '@jini-ai/core/contracts/server';
import { externalMcpProviderRefusal } from './oauth.js';

/** Answers the shared limiter check, writing the 429 itself. `Retry-After` is set so a client can
 *  back off correctly instead of hammering. */
export async function withinRateLimit({ deps }: { deps: {
  check: () => Promise<RateLimitResult>;
  retryAfter: (value: string) => void;
  json: (body: unknown, status: number) => void;
  message: string;
} }, _optional = {}): Promise<boolean> {
  const result = await deps.check();
  if (result.allowed) return true;
  deps.retryAfter(String(result.retryAfterSeconds));
  deps.json({
    error: deps.message,
    code: "RATE_LIMIT_EXCEEDED",
    details: { retryAfterSeconds: result.retryAfterSeconds },
  }, 429);
  return false;
}

/**
 * Maps a caught error onto an HTTP response.
 *
 * Provider response bodies never reach the caller — `OAuthError.message` is built from a closed
 * vocabulary, and `operatorAction` is Tovu's own copy. The `retryable` flag is forwarded so an admin
 * client can tell "wait and poll again" from "this is over", without re-deriving that rule.
 *
 * @complexity O(1).
 */
export function externalMcpErrorStatus({ error, deps }: { error: unknown; deps: {
  apiConnection: abstract new (...args: never[]) => Error & { code: string };
  validation: abstract new (...args: never[]) => Error & { field: string };
  reauth: abstract new (...args: never[]) => Error & { code: string; settingsLink: string };
  secretStoreUnconfigured: abstract new (...args: never[]) => Error;
  oauth: abstract new (...args: never[]) => Error & { code: string; retryable: boolean; operatorAction: string; retryAfterSeconds?: number | undefined };
} }, _optional = {}): { status: number; body: unknown } | undefined {
  if (error instanceof deps.apiConnection) return { status: error.code === 'access-denied' ? 403 : 400, body: { error: error.message, code: error.code } };
  if (error instanceof deps.validation) return { status: 400, body: { error: error.message, code: 'INVALID_MCP_SERVER', details: { field: error.field } } };
  if (error instanceof deps.reauth) return { status: 409, body: { error: error.message, code: error.code, details: { retryable: false, settingsLink: error.settingsLink } } };
  if (error instanceof deps.secretStoreUnconfigured) {
    // Same status and code `routes/external-mcp/put.ts` already answers with for this class, so an
    // admin client has one contract to handle rather than two. It matters here because the routes
    // that still surface it — connect and the callback, which must OPEN the blob to authenticate to
    // the token endpoint — otherwise fall through to a bare 500 "internal error", which tells an
    // operator whose site key has rotated nothing about the one thing they can act on.
    return { status: 503, body: { error: error.message, code: 'SECRET_STORE_UNCONFIGURED' } };
  }
  if (error instanceof deps.oauth) return externalMcpReplyBody(externalMcpProviderRefusal({ error: { code: error.code, message: error.message, retryable: error.retryable, operatorAction: error.operatorAction,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  } }));
  return undefined;
}

/** The `{status, body}` pair this classifier answers with; the provider refusal always carries a body. */
function externalMcpReplyBody(reply: { readonly status: number; readonly body?: unknown }): { status: number; body: unknown } {
  return { status: reply.status, body: reply.body };
}
