import { randomBytes } from "node:crypto";
import { nowIso as readNowIso } from "@jini-ai/core/primitives";
import type { DeviceAuthorization, OAuthTokenSet } from "@jini-ai/core/contracts/oauth";
import type { DeviceAuthorizationStore, ExternalMcpOAuthService } from "./contracts.js";
import { createSharedExternalMcpOAuth } from "./shared-sign-in.js";
import { oauthClientOptions, requireOAuthRecord, readStoredEndpoints, readStoredScopes, resolveProviderDescriptor, resolveClient, type SignInDeps, type ExternalMcpOAuthServiceDeps } from "./sign-in-provider.js";
import { selfConfigureConnection } from "./sign-in-configuration.js";
import { persistTokens, setOAuthStatus } from "./sign-in-status.js";
import { CONNECT_TIMEOUT_MS, CLIENT_REJECTED_PROVIDER_CODES, ownerKeyOf, resourceOption, beginDeviceCodeConnect, sealedRedirectState } from "./sign-in-flow.js";

/**
 * @file Connects `@jini-ai/oauth`'s generic client to one external-MCP connection row.
 *
 * This is the ONLY module that knows both halves. `@jini-ai/oauth` knows nothing about MCP;
 * the hosted store knows nothing about token endpoints; this file owns the join and nothing
 * else. The host owns HTTP routes and binds federation separately.
 *
 * Callback routes reuse the connectors' public mount, XSS-safe page, origin-checked popup bridge,
 * focus-regain fallback and per-IP limiters. Authorization grants, PKCE, exchange, refresh and
 * expiry are owned by `@jini-ai/oauth` behind provider-agnostic descriptors.
 *
 * ## Connect-time failures are loud, fast and never retried
 *
 * A connect attempt is a FOREGROUND action with a human watching a spinner — the exact opposite of
 * boot-time federation, which fails open precisely because nobody
 * asked for that server at that moment. So every call here is bounded by a timeout and reports a
 * specific failure; nothing loops. An authorization code is single-use and the first response may
 * have been lost AFTER the provider redeemed it, so an automatic retry can burn a code that
 * actually worked. The operator retries with one click; the machine does not retry at all.
 */

/**
 * How long a process may hold the cross-process refresh lease.
 *
 * Comfortably longer than {@link CONNECT_TIMEOUT_MS} so a legitimate in-flight refresh is never
 * treated as abandoned, and short enough that a process killed mid-refresh frees the connection
 * within a minute rather than until the next restart.
 */
const REFRESH_LEASE_MS = 45_000;

/** Bounded by the per-workspace server cap, so no explicit eviction policy is needed beyond
 *  overwriting a connection's own previous attempt. */
export function createDeviceAuthorizationStore(): DeviceAuthorizationStore {
  const byServerId = new Map<string, DeviceAuthorization>();
  return {
    async put(serverId, authorization) {
      byServerId.set(serverId, authorization);
    },
    async get(serverId) {
      return byServerId.get(serverId);
    },
    async delete(serverId) {
      byServerId.delete(serverId);
    },
  };
}

/** Calls {@link ExternalMcpOAuthDeps.onConnected}, keeping its failure out of the sign-in's result. */
async function notifyConnected(deps: SignInDeps, serverId: string): Promise<void> {
  if (!deps.onConnected) return;
  try {
    await deps.onConnected(serverId);
  } catch (error) {
    deps.ports.log.postConnectFailed({ serverId, error });
  }
}

