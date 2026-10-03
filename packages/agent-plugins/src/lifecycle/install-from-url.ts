
import { fetchAgentPluginArchive, type FetchAgentPluginArchiveOptional } from "./fetch-archive.js";
import { createInstallModule, type AgentPluginArchiveReaderPort, type InstalledAgentPlugin } from "./install.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { AgentPluginLayout } from "./layout.js";

export type AgentPluginIntegrity =
  | {
      readonly kind: "pinned";

      readonly sha256: string;
    }
  | { readonly kind: "trust-on-first-use" };

export interface InstallAgentPluginFromUrlRequired {
  readonly url: string;
  readonly integrity: AgentPluginIntegrity;

  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly archiveReader: AgentPluginArchiveReaderPort;
}

export interface InstallAgentPluginFromUrlOptional {

  readonly fetch?: (FetchAgentPluginArchiveOptional) | undefined;
}

export interface InstalledAgentPluginFromUrl {
  readonly installed: InstalledAgentPlugin;

  readonly resolvedUrl: string;

  readonly sha256: string;

  readonly digestWasPinned: boolean;
}

export function createInstallFromUrlModule(ports: AgentPluginLifecyclePorts) {
const { installAgentPlugin } = createInstallModule(ports);
async function installAgentPluginFromUrl(
  required: InstallAgentPluginFromUrlRequired,
  optional: InstallAgentPluginFromUrlOptional = {},
): Promise<InstalledAgentPluginFromUrl> {
  const { archive, sha256, resolvedUrl } = await fetchAgentPluginArchive({ url: required.url, fetch: ports.fetch, outboundGuard: ports.outboundGuard }, optional.fetch);

  const expectedSha256 = required.integrity.kind === "pinned" ? required.integrity.sha256 : sha256;

  const installed = await installAgentPlugin({
    archive,
    expectedSha256,
    archiveReader: required.archiveReader,
    layout: required.layout,
    workspaceId: required.workspaceId,
  });

  return { installed, resolvedUrl, sha256, digestWasPinned: required.integrity.kind === "pinned" };
}

return { installAgentPluginFromUrl };
}
