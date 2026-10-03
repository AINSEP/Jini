/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type { AgentPluginMcpConfig, McpServerConfig } from "./manifest.js";
import { parseAgentPluginMcpConfig as parseAgentPluginMcpConfigValue } from "./manifest.js";
import { createPackagePathsModule } from "./package-paths.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";



function buildModule(ports: AgentPluginLifecyclePorts) {
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const parseAgentPluginMcpConfig = (value: unknown, pluginManifest?: unknown) => parseAgentPluginMcpConfigValue({ value, extensionNamespace: ports.extensionNamespace }, { pluginManifest, readServerMetadata: ports.readServerMetadata });
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  function classifyAgentPluginMcpServerTrust(server: Pick<McpServerConfig, "type">): "auto-admit" | "requires-confirmation" {
    return server.type === "stdio" ? "requires-confirmation" : "auto-admit";
  }

  async function readInstalledSkillMarkdown(packageRoot: string, skillPath: string): Promise<string> {
    const absolute = await assertContainedOnDisk(packageRoot, skillPath);
    return readFile(absolute, "utf8");
  }

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

    let manifest: unknown;
    try {
      const absolute = await assertContainedOnDisk(packageRoot, "plugin.json");
      manifest = JSON.parse(await readFile(absolute, "utf8"));
    } catch {

    }
    const result = parseAgentPluginMcpConfig(parsedJson, manifest);
    return result.ok ? result.config : null;
  }

  async function readInstalledMcpServerIds(packageRoot: string): Promise<readonly string[]> {
    const config = await readInstalledMcpConfig(packageRoot);
    return config?.serverIds ?? [];
  }

  async function readInstalledMcpServers(packageRoot: string): Promise<Readonly<Record<string, McpServerConfig>>> {
    const config = await readInstalledMcpConfig(packageRoot);
    return config?.servers ?? {};
  }

  return { classifyAgentPluginMcpServerTrust, readInstalledSkillMarkdown, readInstalledMcpServerIds, readInstalledMcpServers };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createCapabilityProjectionModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
