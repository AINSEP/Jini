/**
 * @file MCP transport trust classification and contained reads of installed plugin skills/config.
 * Disk readers compose the lifecycle owner's path-containment guarantee with real file reads.
 * See classifyAgentPluginMcpServerTrust for the local-execution and remote-tool admission boundary.
 *
 * The Agent Plugins v1.0.0 open standard parsed here is distinct from any host's own signed package
 * format; their contracts cannot be unified. Only plugin.json metadata can authorize operator reads;
 * legacy MCP entries still supply auth and sign-in grants. Remote hints may veto read trust but never
 * supply it. Effects are supplied per host context.
 */
import { resolveAgentPluginLifecycleNamespace } from '../core/identity-namespace.js';
import type { AgentPluginMcpConfig, McpServerConfig } from "./manifest.js";
import { parseAgentPluginMcpConfig as parseAgentPluginMcpConfigValue } from "./manifest.js";
import { createPackagePathsModule } from "./package-paths.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import path from "node:path";
import { createSkillFileReader, type SkillFileResult } from "./skill-file-reader.js";



function buildModule(ports: AgentPluginLifecyclePorts) {
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const parseAgentPluginMcpConfig = (value: unknown, pluginManifest?: unknown) => parseAgentPluginMcpConfigValue({ value, extensionNamespace: resolveAgentPluginLifecycleNamespace({ value: pluginManifest, extensionNamespace: ports.extensionNamespace }) }, { pluginManifest, readServerMetadata: ports.readServerMetadata });
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  /**
   * A plugin must not execute arbitrary local code without explicit operator confirmation.
   *
   * - `stdio` declares `command`/`args` — a downloaded marketplace package choosing what process to
   *   spawn on this machine. That is exactly the local-code-execution case an operator must explicitly
   *   confirm before it ever runs; there is no secret-based mitigation for it, because the risk is not
   *   a leaked credential, it is arbitrary execution.
   * - `streamable-http`/`sse` declare a URL the host calls over the network. There is no local
   *   execution, and (per the Agent Plugins grammar) the spec allows no embedded secret the host would
   *   need to protect — an `oauth`-mode connection mints its own token through the host's own RFC
   *   8414/7591 flow, and a `none`-mode connection carries no credential at all. Either way,
   *   `@jini-ai/mcp`'s `federation/trust.ts` R2 default-deny allowlist still gates every individual
   *   remote TOOL independently at connect time — auto-admitting the SERVER here grants nothing beyond
   *   "this connection may be attempted."
   *
   * @returns `"requires-confirmation"` for `stdio` (never auto-run), `"auto-admit"` for a remote transport.
   * @complexity O(1).
   */
  function classifyAgentPluginMcpServerTrust(server: Pick<McpServerConfig, "type">): "auto-admit" | "requires-confirmation" {
    return server.type === "stdio" ? "requires-confirmation" : "auto-admit";
  }

  /**
   * Reads one installed skill's markdown through the same containment guarantee
   * (`package-paths.ts`'s `assertContainedOnDisk`) install uses at extraction time — one
   * implementation of "stay inside the package root," not two.
   *
   * @throws {PackagePathViolation} If `skillPath` resolves outside `packageRoot` (should be
   * unreachable for a `skillPath` sourced from `InstalledAgentPlugin.skills`, which install only ever
   * populates from paths it already walked inside an already-contained tree — defense in depth for a
   * caller that constructs one by hand).
   */
  async function readInstalledSkillMarkdown(packageRoot: string, skillPath: string): Promise<string> {
    const absolute = await assertContainedOnDisk(packageRoot, skillPath);
    return readFile(absolute, "utf8");
  }

  /** One shared progressive-disclosure read; the install's skillPath, never caller file input,
   * selects the skill folder. Unknown/refused files produce a recoverable model-facing note. */
  async function readInstalledSkillFile(
    { packageRoot, skillPath }: { readonly packageRoot: string; readonly skillPath: string },
    options: { readonly file?: string } = {},
  ): Promise<SkillFileResult> {
    try {
      const skillRoot = path.dirname(await assertContainedOnDisk(packageRoot, skillPath));
      return await createSkillFileReader({ skillRoot, filesystem: ports.filesystem }).read({}, options);
    } catch {
      return { text: "", files: [], note: "File request refused: the installed skill folder is missing, unreadable, or outside the package. Valid supporting files: (none)." };
    }
  }

  /**
   * Reads and parses one installed package's `mcp.json` — same containment guarantee as
   * readInstalledSkillMarkdown, applied to a fixed, known-safe filename rather than a caller-supplied
   * `skillPath`. Shared by readInstalledMcpServerIds and readInstalledMcpServers, which each reduce a
   * different projection of the same parse.
   *
   * `mcp.json` is OPTIONAL per the Agent Plugins spec, so a missing file is not an error — it means
   * this package declares no MCP servers, the common case for a skills-only package. A present but
   * unparseable `mcp.json` (bad JSON, wrong `$schema`, malformed `mcpServers`) is ALSO tolerated rather
   * than thrown: both readers back discovery paths whose whole purpose is staying usable even when one
   * installed package is imperfect — the same fail-open posture `listInstalledPlugins` takes for a
   * digest that fails to index at all (skipped, not fatal to every other plugin). Metadata warnings go
   * to the host's `onEvent` sink as `agent-plugin-metadata-warning`; the host decides how to log them.
   *
   * @returns `null` for a missing file, invalid JSON, or a `mcp.json` that fails top-level validation
   * — every one of these collapses to the same "nothing to report" outcome for both callers.
   * @complexity O(s) in the declared server count plus one file read.
   */
  async function readInstalledMcpConfig(packageRoot: string): Promise<AgentPluginMcpConfig | null> {
    let raw: string;
    try {
      const absolute = await assertContainedOnDisk(packageRoot, "mcp.json");
      raw = await readFile(absolute, "utf8");
    } catch {
      return null;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return null;
    }

    // Missing/malformed extensions cannot supply read trust; transport discovery still works.
    let manifest: unknown;
    try {
      const absolute = await assertContainedOnDisk(packageRoot, "plugin.json");
      manifest = JSON.parse(await readFile(absolute, "utf8"));
    } catch {

    }
    const result = parseAgentPluginMcpConfig(parsedJson, manifest);
    if (result.ok) for (const message of result.warnings ?? []) ports.onEvent?.({ event: 'agent-plugin-metadata-warning', message });
    return result.ok ? result.config : null;
  }

  /** The server ids declared in one installed package's `mcp.json`, regardless of whether each one's
   * own transport shape validated. Kept separate for callers that only need ids and should not pay for
   * (or receive) transport configuration — the ids-only/full-config split between listing a server
   * and launching one. @complexity See readInstalledMcpConfig. */
  async function readInstalledMcpServerIds(packageRoot: string): Promise<readonly string[]> {
    const config = await readInstalledMcpConfig(packageRoot);
    return config?.serverIds ?? [];
  }

  /** The full, validated transport configuration of every server whose shape validated — needed by
   * any caller that must actually LAUNCH a server (trust classification, federation wiring). A server
   * present in readInstalledMcpServerIds but absent here declared an unrecognized `type` or lacked a
   * required field — fail-open per `manifest.ts`'s own contract. `{}` under every condition
   * readInstalledMcpConfig tolerates. @complexity See readInstalledMcpConfig. */
  async function readInstalledMcpServers(packageRoot: string): Promise<Readonly<Record<string, McpServerConfig>>> {
    const config = await readInstalledMcpConfig(packageRoot);
    return config?.servers ?? {};
  }

  return { classifyAgentPluginMcpServerTrust, readInstalledSkillMarkdown, readInstalledSkillFile, readInstalledMcpServerIds, readInstalledMcpServers };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createCapabilityProjectionModule(ports: AgentPluginLifecyclePorts, _optional: Record<string, never> = {}) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
