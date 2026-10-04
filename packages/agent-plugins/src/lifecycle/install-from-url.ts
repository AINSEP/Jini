/**
 * Historical lifecycle rationale, carried with the implementation during consumer adoption.
 *
 * Host command-line rationale retained when the unused URL-install CLI was removed:
 * - A digest-only preview downloads and reports SHA-256 without installing. Hashing those bytes
 *   does not establish provenance; the host must make that distinction visible to the operator.
 * - A real install requires exactly one explicit integrity decision: an independent pinned digest
 *   or trust-on-first-use. Missing or conflicting choices must be refused before execution, with
 *   diagnostics naming the choice the operator needs to supply.
 * - Keep pure token classification separate from argument validation and exit/reporting effects,
 *   so both parsing and legal combinations are directly testable without a network or process exit.
 * - The CLI composes shared download/extraction operations; digest verification, expansion bounds,
 *   path containment and tenant isolation belong in those operations rather than a CLI-only guard.
 * @file The one composition step that turns "here is an address" into "the plugin is on this
 * machine": {@link fetchAgentPluginArchive} -> `installAgentPlugin`.
 *
 * This is the caller `install.ts` was written for and never had. It adds no extraction, path, or
 * manifest logic of its own — every one of those guarantees still comes from `install.ts`, reached
 * with bytes instead of a URL.
 *
 * ---------------------------------------------------------------------------
 * Why integrity is a tagged union and not an optional string
 * ---------------------------------------------------------------------------
 * `installAgentPlugin` requires `expectedSha256` and refuses to extract unverified bytes. That is
 * its central security property. A download flow has an obvious temptation: hash whatever arrived
 * and pass that in — which type-checks, always "passes", and silently converts digest verification
 * into a no-op.
 *
 * So the choice is made explicit and greppable instead of implied by an absent argument:
 * `{ kind: "pinned", sha256 }` verifies against a digest the caller obtained out-of-band (a
 * registry's own metadata, a release note, a prior `--print-digest` run), and
 * `{ kind: "trust-on-first-use" }` states in the call site itself that this install trusts the
 * transport and the host, nothing more. Both reach the identical `installAgentPlugin` call; the
 * difference is entirely in whether the digest came from somewhere other than the bytes.
 */

import { fetchAgentPluginArchive, type FetchAgentPluginArchiveOptional } from "./fetch-archive.js";
import { createInstallModule, type AgentPluginArchiveReaderPort, type InstalledAgentPlugin } from "./install.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { AgentPluginLayout } from "./layout.js";

/**
 * See this module's header for why this is a union rather than an optional `expectedSha256`.
 */
export type AgentPluginIntegrity =
  | {
      readonly kind: "pinned";

      readonly sha256: string;
    }
  | { readonly kind: "trust-on-first-use" };

/**
 * Lowercase hex SHA-256 obtained OUT-OF-BAND — never computed from the downloaded bytes.
 */
export interface InstallAgentPluginFromUrlRequired {
  readonly url: string;
  readonly integrity: AgentPluginIntegrity;

  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly archiveReader: AgentPluginArchiveReaderPort;
}

/**
 * The instance-level layout. Passed straight through to `installAgentPlugin`, which is the only
 * thing that may call `forWorkspace` — see its own SECURITY note.
 */
export interface InstallAgentPluginFromUrlOptional {

  readonly fetch?: (FetchAgentPluginArchiveOptional) | undefined;
}

/**
 * Defaults to {@link yauzlAgentPluginArchiveReader} — the only real reader in the tree.
 */
export interface InstalledAgentPluginFromUrl {
  readonly installed: InstalledAgentPlugin;

  readonly resolvedUrl: string;

  readonly sha256: string;

  readonly digestWasPinned: boolean;
}

export function createInstallFromUrlModule(ports: AgentPluginLifecyclePorts) {
const { installAgentPlugin } = createInstallModule(ports);
/**
 * The URL the bytes actually came from, after redirects.
 *
 * Echoed so a `trust-on-first-use` caller can print the digest to pin on the next install.
 *
 * True when the digest was supplied out-of-band and verified, false for trust-on-first-use.
 * Callers surface this so an unpinned install is never mistaken for a verified one.
 *
 * Downloads a plugin archive and installs it into this workspace's own on-disk package store.
 *
 * @throws {AgentPluginFetchError} For a download failure — bad URL, HTTP error, oversized body.
 * @throws {AgentPluginInstallError} For everything after the bytes arrive — digest mismatch,
 * hostile archive, invalid manifest. Both are thrown unchanged, so a caller can branch on `code`.
 * @complexity O(b) in archive bytes; extraction cost is bounded by `install.ts`'s own `LIMITS`.
 *
 * For "pinned", this is the caller's out-of-band digest and `installAgentPlugin` genuinely
 * verifies it. For "trust-on-first-use", it is the digest of the download itself, so that check
 * is a tautology — which is exactly what the union's name says out loud at the call site.
 */
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
