/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import { type AgentPluginActivationVerdict } from "./activation.js";
import { createActivationModule } from "./activation.js";
import { type BundledAgentPluginDigests } from "./bundled-digests.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import type { AgentPluginDeliveryMode, InstalledAgentPlugin } from "./types.js";
import { createInstallModule } from "./install.js";
import { createCapabilityProjectionModule } from "./capability-projection.js";
import type { AgentPluginWorkspaceLayout } from "./layout.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export type { AgentPluginDeliveryMode } from "./types.js";

export type ResolveAgentPluginRefsResult =
  | { readonly ok: true; readonly promptPrefix: string }
  | { readonly ok: false; readonly reason: string };

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { resolveAgentPluginActivation } = createActivationModule(ports);
  const { preferBundledAgentPluginDigests, readBundledAgentPluginDigests } = createBundledDigestsModule(ports);
  const { indexInstalledRoot } = createInstallModule(ports);
  const { readInstalledSkillMarkdown } = createCapabilityProjectionModule(ports);
  const SHA256_DIGEST_DIRNAME_PATTERN = /^[a-f0-9]{64}$/;


  function resolveAgentPluginDeliveryMode(): AgentPluginDeliveryMode { return ports.deliveryMode; }

  async function resolveAgentPluginRefs(
    pluginRefIds: readonly string[],
    workspaceLayout: Pick<AgentPluginWorkspaceLayout, "packages" | "root">,
    deliveryMode: AgentPluginDeliveryMode = resolveAgentPluginDeliveryMode(),
  ): Promise<ResolveAgentPluginRefsResult> {
    if (pluginRefIds.length === 0) return { ok: true, promptPrefix: "" };

    const bundledDigests = await readBundledAgentPluginDigests(workspaceLayout.root);

    const sections: string[] = [];
    for (const pluginRefId of pluginRefIds) {

      const refusal = activationRefusal(pluginRefId, await resolveAgentPluginActivation(workspaceLayout.root, pluginRefId));
      if (refusal !== undefined) return { ok: false, reason: refusal };

      const resolved = await resolveOnePluginRef(pluginRefId, workspaceLayout.packages, deliveryMode, bundledDigests);
      if (!resolved.ok) return resolved;
      sections.push(resolved.section);
    }
    return { ok: true, promptPrefix: sections.join("\n\n") };
  }

  function activationRefusal(pluginRefId: string, verdict: AgentPluginActivationVerdict): string | undefined {
    if (verdict.verdict === "active") return undefined;
    if (verdict.verdict === "undetermined") {
      return (
        `Agent Plugin '${pluginRefId}' was not loaded: this workspace's activation record could not be read, so whether ` +
        `it is enabled cannot be confirmed (${verdict.reason}). Nothing was injected; repair activations.json and start the run again.`
      );
    }

    return (
      `Agent Plugin '${pluginRefId}' is installed in this workspace but is not enabled — it ships with ${ports.productName} and ` +
      "stays inactive until an operator turns it on. Enable it before pinning it to a run."
    );
  }

  async function listInstalledPlugins(packagesDir: string): Promise<readonly InstalledAgentPlugin[]> {
    let entries: string[];
    try {
      entries = await readdir(packagesDir);
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }

    const installed: InstalledAgentPlugin[] = [];
    for (const digest of entries) {
      if (!SHA256_DIGEST_DIRNAME_PATTERN.test(digest)) continue;
      try {
        installed.push(await indexInstalledRoot(path.join(packagesDir, digest), digest));
      } catch {

      }
    }
    return installed;
  }

  async function isInstalledDigestPresent(packagesDir: string, archiveDigest: string): Promise<boolean> {
    if (!SHA256_DIGEST_DIRNAME_PATTERN.test(archiveDigest)) return false;
    try {
      return (await stat(path.join(packagesDir, archiveDigest))).isDirectory();
    } catch {
      return false;
    }
  }

  function isEnoent(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
  }

  async function resolveOnePluginRef(
    pluginRefId: string,
    packagesDir: string,
    deliveryMode: AgentPluginDeliveryMode,
    bundledDigests: BundledAgentPluginDigests,
  ): Promise<{ readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string }> {

    const installed = preferBundledAgentPluginDigests(await listInstalledPlugins(packagesDir), bundledDigests);
    const matches = installed.filter((plugin) => plugin.pluginId === pluginRefId);

    if (matches.length === 0) {
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' is not installed in this workspace — pinned by the composer but not found under any installed package`,
      };
    }
    if (matches.length > 1) {
      const digests = matches.map((plugin) => plugin.archiveDigest).sort();
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' matches ${matches.length} installed packages (digests: ${digests.join(", ")}) — refusing to guess which one to use`,
      };
    }

    const plugin = matches[0] as InstalledAgentPlugin;
    const skillPath = `skills/${pluginRefId}/SKILL.md`;

    if (deliveryMode === "pointer") return buildPointerSection(pluginRefId, plugin);

    let skillMarkdown: string;
    try {
      skillMarkdown = await readInstalledSkillMarkdown(plugin.packageRoot, skillPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' has no readable '${skillPath}' in its installed package: ${message}`,
      };
    }

    const otherFiles = plugin.files
      .filter((file) => file !== skillPath)
      .map((file) => path.join(plugin.packageRoot, file));

    const inventory = otherFiles.length > 0
      ? `\n\nThe SKILL.md above is this Agent Plugin's own instructions — follow them, including any files it directs you to load before starting work. Every other file in the installed package is listed below by absolute path and is readable now:\n${otherFiles.map((file) => `- ${file}`).join("\n")}`
      : "";

    return {
      ok: true,
      section: `<<AGENT_PLUGIN pluginId="${pluginRefId}">>\n${skillMarkdown}${inventory}\n<</AGENT_PLUGIN>>`,
    };
  }

  function buildPointerSection(
    pluginRefId: string,
    plugin: InstalledAgentPlugin,
  ): { readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string } {

    if (!plugin.skills.some((skill) => skill.name === pluginRefId)) {
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' has no readable 'skills/${pluginRefId}/SKILL.md' in its installed package: no such skill folder`,
      };
    }

    const body = ports.formatPluginToolPointer({ pluginId: pluginRefId });

    return { ok: true, section: `<<AGENT_PLUGIN pluginId="${pluginRefId}">>\n${body}\n<</AGENT_PLUGIN>>` };
  }

  return { resolveAgentPluginRefs, listInstalledPlugins, isInstalledDigestPresent };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createResolveAgentPluginRefsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
