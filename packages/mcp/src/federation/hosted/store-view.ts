import { externalMcpRecordHasStaticAccessToken, resolveExternalMcpAuthMode, resolveExternalMcpOAuthStatus } from "./auth.js";
import { parseExternalMcpJsonArray } from "./access.js";
import { openExternalMcpEnv, openExternalMcpOAuthPayload } from "./vault.js";
import type { ExternalMcpServerRecord, ExternalMcpServerView, ExternalMcpStoreDeps } from "@jini-ai/core/contracts/hosted-mcp";
import type { UUID } from "@jini-ai/core/primitives";
import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";
import type { HostedMcpStorePorts, HostedMcpTokenHint } from "./store-ports.js";

/**
 * Whether this row holds an access TOKEN — answered from PLAINTEXT columns alone, never by unsealing.
 *
 * Token clearing preserves the client secret sharing the sealed blob (setOAuthStatus). A
 * disconnected row can therefore have a non-null blob containing a secret but no access token;
 * blob presence alone cannot answer this question.
 *
 * Not repaired by unsealing, deliberately. This is read by a plain list route that must answer
 * without a keyring round trip, and must keep answering TRUTHFULLY for a row whose blob will not
 * open at all: a rotated site key, or a legacy `aad_version 0` ciphertext. A decrypt here would turn
 * either into a failed settings tab, and would put a keyring dependency on a read path that has
 * never had one.
 *
 * The blob check leads because it is the NECESSARY condition — no blob, no token, whatever the
 * plaintext says. Each of the two disjuncts after it is independently SUFFICIENT, which is what
 * makes a false positive unreachable:
 *
 * - `connected` is written by exactly one place, `persistTokens`, and that same upsert writes the
 *   tokens. Every path that clears a token moves the row off `connected` in the same write.
 * - `oauthExpiresAt` is written beside the tokens by that same `persistTokens`, and nulled by every
 *   clear (`setOAuthStatus`'s `clearToken` branch) and by every save that invalidates the token
 *   ({@link carryOAuthRuntimeState}), so a non-null expiry cannot outlive the token it describes.
 *
 * @returns `true` only when a token is stored. The single state it can UNDER-report is a token
 * issued with no `expires_in` — RFC 6749 §5.1 makes it optional and the OAuth token endpoint stores `null` rather than fabricating one — on a row that has since moved off `connected`
 * without its token being cleared: a re-connect left `pending`, or a terminal device-poll failure.
 * Under-reporting is the safe direction, and closing it exactly needs a plaintext token-presence
 * column, which is a schema change rather than a read fix.
 * @complexity O(1) — three field reads, no I/O.
 */
export function externalMcpRecordHasStoredToken(
  record: Pick<ExternalMcpServerRecord, "sealedOAuth" | "oauthStatus" | "oauthExpiresAt">,
): boolean {
  if (record.sealedOAuth === null) return false;
  return resolveExternalMcpOAuthStatus(record) === "connected" || record.oauthExpiresAt !== null;
}

async function externalMcpEnvHints({ record, sealer, ports }: { record: ExternalMcpServerRecord; sealer?: SecretSealerPort | undefined; ports: HostedMcpStorePorts }, _options = {}) {
  const envTokenHints: Record<string, HostedMcpTokenHint> = {};
  if (!sealer || !record.sealedEnv) return envTokenHints;
  const opened = await openExternalMcpEnv(record, { ...ports, sealer });
  if (!opened.ok) return envTokenHints;
  for (const [name, value] of Object.entries(opened.env)) {
    if (typeof value === 'string') envTokenHints[name] = ports.credential.hint({ token: value });
  }
  return envTokenHints;
}

async function externalMcpAccessTokenHint({ record, sealer, ports }: { record: ExternalMcpServerRecord; sealer?: SecretSealerPort | undefined; ports: HostedMcpStorePorts }, _options = {}) {
  let accessTokenHint: HostedMcpTokenHint | null = null;
  if (sealer && record.sealedOAuth) {
    try {
      const payload = await openExternalMcpOAuthPayload({ ...ports, sealer }, record);
      const token = payload.staticAccessToken ?? payload.tokens?.accessToken;
      if (token) accessTokenHint = ports.credential.hint({ token });
    } catch { /* A rotated site key must not prevent listing non-secret metadata. */ }
  }
  return accessTokenHint;
}

export async function toView(record: ExternalMcpServerRecord, ports: HostedMcpStorePorts, sealer?: SecretSealerPort): Promise<ExternalMcpServerView<HostedMcpTokenHint>> {
  const envTokenHints = await externalMcpEnvHints({ record, sealer, ports });
  const accessTokenHint = await externalMcpAccessTokenHint({ record, sealer, ports });
  return {
    serverId: record.serverId,
    label: record.label ?? record.serverId,
    provisionedByPluginId: record.provisionedByPluginId,
    transport: record.transport,
    authMode: resolveExternalMcpAuthMode(record),
    enabled: record.enabled,
    command: record.command ?? "",
    url: record.url,
    args: parseExternalMcpJsonArray({ raw: record.args }),
    allowedToolNames: parseExternalMcpJsonArray({ raw: record.allowedToolNames }),
    writeAllowedToolNames: parseExternalMcpJsonArray({ raw: record.writeAllowedToolNames }),
    writeGrantsUpdatedByPrincipalId: record.writeGrantsUpdatedByPrincipalId,
    writeGrantsUpdatedAt: record.writeGrantsUpdatedAt,
    envNames: parseExternalMcpJsonArray({ raw: record.envNames }),
    hasAccessToken: externalMcpRecordHasStaticAccessToken(record),
    accessTokenHint,
    ...(Object.keys(envTokenHints).length ? { envTokenHints } : {}),
    accessTokenEnvName: resolveExternalMcpAuthMode(record) === "static_env" ? record.oauthTokenEnvName : null,
    oauth: {
      providerId: record.oauthProviderId,
      grant: record.oauthGrant,
      clientId: record.oauthClientId,
      scopes: parseExternalMcpJsonArray({ raw: record.oauthScopesJson }),
      status: resolveExternalMcpOAuthStatus(record),
      expiresAt: record.oauthExpiresAt,
      tokenEnvName: record.oauthTokenEnvName,
      hasStoredToken: externalMcpRecordHasStoredToken(record),
    },
    version: record.version,
  };
}

/**
 * Lists the workspace's servers for the admin tab. The tab has no use for env
 * values and must not be a route that decrypts them. Token hints alone are now derived by
 * server-side unsealing, per the owner decision; no secret value is returned.
 *
 * @complexity O(n) in the stored server count.
 * @overallScore 100
 */
export async function listExternalMcpServerViews(
  { deps, workspaceId }: { deps: Pick<ExternalMcpStoreDeps, "repo"> & Partial<Pick<ExternalMcpStoreDeps, "sealer">> & HostedMcpStorePorts; workspaceId: UUID },
  _optional: Record<string, never> = {},
): Promise<ExternalMcpServerView<HostedMcpTokenHint>[]> {
  const records = await deps.repo.listByWorkspaceId(workspaceId);
  return Promise.all(records.map(record => toView(record, deps, deps.sealer)));
}