function createConnectionTokenRefresher(deps: ExternalMcpOAuthServiceDeps) {
  return deps.ports.flow.createTokenRefresher({
    clock: deps.clock,
    sleep: ({ ms }) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    port: {
      async load({ key: serverId }) {
        const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
        if (!record) return null;
        // A row already parked in `needs_reauth` must not be probed again on every tool call: the
        // state is durable and only a human clears it.
        if (deps.ports.projections.oauthStatus(record) === "needs_reauth") return null;
        const payload = await deps.ports.store.openPayload(deps.sealer, record);
        return payload.tokens === undefined
          ? null
          : { ...payload.tokens, scopes: [...payload.tokens.scopes] };
      },

      async refresh({ key: serverId, refreshToken }) {
        const record = await requireOAuthRecord(deps, serverId);
        const provider = resolveProviderDescriptor(deps, record);
        return deps.ports.withCopy({ call: async () => deps.ports.flow.refreshAccessToken(
          { ...deps.httpPorts, clock: deps.clock, tokenEndpoint: provider.tokenEndpoint,
            client: await resolveClient(deps, record, provider), refreshToken },
          { scopes: readStoredScopes(record), ...resourceOption(readStoredEndpoints(record).resource), timeoutMs: CONNECT_TIMEOUT_MS },
        ) });
      },

      async persist({ key: serverId, tokens }) {
        const record = await requireOAuthRecord(deps, serverId);
        await persistTokens(deps, record, tokens);
      },

      async markNeedsReauth({ key: serverId }) {
        // The token is CLEARED, not kept: it is known dead, and a dead credential sitting in the
        // row is one accidental read away from being sent to a provider that will reject it.
        await setOAuthStatus(deps, serverId, "needs_reauth", { clearToken: true });
      },

      async tryAcquireRefreshLease({ key: serverId }) {
        const nowIso = readNowIso({ clock: deps.clock });
        return deps.repo.tryClaimOAuthRefreshLease({
          workspaceId: deps.workspaceId,
          serverId,
          nowIso,
          leaseUntil: new Date(Date.parse(nowIso) + REFRESH_LEASE_MS).toISOString(),
        });
      },

      async releaseRefreshLease({ key: serverId }) {
        await deps.repo.releaseOAuthRefreshLease({ workspaceId: deps.workspaceId, serverId });
      },
    },
  });
}

function createSharedConnectionService(deps: ExternalMcpOAuthServiceDeps) {
  return deps.shared ? createSharedExternalMcpOAuth({ deps, shared: deps.shared, ports: deps.ports, resolveProvider: record => resolveProviderDescriptor(deps, record), configure: async input => {
    const record = await selfConfigureConnection(deps, await requireOAuthRecord(deps, input.serverId), input.redirectUri, { configurationOnly: true });
    const provider = resolveProviderDescriptor(deps, record);
    const endpoints = readStoredEndpoints(record);
    return { record, provider, client: await resolveClient(deps, record, provider), scopes: readStoredScopes(record),
      resource: endpoints.resource ?? record.url ?? undefined, issuer: endpoints.issuer };
  } }) : undefined;
}

type SignInContext = {
  deps: ExternalMcpOAuthServiceDeps;
  shared: ReturnType<typeof createSharedConnectionService>;
};

