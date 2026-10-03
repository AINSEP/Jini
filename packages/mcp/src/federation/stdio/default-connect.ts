import type { FederationMessages } from "../messages.js";
import { connectMcpHttpSession, createFetchMcpHttpExchange, type McpBearerTokenSupplier, type McpAuthenticationChallengeHook } from "../adapter.http.js";
import { connectMcpStdioSession, spawnMcpStdioChannel } from "./adapter.stdio.js";
import type { ResolvedFederatedConnection } from "../config.js";
import type { McpSessionPort, McpStdioChannel, McpStdioLaunchSpec, McpClientInfo } from "../ports.js";
import type { McpStdioLaunchResolver, ResolvedStdioLaunch } from "./stdio-launch-resolver.js";

/** Builds a transport session factory; warning deduplication is local to this instance.
 * @complexity O(1) to construct; connection work is bounded by the configured timeouts.
 */
export function createDefaultConnect(
  { resolver, clientInfo, messages, bearerToken }: {
    resolver: McpStdioLaunchResolver;
    clientInfo: McpClientInfo;
    messages: FederationMessages;
    bearerToken: McpBearerTokenSupplier;
  },
  { spawnChannel = ({ resolved }: { resolved: ResolvedStdioLaunch }) => spawnMcpStdioChannel({ ...resolved, messages }), fetch: fetchImpl = globalThis.fetch,
    connectHttp = connectMcpHttpSession, onAuthenticationChallenge, logger = { warn: ({ message }: { message: string }) => console.warn(message) } }: {
    spawnChannel?: ((required: { resolved: ResolvedStdioLaunch }) => McpStdioChannel) | undefined;
    fetch?: typeof fetch | undefined;
    connectHttp?: typeof connectMcpHttpSession | undefined;
    onAuthenticationChallenge?: McpAuthenticationChallengeHook | undefined;
    logger?: { warn(required: { message: string }): void } | undefined;
  } = {},
): (request: { connection: ResolvedFederatedConnection }) => Promise<McpSessionPort> {
  let warned = false;
  const loggedResolver: McpStdioLaunchResolver = {
    resolve({ spec }) {
      const resolved = resolver.resolve({ spec: spec });
      if (resolved.warning && !warned) {
        warned = true;
        logger.warn({ message: resolved.warning });
      }
      return resolved;
    },
  };
  return async function defaultConnect({ connection }: { connection: ResolvedFederatedConnection }): Promise<McpSessionPort> {
    if ("url" in connection.launch) {
      return connectHttp({
        messages,
        exchange: createFetchMcpHttpExchange({ fetch: fetchImpl }),
        spec: connection.launch,
        // Unlike the stdio arm, the hosted adapter has ONE timeout field, and it governs every
        // request the session ever sends (`adapter.http.ts`'s `McpHttpSession.postWithTimeout`),
        // the handshake included but not exclusively — every later `tools/call` reuses it too. So
        // `callTimeoutMs` is the right bound here, matching the stdio arm below: `connectTimeoutMs`
        // still needs its own outer race for that arm's `spawn`-can-hang gap, but this adapter's
        // request-scoped `AbortSignal` already bounds its own handshake, so no such race is needed
        // here — that much of the old comment stands, only the bound it fed was wrong.
        requestTimeoutMs: connection.config.callTimeoutMs,
        clientInfo,
        bearerToken,
      }, { onAuthenticationChallenge, logger });
    }
    return connectMcpStdioSessionWithSpawnTimeout(connection, connection.launch, loggedResolver, spawnChannel, clientInfo, messages);
  };
}

/**
 * The stdio session factory, with the outer timeout `spawn` requires.
 *
 * That timeout is not redundant with the adapter's per-request one. That one bounds a request whose
 * channel is alive; this one bounds the case where `spawn` itself hangs — a command that blocks
 * before it ever writes, an `npx` fetching a package on a stalled network — where no request has
 * been sent yet and so nothing inside the adapter has started counting. The hosted transport has no
 * equivalent gap, which is why only this arm needs the race.
 *
 * `resolver.resolve(launch)` runs BEFORE `spawnChannel`, inside the connection deadline: a throw here (desktop
 * resolver's contract for an unresolvable command — `McpLaunchUnavailableError`) becomes this whole
 * `connect` call's rejection, caught by {@link attachOneFederatedConnection}'s existing fail-open
 * catch exactly like a real spawn failure. So `uvx`/`docker`/anything else the resolver could not
 * find never reaches `spawnChannel` at all — no process, no hang, just the resolver's own message
 * logged and the connection dropped.
 */
async function connectMcpStdioSessionWithSpawnTimeout(
  connection: ResolvedFederatedConnection,
  launch: McpStdioLaunchSpec,
  resolver: McpStdioLaunchResolver,
  spawnChannel: (required: { resolved: ResolvedStdioLaunch }) => McpStdioChannel,
  clientInfo: McpClientInfo,
  messages: FederationMessages,
): Promise<McpSessionPort> {
  const timeoutMs = connection.config.connectTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  const timeoutError = () => new Error(`connect timed out after ${timeoutMs}ms`);
  let channel: McpStdioChannel | undefined;

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        // Synchronous ports cannot be interrupted by a JS timer. Check elapsed time after each
        // returns so a slow resolver cannot spawn, and a late spawn cannot begin the handshake.
        const resolved = resolver.resolve({ spec: launch });
        if (Date.now() >= deadline) throw timeoutError();
        channel = spawnChannel({ resolved });
        if (Date.now() >= deadline) throw timeoutError();
        return connectMcpStdioSession({ channel, requestTimeoutMs: connection.config.callTimeoutMs, clientInfo, messages });
      }),
      // Not `unref()`ed, for the same reason as `adapter.stdio.ts`'s per-request timer: an unref'd
      // timer would let the loop drain and abandon this race unsettled instead of rejecting. The
      // `finally` below clears it either way, so it never outlives the connect attempt.
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } catch (error) {
    // Whichever branch lost, the child process must not survive it.
    channel?.close({});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
