/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export const BUNDLED_DIGESTS_FILENAME = "bundled-digests.json";

export type BundledAgentPluginDigests = ReadonlyMap<string, string>;

export interface SeededBundledAgentPluginDigest {
  readonly pluginId: string;
  readonly archiveDigest: string;
}

export interface InstalledDigestIdentity {
  readonly pluginId: string;
  readonly archiveDigest: string;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const open = ports.filesystem.open.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const randomUUID = () => ports.ids.newId();
  const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

  const SAFE_PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

  const EMPTY_LEDGER: BundledAgentPluginDigests = new Map();

  async function readBundledAgentPluginDigests(workspaceRoot: string): Promise<BundledAgentPluginDigests> {
    let raw: string;
    try {
      raw = await readFile(path.join(workspaceRoot, BUNDLED_DIGESTS_FILENAME), "utf8");
    } catch {
      return EMPTY_LEDGER;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return EMPTY_LEDGER;
    }

    return normalizeBundledDigests(parsed);
  }

  function normalizeBundledDigests(value: unknown): BundledAgentPluginDigests {
    if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.plugins)) return EMPTY_LEDGER;

    const digests = new Map<string, string>();
    for (const [pluginId, entry] of Object.entries(value.plugins)) {
      if (!SAFE_PLUGIN_ID_PATTERN.test(pluginId)) continue;
      if (!isPlainObject(entry)) continue;
      const { archiveDigest } = entry;
      if (typeof archiveDigest !== "string" || !SHA256_DIGEST_PATTERN.test(archiveDigest)) continue;
      digests.set(pluginId, archiveDigest);
    }
    return digests;
  }

  async function recordBundledAgentPluginDigests(required: {
    readonly workspaceRoot: string;
    readonly seeded: readonly SeededBundledAgentPluginDigest[];
    readonly now?: ((required: Record<string, never>) => Date) | undefined;
  }): Promise<void> {
    if (required.seeded.length === 0) return;

    const existing = await readBundledAgentPluginDigests(required.workspaceRoot);
    const merged = new Map(existing);
    const seededAt = (required.now?.({}) ?? new Date(ports.clock.nowMs())).toISOString();

    for (const [pluginId, archiveDigest] of resolveThisBootsDigests(required.seeded)) {
      if (archiveDigest === undefined) merged.delete(pluginId);
      else merged.set(pluginId, archiveDigest);
    }

    const plugins = Object.fromEntries([...merged].map(([pluginId, archiveDigest]) => [pluginId, { archiveDigest, seededAt }]));
    await writeLedgerAtomically(required.workspaceRoot, plugins);
  }

  function resolveThisBootsDigests(
    seeded: readonly SeededBundledAgentPluginDigest[],
  ): ReadonlyMap<string, string | undefined> {
    const thisBoot = new Map<string, string | undefined>();
    for (const { pluginId, archiveDigest } of seeded) {
      if (!SAFE_PLUGIN_ID_PATTERN.test(pluginId) || !SHA256_DIGEST_PATTERN.test(archiveDigest)) continue;
      if (thisBoot.has(pluginId) && thisBoot.get(pluginId) !== archiveDigest) thisBoot.set(pluginId, undefined);
      else thisBoot.set(pluginId, archiveDigest);
    }
    return thisBoot;
  }

  async function removeBundledAgentPluginDigest(required: {
    readonly workspaceRoot: string;
    readonly pluginId: string;
  }): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(required.workspaceRoot, BUNDLED_DIGESTS_FILENAME), "utf8"));
    } catch {
      return false;
    }
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1 || !isPlainObject(parsed.plugins)) return false;
    if (!Object.hasOwn(parsed.plugins, required.pluginId)) return false;

    const remaining: Record<string, unknown> = { ...parsed.plugins };
    delete remaining[required.pluginId];
    await writeLedgerAtomically(required.workspaceRoot, remaining);
    return true;
  }

  async function writeLedgerAtomically(workspaceRoot: string, plugins: Readonly<Record<string, unknown>>): Promise<void> {
    const finalPath = path.join(workspaceRoot, BUNDLED_DIGESTS_FILENAME);
    const tempPath = `${finalPath}.tmp-${ports.process.pid}-${randomUUID()}`;
    try {
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, plugins }, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  function preferBundledAgentPluginDigests<T extends InstalledDigestIdentity>(
    installed: readonly T[],
    bundled: BundledAgentPluginDigests,
  ): readonly T[] {
    if (bundled.size === 0) return installed;

    const supersededIds = idsNarrowableToTheirBundledDigest(installed, bundled);
    if (supersededIds.size === 0) return installed;

    return installed.filter((plugin) => !supersededIds.has(plugin.pluginId) || plugin.archiveDigest === bundled.get(plugin.pluginId));
  }

  function idsNarrowableToTheirBundledDigest(
    installed: readonly InstalledDigestIdentity[],
    bundled: BundledAgentPluginDigests,
  ): ReadonlySet<string> {
    const digestsByPluginId = new Map<string, Set<string>>();
    for (const plugin of installed) {
      const digests = digestsByPluginId.get(plugin.pluginId) ?? new Set<string>();
      digests.add(plugin.archiveDigest);
      digestsByPluginId.set(plugin.pluginId, digests);
    }

    const narrowable = new Set<string>();
    for (const [pluginId, digests] of digestsByPluginId) {
      if (digests.size < 2) continue;
      const bundledDigest = bundled.get(pluginId);
      if (bundledDigest !== undefined && digests.has(bundledDigest)) narrowable.add(pluginId);
    }
    return narrowable;
  }

  function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  return { readBundledAgentPluginDigests, normalizeBundledDigests, recordBundledAgentPluginDigests, removeBundledAgentPluginDigest, preferBundledAgentPluginDigests };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createBundledDigestsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
