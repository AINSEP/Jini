import type { UUID } from "@jini-ai/core/primitives";
import type { OAuthClient, OAuthProviderDescriptor } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpConnectStart, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { SignInDeps, ExternalMcpOAuthServiceDeps } from "./sign-in-provider.js";
import { setOAuthStatus } from "./sign-in-status.js";

/** A human is watching. Long enough for a slow but working provider, short enough that a dead one is
 *  reported while the operator still has the tab open. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** Provider `error` codes that mean the client itself is refused (RFC 6749 §4.1.2.1 and §5.2), as
 *  opposed to the grant or the request. */
export const CLIENT_REJECTED_PROVIDER_CODES: readonly string[] = ["invalid_client", "unauthorized_client"];

/** The binding key an authorization `state` is issued against. Workspace-scoped so a state minted in
 *  one workspace cannot be redeemed in another, and server-scoped so it cannot be redeemed against a
 *  different connection in the same workspace. */
export function ownerKeyOf(workspaceId: UUID, serverId: string): string {
  return `${workspaceId}:${serverId}`;
}

/** EXTRACT-S5 H3 (moved under `exactOptionalPropertyTypes`): an absent audience is omitted instead of passed as
 *  `undefined`; the OAuth operations treat both the same (`input.resource === undefined`). No I/O. */
export function resourceOption(resource: string | undefined): { resource?: string } {
  return resource === undefined ? {} : { resource };
}

/** Device-code grant: start the device authorization, park it for polling, and hand the user code back. */
export async function beginDeviceCodeConnect({ deps, record, provider, client, scopes, resource }: { deps: ExternalMcpOAuthServiceDeps; record: ExternalMcpServerRecord; provider: OAuthProviderDescriptor; client: OAuthClient; scopes: string[]; resource: string | undefined }): Promise<ExternalMcpConnectStart> {
  const authorization = await deps.ports.withCopy({ call: () => deps.ports.flow.beginDeviceAuthorization(
    { ...deps.httpPorts, provider, clock: deps.clock, client },
    { scopes, ...resourceOption(resource), timeoutMs: CONNECT_TIMEOUT_MS },
  ) });
  await deps.devices.put(record.serverId, authorization);
  await setOAuthStatus(deps, record.serverId, "pending");
  const { userCode, verificationUri, verificationUriComplete, expiresAt, intervalSeconds } = authorization;
  return { kind: "device_code", userCode, verificationUri, verificationUriComplete, expiresAt, intervalSeconds };
}

/** Thin site-key codec; Jini owns the expiring redirect payload and all binding checks.
 * Stateless (no pending-store row) because the agent daemon can begin a connect that the web server
 * completes in a different process; a process-local Map cannot join those two legs, and a sealed
 * state needs no shared table. The exact redirect URI is bound into the state and replayed on
 * exchange (RFC 6749 §4.1.3), never rebuilt from a callback Host header. Every open/expiry/binding
 * failure is the same `OAUTH_INVALID_STATE`, so a guessed or tampered state is not an oracle.
 * @complexity O(state bytes), bounded by Jini; one site-key seal/open, no pending-store I/O.
 */
export function sealedRedirectState({ deps, serverId, browserBinding, config }: { deps: SignInDeps; serverId: string; browserBinding?: string | undefined; config: Pick<ExternalMcpServerRecord, "createdAt" | "version"> }, _optional: Record<string, never> = {}) {
  // The HTTP callback always supplies browser proof. Unbound pre-upgrade links cannot decrypt
  // there; persisted grants use their existing vault AAD and remain usable across reconnects.
  const parts = browserBinding === undefined ? [deps.workspaceId, serverId] : [deps.workspaceId, serverId, browserBinding];
  const aad = deps.ports.aad.format({ kind: "oauth-redirect-state", version: "v2", parts: [JSON.stringify([...parts, config.createdAt, config.version])] });
  return deps.ports.flow.createSealedAuthorizationState({ clock: deps.clock, workspaceId: deps.workspaceId, serverId, codec: {
    async seal({ plaintext }, _options = {}) {
      const sealed = await deps.sealer.seal({ plaintext, key: await deps.keyring.activeKey({}), aad });
      return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
    },
    async open({ state }, _options = {}) {
      return deps.sealer.open({ sealed: JSON.parse(Buffer.from(state, "base64url").toString("utf8")) }, { aad });
    },
  } });
}
