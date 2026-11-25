import type { OperatorLocaleDeps } from "../headless/plugin-host.js";
import type { Clock as ClockPort, UUID } from "../../primitives/index.js";
import type { AuthorizeFn } from "../events.js";
import type { KeyringPort, SecretSealerPort } from "../vault.js";
import type { ExternalMcpServerRepoPort } from "../hosted-mcp.js";
import type { ExternalMcpOAuthService } from "./api-connections-hosted-mcp.js";

export interface ExternalMcpToolDeps extends OperatorLocaleDeps {
  /** The current connection's original listing only; null means this source has no verified cache. */
  externalMcpKnownToolNames?: (required: { serverId: string; admissionRevision: string }) => readonly string[] | null;
  externalMcpProbe?: (required: { serverId: string }) => Promise<{ ok: boolean; body: Readonly<Record<string, unknown>> }>;
  workspaceId: UUID;
  authorize: AuthorizeFn;
  clock: ClockPort;
  externalMcpServerRepo: ExternalMcpServerRepoPort;
  siteAssistantSecretSealer: SecretSealerPort;
  siteAssistantSecretKeyring: KeyringPort;
  externalMcpOAuth?: ExternalMcpOAuthService;
  derivedPublicOrigin?: string;
}