async function beginConnectionAuthorization({ deps, shared }: SignInContext, input: Parameters<ExternalMcpOAuthService['beginConnect']>[0]): ReturnType<ExternalMcpOAuthService['beginConnect']> {
      if (input.destination === 'shared' && !shared) throw deps.ports.errors.validation(deps.ports.copy.sharedLocalOnly, 'destination');
      if (shared && (input.destination === 'shared' || await shared.hasBinding(input))) return shared.beginConnect(input);
      // Self-configuration first: a row that names no endpoints or no client id gets them here, once,
      // and every step below then reads an ordinary fully-specified connection.
      const record = await selfConfigureConnection(deps, await requireOAuthRecord(deps, input.serverId), input.redirectUri);
      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);
      const scopes = readStoredScopes(record);
      // Keep the advertised audience across grants; the MCP URL need not be the resource id.
      const resource = readStoredEndpoints(record).resource;

      if (record.oauthGrant === "device_code") return beginDeviceCodeConnect({ deps, record, provider, client, scopes, resource });

      // Every path below this line is redirect-based, so the requirement is real rather than
      // defensive — and it is stated where it can name both the grant and the fix, instead of being
      // a blanket precondition a caller had to satisfy before it knew which grant it had.
      const redirectUri = input.redirectUri;
      if (redirectUri === undefined) {
        throw deps.ports.errors.validation(deps.ports.copy.noPublicOrigin({ serverId: record.serverId }), "redirectUri");
      }

      // The authenticated GET sets the shared browser-binding cookie before revealing a provider
      // URL. This also works when the daemon prepared the connection in another process.
      if (input.delivery === 'hosted') {
        await setOAuthStatus(deps, record.serverId, 'pending');
        return {
          kind: 'redirect_required',
          authorizationUrl: deps.ports.signInLink({ callbackUrl: redirectUri, workspaceId: deps.workspaceId, serverId: record.serverId }),
          expiresAt: new Date(deps.clock.nowMs() + 600_000).toISOString(),
        };
      }
      const started = await deps.ports.withCopy({ call: () => deps.ports.flow.beginAuthorizationCode(
        { provider, stateless: sealedRedirectState({ deps, serverId: record.serverId, browserBinding: input.browserBinding }), guard: deps.httpPorts.guard,
          randomBytesFn: ({ byteLength }) => randomBytes(byteLength),
          options: oauthClientOptions(deps.ports, record, redirectUri),
          ownerKey: ownerKeyOf(deps.workspaceId, record.serverId),
          client,
          redirectUri,
        }, {
          scopes,
          ...resourceOption(resource),
          messages: deps.ports.oauthMessages,
        },
      ) });
      await setOAuthStatus(deps, record.serverId, "pending");
      return { kind: "redirect_required", authorizationUrl: started.authorizationUrl, expiresAt: started.expiresAt };
    }

async function completeConnectionAuthorization({ deps, shared }: SignInContext, input: Parameters<ExternalMcpOAuthService['completeAuthorizationCallback']>[0], _options: Parameters<ExternalMcpOAuthService['completeAuthorizationCallback']>[1] = {}): ReturnType<ExternalMcpOAuthService['completeAuthorizationCallback']> {
      if (shared && await shared.hasBinding(input)) { await shared.completeAuthorizationCallback(input); await notifyConnected(deps, input.serverId); return; }
      const record = await requireOAuthRecord(deps, input.serverId);
      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);

      let tokens: OAuthTokenSet;
      try {
        tokens = await deps.ports.withCopy({ call: () => deps.ports.flow.completeAuthorizationCode(
          { ...deps.httpPorts, provider, stateless: sealedRedirectState({ deps, serverId: record.serverId, browserBinding: input.browserBinding }), clock: deps.clock,
            redirectUri: input.redirectUri,
            ownerKey: ownerKeyOf(deps.workspaceId, record.serverId),
            client,
            params: input.params,
          }, {
            timeoutMs: CONNECT_TIMEOUT_MS,
          },
        ) });
      } catch (error) {
        // A provider that refuses the CLIENT (revoked, or never known) will refuse it on every retry,
        // so a self-registered one is dropped and the next connect mints a fresh one. The provider's
        // error still reaches the caller.
        if (deps.ports.errors.isOAuthError(error) && CLIENT_REJECTED_PROVIDER_CODES.includes(error.providerErrorCode ?? "")) {
          await setOAuthStatus(deps, record.serverId, "disconnected", { clearToken: true, forgetSelfRegisteredClient: true });
        }
        throw error;
      }
      // Re-read rather than reusing `record`: `beginConnect` wrote `pending` to it, and persisting a
      // stale copy would resurrect the pre-connect row wholesale.
      await persistTokens(deps, await requireOAuthRecord(deps, input.serverId), tokens);
      await notifyConnected(deps, input.serverId);
    }

