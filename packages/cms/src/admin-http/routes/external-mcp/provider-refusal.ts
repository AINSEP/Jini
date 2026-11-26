import { routeReply, type RouteReply } from "@jini-ai/core/contracts/server";

export function externalMcpProviderRefusal({ error }: { error: { code: string; message: string; retryable: boolean; operatorAction: string; retryAfterSeconds?: number } }, _optional = {}): RouteReply {
  // 502 for "we could not reach them", 400 for "they refused us or we asked wrongly" — the two
  // demand different things of the operator (wait/check network vs. check configuration), and
  // collapsing them would tell someone behind a flaky network that their client id is wrong.
  const status = error.code === 'OAUTH_PROVIDER_UNREACHABLE' ? 502 : 400;
  return routeReply({ status, body: { error: error.message, code: error.code, details: { retryable: error.retryable, operatorAction: error.operatorAction,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  } } });
}

