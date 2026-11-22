/**
 * @file Who may call the tool-execution routes, as a decision with no web or Express types: the caller
 * must present this boot's secret and come from this machine. The daemon's own routes run it as a gate in
 * front of the handler (before any body byte is read); a host that has other routes of its own to keep
 * private to the same caller (an Express app, say) adapts it to its framework, so there is one owner of
 * the sequence and the copies cannot drift.
 */
import { createApiError, type ApiError } from '@jini-ai/protocol';
import { timingSafeTokenMatch, type TimingSafeByteComparison } from '@jini-ai/core';
import { bearerTokenFromHeader, statusForError } from '@jini-ai/core/contracts/server';
import { isLoopbackPeerAddress } from '@jini-ai/core/net';

export const DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR = 'JINI_TOOL_EXEC_TOKEN';

/** A refusal: the status to answer with and the error to put in the body. */
export interface ToolExecutionCallerRefusal {
  readonly status: number;
  readonly error: ApiError;
}

/**
 * Decides whether a request may reach a tool-execution route. Checked in this order, each step failing closed:
 * the secret is configured (else `NOT_CONFIGURED`, 503: there is no "open" mode); the TCP peer is loopback
 * (else `FORBIDDEN`, 403; a forwarded header is never consulted); the bearer token matches in constant time
 * (else `UNAUTHORIZED`, 401).
 * @param required.authorization - The request's `Authorization` header, or `undefined` when it has none.
 * @param required.peerAddress - The address of the connection's immediate peer, or `undefined` when the host has none.
 * @param required.env - Where the secret is read from.
 * @param required.timingSafeEqual - The host's constant-time byte compare.
 * @param optional.tokenEnvVar - Names a different env var than {@link DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR}.
 * @returns `null` when the caller is allowed.
 */
export function toolExecutionCallerRefusal(
  { authorization, peerAddress, env, timingSafeEqual }: {
    readonly authorization: string | undefined;
    readonly peerAddress: string | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly timingSafeEqual: TimingSafeByteComparison;
  },
  { tokenEnvVar = DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR }: { readonly tokenEnvVar?: string } = {},
): ToolExecutionCallerRefusal | null {
  const refuse = (error: ApiError): ToolExecutionCallerRefusal => ({ status: statusForError({ error }), error });
  const expected = env[tokenEnvVar];
  if (!expected) return refuse(createApiError({ code: 'NOT_CONFIGURED', message: `${tokenEnvVar} is not set — remote tool execution is disabled` }));
  if (!isLoopbackPeerAddress({ address: peerAddress })) {
    return refuse(createApiError({ code: 'FORBIDDEN', message: 'remote tool execution accepts loopback callers only' }));
  }
  const presented = bearerTokenFromHeader({ header: authorization });
  if (presented === null || !timingSafeTokenMatch({ presented, expected, timingSafeEqual })) {
    return refuse(createApiError({ code: 'UNAUTHORIZED', message: `Authorization: Bearer <${tokenEnvVar}> required` }));
  }
  return null;
}