async function pollConnectionAuthorization({ deps, shared }: SignInContext, input: Parameters<ExternalMcpOAuthService['pollDeviceAuthorization']>[0]): ReturnType<ExternalMcpOAuthService['pollDeviceAuthorization']> {
      if (shared && await shared.hasBinding(input)) {
        const result = await shared.pollDeviceAuthorization(input);
        if (result.status === "connected") await notifyConnected(deps, input.serverId);
        return result;
      }
      const record = await requireOAuthRecord(deps, input.serverId);
      const authorization = await deps.devices.get(input.serverId);
      if (!authorization) {
        throw deps.ports.errors.oauth({ code: "OAUTH_INVALID_STATE", message: `no device authorization is in progress for '${input.serverId}'`, operatorAction: deps.ports.copy.actions.restartDevice, });
      }

      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);
      try {
        const tokens = await deps.ports.withCopy({ call: () => deps.ports.flow.pollDeviceAuthorizationOnce(
          { ...deps.httpPorts, provider, clock: deps.clock,
            client,
            deviceCode: authorization.deviceCode,
            expiresAt: authorization.expiresAt,
          }, {
            // The token request names the same audience the device start asked for (RFC 8707).
            ...resourceOption(readStoredEndpoints(record).resource),
            timeoutMs: CONNECT_TIMEOUT_MS,
          },
        ) });
        await deps.devices.delete(input.serverId);
        await persistTokens(deps, record, tokens);
        await notifyConnected(deps, input.serverId);
        return { status: "connected" };
      } catch (error) {
        // The ONLY retryable branch in this whole module — RFC 8628 §3.5 requires the client to keep
        // polling on these two, and only these two.
        if (deps.ports.errors.isOAuthError(error) && error.retryable) {
          return { status: "pending", retryAfterSeconds: error.retryAfterSeconds ?? authorization.intervalSeconds };
        }
        await deps.devices.delete(input.serverId);
        await setOAuthStatus(deps, input.serverId, "disconnected");
        throw error;
      }
    }

async function disconnectConnection({ deps, shared }: SignInContext, input: Parameters<ExternalMcpOAuthService['disconnect']>[0]): ReturnType<ExternalMcpOAuthService['disconnect']> {
      if (shared && await shared.hasBinding(input)) {
        await shared.disconnect(input);
        return;
      }
      await deps.devices.delete(input.serverId);
      // A self-registered client goes too, so a reconnect is a clean one: a client the vendor has
      // since dropped would otherwise be reused forever. An operator-typed client is kept.
      await setOAuthStatus(deps, input.serverId, "disconnected", { clearToken: true, forgetSelfRegisteredClient: true });
    }

async function reportConnectionAuthFailure({ deps, shared }: SignInContext, serverId: Parameters<ExternalMcpOAuthService['reportAuthFailure']>[0], error: Parameters<ExternalMcpOAuthService['reportAuthFailure']>[1]): ReturnType<ExternalMcpOAuthService['reportAuthFailure']> {
      if (shared && await shared.hasBinding({ serverId })) {
        await shared.markNeedsReauth({ serverId });
        throw deps.ports.errors.reauthRequired({ serverId, cause: error });
      }
      const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
      // A preset connection, a `static_env` row, or one already deleted has no reauth state this
      // service owns — see `createExternalMcpConnectionGate`'s identical passthrough.
      if (!record || deps.ports.projections.authMode(record) !== "oauth") throw error;

      // The state write is BEST EFFORT; the terminal error below is the guarantee. `setOAuthStatus`
      // can still fail here — a row write that rejects, or a blob `openExternalMcpOAuthPayload`
      // refuses for a reason that is NOT `ExternalMcpSecretStoreUnconfiguredError` (a payload written
      // at a newer schema version, which `hydrateExternalMcpOAuthPayload` throws deliberately outside
      // its own catch). Letting that escape would hand the caller an incidental error in place of the
      // terminal one, and every consumer branches on the CLASS: the connection gate would not engage,
      // the in-chat `external_mcp_reauth_prompt` surface would never render, and the "do not retry"
      // sentence a model needs in order to stop hammering a dead connection would be gone — the
      // failure mode that surface exists for. So the write's failure is carried out as `cause`
      // instead of thrown in its place: nothing is silently swallowed, and nothing displaces the
      // signal. A row left un-updated is recoverable on the next call; a lost signal is not.
      let statusWriteFailure: unknown;
      // Idempotent: a call that arrives after `tokenResolver` already discovered the same dead
      // grant must not re-clear an already-cleared token or bump `updatedAt` needlessly.
      if (deps.ports.projections.oauthStatus(record) !== "needs_reauth") {
        try {
          await setOAuthStatus(deps, serverId, "needs_reauth", { clearToken: true });
        } catch (writeError) {
          statusWriteFailure = writeError;
        }
      }
      throw deps.ports.errors.reauthRequired({
        serverId,
        label: record.label,
        ...(statusWriteFailure === undefined ? {} : { cause: statusWriteFailure }),
      });
    }

function createConnectionTokenResolver({ deps, shared }: SignInContext, refresher: ReturnType<typeof createConnectionTokenRefresher>): ExternalMcpOAuthService['tokenResolver'] {
  return {
      ...(shared ? { resolveSharedAccessToken: shared.getAccessToken } : {}),
      async resolveAccessToken({ serverId }) {
        const sharedToken = await shared?.getAccessToken({ serverId });
        if (sharedToken !== undefined) return sharedToken;
        try {
          return await refresher.getAccessToken({ key: serverId });
        } catch (error) {
          // Whatever the refresher's own taxonomy says, the caller here is about to hand a message to
          // a model, so a `needs_reauth` outcome is translated into the one non-retryable sentence
          // that makes it stop. Anything else (a provider outage) keeps its own error, because it is
          // NOT a durable state and must not be reported as one.
          if (deps.ports.errors.isOAuthError(error) && error.code === "OAUTH_INVALID_GRANT") {
            const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
            throw deps.ports.errors.reauthRequired({ serverId, label: record?.label ?? null });
          }
          throw error;
        }
      },
    };
}

/**
 * Builds the OAuth service for one workspace.
 *
 * @returns The service plus its `tokenResolver`, which `readEnabledExternalMcpConfigs` takes.
 * @complexity Construction is O(1) and performs no I/O.
 * @tradeoffs The assistant daemon can start a redirect that the web server completes: encrypted
 *   state carries the verifier and connection binding across that split using the same site key.
 *   No pending row or shared process memory is needed. The provider's single-use code and the
 *   state's expiry prevent replay. Device authorization still uses the injected durable store;
 *   its in-memory adapter is only suitable when begin and poll run in the same process.
 */
export function createHostedMcpSignInService(required: SignInDeps, _optional: Record<string, never> = {}): ExternalMcpOAuthService {
  const deps: ExternalMcpOAuthServiceDeps = { ...required, providers: required.providers ?? required.ports.flow.createOAuthProviderRegistry({ guard: required.httpPorts.guard }) };
  const refresher = createConnectionTokenRefresher(deps);
  const shared = createSharedConnectionService(deps);
  const context = { deps, shared };
  return {
    ...(shared ? { assertSharedAuthorized: shared.assertAuthorized, useSharedConnection: shared.useSaved, useLocalConnection: shared.useLocal, listSharedConnections: shared.list } : {}),
    beginConnect: beginConnectionAuthorization.bind(null, context),
    completeAuthorizationCallback: completeConnectionAuthorization.bind(null, context),
    pollDeviceAuthorization: pollConnectionAuthorization.bind(null, context),
    disconnect: disconnectConnection.bind(null, context),
    reportAuthFailure: reportConnectionAuthFailure.bind(null, context),
    tokenResolver: createConnectionTokenResolver(context, refresher),
  };
}
