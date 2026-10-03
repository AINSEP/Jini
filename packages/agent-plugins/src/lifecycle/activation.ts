/** Extracted from the host plugin lifecycle. Effects are supplied per host context.
 * Kernel exclusive create chooses one writer. The shared platform lock binds ownership to
 * a unique token and inode/device, verifies unchanged bytes/mtime before stale removal, and
 * never treats a permission failure as proof of a dead pid. No heartbeat extends the explicit
 * 10-second stale budget; a longer live operation can lose authority and must check assertHeld
 * before publication. The shared fixed polling/wall-clock budget replaces local jitter/monotonic
 * acquisition; activation keeps its 15-second timeout and translates shared errors into busy.
 */
import path from "node:path";
import { FileLockLostError, FileLockTimeoutError, type FileLockHolder, type HeldFileLock } from "@jini-ai/platform/fs/file-lock";
import { withFileLock } from "@jini-ai/platform/fs/file-lock";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export const ACTIVATIONS_FILENAME = "activations.json";

export const ACTIVATIONS_LOCK_FILENAME = `${ACTIVATIONS_FILENAME}.lock`;

export type AgentPluginOrigin = "bundled" | "operator-installed";

export interface AgentPluginActivationRecord {
  readonly enabled: boolean;
  readonly origin: AgentPluginOrigin;
  readonly updatedAt: string;

  readonly updatedBy: string;
}

export interface AgentPluginActivations {
  readonly schemaVersion: 1;
  readonly plugins: Readonly<Record<string, AgentPluginActivationRecord>>;
}

export class AgentPluginActivationsUnreadableError extends Error {
  readonly filePath: string;
  readonly reason: string;
  constructor({ filePath, reason }: { readonly filePath: string; readonly reason: string }) {
    super(
      `agent-plugin activation: ${reason} (${filePath}). The file was left untouched and nothing was written, so no ` +
        "recorded enable/disable decision was lost. Until it is repaired, this workspace's Agent Plugin tool calls " +
        "and plugin-pinned runs are refused, and no Agent Plugin can be enabled, disabled, seeded or uninstalled. " +
        "To recover, fix the JSON by hand; or stop the host, move the file aside and start the host again — bundled plugins " +
        "are then recorded as disabled again, but every operator-installed plugin you had disabled starts enabled " +
        "and must be disabled again.",
    );
    this.filePath = filePath;
    this.reason = reason;
    this.name = "AgentPluginActivationsUnreadableError";
  }
}

export class AgentPluginActivationsBusyError extends Error {
  readonly lockPath: string;
  readonly holder: FileLockHolder | undefined;
  readonly lost: boolean;
  constructor({ lockPath, holder, lost }: { readonly lockPath: string; readonly holder: FileLockHolder | undefined; readonly lost: boolean }) {
    super(
      (lost
        ? `agent-plugin activation: lost the write lock (${lockPath}) before committing — another process judged it stale`
        : `agent-plugin activation: could not take the write lock (${lockPath}) within 15s` +
          (holder !== undefined ? ` — held by pid ${holder.pid} on ${holder.hostname} since ${holder.acquiredAt}` : " — holder unknown")) +
        ". Nothing was written, so no recorded enable/disable decision was changed. This clears by itself when the other " +
        "host process (server, agent daemon, or the agent-plugin:activation CLI) finishes; a lock left by a crashed " +
        "process is removed automatically once that process is gone or the lock is older than 10s. If it persists, stop " +
        `every host process for this workspace and delete ${lockPath}.`,
    );
    this.lockPath = lockPath;
    this.holder = holder;
    this.lost = lost;
    this.name = "AgentPluginActivationsBusyError";
  }
}

export type AgentPluginActivationVerdict =
  | { readonly verdict: "active" }
  | { readonly verdict: "inactive" }
  | { readonly verdict: "undetermined"; readonly reason: string };

export interface SetAgentPluginActivationRequired {
  readonly workspaceRoot: string;
  readonly pluginId: string;
  readonly enabled: boolean;

  readonly actor: string;
}

export interface SetAgentPluginActivationOptional {
  readonly origin?: (AgentPluginOrigin) | undefined;
  readonly now?: ((required: Record<string, never>) => Date) | undefined;
}

export type BundledAgentPluginEnableOutcome = "enabled" | "already-enabled" | "left-disabled-by-operator";

export interface DeleteAgentPluginActivationRequired {
  readonly workspaceRoot: string;
  readonly pluginId: string;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const randomUUID = () => ports.ids.newId();
  const mkdir = ports.filesystem.mkdir.bind(ports.filesystem);
  const open = ports.filesystem.open.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const EMPTY_ACTIVATIONS: AgentPluginActivations = { schemaVersion: 1, plugins: {} };

  const SAFE_PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

  function isAgentPluginActive(activations: AgentPluginActivations, pluginId: string): boolean {

    if (!Object.hasOwn(activations.plugins, pluginId)) return true;
    return activations.plugins[pluginId]!.enabled;
  }

  function filterActiveAgentPlugins<T>(
    activations: AgentPluginActivations,
    items: readonly T[],
    pluginIdOf: (item: T) => string,
  ): readonly T[] {
    return items.filter((item) => isAgentPluginActive(activations, pluginIdOf(item)));
  }

  async function readAgentPluginActivations(workspaceRoot: string): Promise<AgentPluginActivations> {
    const document = await readActivationsDocument(workspaceRoot);
    return document.kind === "entries" ? normalizePluginsBag(document.entries) : EMPTY_ACTIVATIONS;
  }

  type ActivationsDocument =
    | { readonly kind: "absent" }
    | { readonly kind: "entries"; readonly entries: Readonly<Record<string, unknown>> }
    | { readonly kind: "unreadable"; readonly reason: string };

  async function readActivationsDocument(workspaceRoot: string): Promise<ActivationsDocument> {
    let raw: string;
    try {
      raw = await readFile(path.join(workspaceRoot, ACTIVATIONS_FILENAME), "utf8");
    } catch (error) {

      if (errorCode(error) === "ENOENT") return { kind: "absent" };
      return { kind: "unreadable", reason: `${ACTIVATIONS_FILENAME} could not be read (${describeError(error)})` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { kind: "unreadable", reason: `${ACTIVATIONS_FILENAME} is not valid JSON (${describeError(error)})` };
    }

    const entries = extractPluginsBag(parsed);
    if (entries === undefined) {
      return { kind: "unreadable", reason: `${ACTIVATIONS_FILENAME} is not a schemaVersion 1 activations document` };
    }
    return { kind: "entries", entries };
  }

  function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function toActivationsBusyError(lockPath: string, error: unknown): unknown {
    if (error instanceof FileLockTimeoutError) return new AgentPluginActivationsBusyError({ lockPath: lockPath, holder: error.holder, lost: false });
    if (error instanceof FileLockLostError) return new AgentPluginActivationsBusyError({ lockPath: lockPath, holder: undefined, lost: true });
    return error;
  }

  function warnStaleActivationsLockRemoved(lockPath: string, holder: FileLockHolder | undefined): void {
    ports.onEvent?.({ event: "stale-activation-lock-removed", message: (
      holder !== undefined
        ? `[agent-plugins] removed a stale activations.json lock left by pid ${holder.pid} on ${holder.hostname} (acquired ${holder.acquiredAt}): ${lockPath}`
        : `[agent-plugins] removed a stale activations.json lock with an unreadable holder: ${lockPath}`
    ) });
  }

  type RawPluginsBag = Readonly<Record<string, unknown>>;

  async function readPluginsBagStrict(workspaceRoot: string): Promise<RawPluginsBag> {
    const document = await readActivationsDocument(workspaceRoot);
    if (document.kind === "unreadable") {
      throw new AgentPluginActivationsUnreadableError({ filePath: path.join(workspaceRoot, ACTIVATIONS_FILENAME), reason: document.reason });
    }
    return document.kind === "entries" ? document.entries : {};
  }

  function isRecordedAsBundled(bag: RawPluginsBag, pluginId: string): boolean {
    if (!Object.hasOwn(bag, pluginId)) return false;
    const entry = bag[pluginId];
    return isPlainObject(entry) && entry.origin === "bundled";
  }

  async function assertAgentPluginActivationsWritable(workspaceRoot: string): Promise<void> {
    await lockedActivationsWrite(workspaceRoot, () => readPluginsBagStrict(workspaceRoot));
  }

  async function isAgentPluginRecordedAsBundled(workspaceRoot: string, pluginId: string): Promise<boolean> {
    return isRecordedAsBundled(await readPluginsBagStrict(workspaceRoot), pluginId);
  }

  async function resolveAgentPluginActivation(workspaceRoot: string, pluginId: string): Promise<AgentPluginActivationVerdict> {
    const document = await readActivationsDocument(workspaceRoot);
    if (document.kind === "unreadable") return { verdict: "undetermined", reason: document.reason };
    if (document.kind === "absent") return { verdict: "active" };

    if (!Object.hasOwn(document.entries, pluginId)) return { verdict: "active" };

    const record = normalizeActivationEntry(pluginId, document.entries[pluginId]);
    if (record === undefined) {
      return { verdict: "undetermined", reason: `${ACTIVATIONS_FILENAME} holds an unreadable record for '${pluginId}'` };
    }
    return record.enabled ? { verdict: "active" } : { verdict: "inactive" };
  }

  function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function extractPluginsBag(value: unknown): Readonly<Record<string, unknown>> | undefined {
    if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.plugins)) return undefined;
    return value.plugins;
  }

  function withActivationDefaults(record: Readonly<Record<string, unknown>>, enabled: boolean): AgentPluginActivationRecord {
    return {
      enabled,
      origin: record.origin === "bundled" ? "bundled" : "operator-installed",
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
      updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : "unknown",
    };
  }

  function normalizeActivationEntry(pluginId: string, entry: unknown): AgentPluginActivationRecord | undefined {
    if (!SAFE_PLUGIN_ID_PATTERN.test(pluginId)) return undefined;
    const record = isPlainObject(entry) ? entry : undefined;
    if (record === undefined || typeof record.enabled !== "boolean") return undefined;
    return withActivationDefaults(record, record.enabled);
  }

  function normalizeActivations(value: unknown): AgentPluginActivations {
    const plugins = extractPluginsBag(value);
    if (plugins === undefined) return EMPTY_ACTIVATIONS;
    return normalizePluginsBag(plugins);
  }

  function normalizePluginsBag(plugins: Readonly<Record<string, unknown>>): AgentPluginActivations {
    const normalized: Record<string, AgentPluginActivationRecord> = {};
    for (const [pluginId, entry] of Object.entries(plugins)) {
      const record = normalizeActivationEntry(pluginId, entry);
      if (record !== undefined) normalized[pluginId] = record;
    }

    return { schemaVersion: 1, plugins: normalized };
  }

  async function setAgentPluginActivation(
    required: SetAgentPluginActivationRequired,
    optional: SetAgentPluginActivationOptional = {},
  ): Promise<AgentPluginActivations> {
    assertPluginId(required.pluginId);
    return lockedActivationsWrite(required.workspaceRoot, async (lock) =>
      writeActivationDecision(await readPluginsBagStrict(required.workspaceRoot), required, optional, lock),
    );
  }

  async function writeActivationDecision(
    current: RawPluginsBag,
    required: SetAgentPluginActivationRequired,
    optional: SetAgentPluginActivationOptional,
    lock: HeldFileLock,
  ): Promise<AgentPluginActivations> {
    const { workspaceRoot, pluginId, enabled, actor } = required;
    assertTargetEntryReadable(workspaceRoot, current, pluginId);
    const plugins: RawPluginsBag = {
      ...current,
      [pluginId]: {
        enabled,

        origin: optional.origin ?? (isRecordedAsBundled(current, pluginId) ? "bundled" : "operator-installed"),
        updatedAt: (optional.now?.({}) ?? new Date(ports.clock.nowMs())).toISOString(),
        updatedBy: actor,
      },
    };

    await writeActivationsAtomically(workspaceRoot, plugins, lock);
    return normalizePluginsBag(plugins);
  }

  function assertTargetEntryReadable(workspaceRoot: string, current: RawPluginsBag, pluginId: string): void {
    if (!Object.hasOwn(current, pluginId)) return;
    if (normalizeActivationEntry(pluginId, current[pluginId]) !== undefined) return;
    throw new AgentPluginActivationsUnreadableError({ filePath: path.join(workspaceRoot, ACTIVATIONS_FILENAME), reason: `${ACTIVATIONS_FILENAME} holds an unreadable record for '${pluginId}', so it cannot be safely toggled` });
  }

  async function recordBundledAgentPluginIfAbsent(
    required: { readonly workspaceRoot: string; readonly pluginId: string },
    optional: { readonly now?: ((required: Record<string, never>) => Date) | undefined; readonly enabled?: boolean } = {},
  ): Promise<{ readonly recorded: boolean }> {
    assertPluginId(required.pluginId);
    const enabled = optional.enabled === true;

    return lockedActivationsWrite(required.workspaceRoot, async (lock) => {
      const current = await readPluginsBagStrict(required.workspaceRoot);
      if (Object.hasOwn(current, required.pluginId) && !(enabled && isUntouchedDisabledSeed(current[required.pluginId]))) {
        return { recorded: false };
      }

      await writeActivationDecision(
        current,
        { workspaceRoot: required.workspaceRoot, pluginId: required.pluginId, enabled, actor: SEED_ACTOR },
        { origin: "bundled", ...(optional.now !== undefined ? { now: optional.now } : {}) },
        lock,
      );
      return { recorded: true };
    });
  }

  const SEED_ACTOR = "system:seed";

  function isUntouchedDisabledSeed(entry: unknown): boolean {
    return isPlainObject(entry) && entry.enabled === false && entry.updatedBy === SEED_ACTOR;
  }

  async function enableBundledAgentPluginUnlessOperatorDisabled(required: {
    readonly workspaceRoot: string;
    readonly pluginId: string;

    readonly actor: string;
    readonly now?: ((required: Record<string, never>) => Date) | undefined;
  }): Promise<BundledAgentPluginEnableOutcome> {
    assertPluginId(required.pluginId);
    const { workspaceRoot, pluginId, actor } = required;

    return lockedActivationsWrite(workspaceRoot, async (lock) => {
      const current = await readPluginsBagStrict(workspaceRoot);
      if (Object.hasOwn(current, pluginId) && !isUntouchedDisabledSeed(current[pluginId])) {
        assertTargetEntryReadable(workspaceRoot, current, pluginId);
        return normalizeActivationEntry(pluginId, current[pluginId])?.enabled === true ? "already-enabled" : "left-disabled-by-operator";
      }

      await writeActivationDecision(
        current,
        { workspaceRoot, pluginId, enabled: true, actor },
        { origin: "bundled", ...(required.now !== undefined ? { now: required.now } : {}) },
        lock,
      );
      return "enabled";
    });
  }

  async function deleteAgentPluginActivation(required: DeleteAgentPluginActivationRequired): Promise<void> {
    const { workspaceRoot, pluginId } = required;
    assertPluginId(pluginId);

    await lockedActivationsWrite(workspaceRoot, async (lock) => {
      const current = await readPluginsBagStrict(workspaceRoot);
      if (!Object.hasOwn(current, pluginId)) return;

      const remaining: Record<string, unknown> = { ...current };
      delete remaining[pluginId];

      await writeActivationsAtomically(workspaceRoot, remaining, lock);
    });
  }

  function assertPluginId(pluginId: string): void {
    if (!SAFE_PLUGIN_ID_PATTERN.test(pluginId) || pluginId.length > 64) {
      throw new Error(`agent-plugin activation: '${pluginId}' is not a valid Agent Plugin id`);
    }
  }

  const pendingActivationWrites = new Map<string, Promise<void>>();

  async function serializeActivationsWrite<T>(workspaceRoot: string, write: () => Promise<T>): Promise<T> {
    const key = path.resolve(workspaceRoot);
    const result = (pendingActivationWrites.get(key) ?? Promise.resolve()).then(write);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    pendingActivationWrites.set(key, tail);
    try {
      return await result;
    } finally {
      if (pendingActivationWrites.get(key) === tail) pendingActivationWrites.delete(key);
    }
  }

  async function lockedActivationsWrite<T>(workspaceRoot: string, write: (lock: HeldFileLock) => Promise<T>): Promise<T> {
    return serializeActivationsWrite(workspaceRoot, async () => {
      await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
      const lockPath = path.join(workspaceRoot, ACTIVATIONS_LOCK_FILENAME);
      try {
        return await withFileLock({ lockPath, run: write }, {
          timeoutMs: 15_000, staleMs: 10_000, pollMs: 10,
          filesystem: ports.filesystem, clock: ports.clock, process: ports.process,
          token: () => ports.ids.newId(), hostname: () => ports.process.hostname({}),
          sleep: ({ durationMs }) => ports.clock.sleep({ ms: durationMs }),
          onStaleLockRemoved: ({ holder }) => warnStaleActivationsLockRemoved(lockPath, holder),
        });
      } catch (error) {
        throw toActivationsBusyError(lockPath, error);
      }
    });
  }

  async function writeActivationsAtomically(workspaceRoot: string, plugins: RawPluginsBag, lock: HeldFileLock): Promise<void> {
    const finalPath = path.join(workspaceRoot, ACTIVATIONS_FILENAME);
    const tempPath = `${finalPath}.tmp-${ports.process.pid}-${randomUUID()}`;
    try {
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, plugins }, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await lock.assertHeld({});
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    await syncDirectoryBestEffort(workspaceRoot);
  }

  async function syncDirectoryBestEffort(dir: string): Promise<void> {
    if (ports.process.platform === "win32") return;
    try {
      const handle = await open(dir, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {

    }
  }

  return { isAgentPluginActive, filterActiveAgentPlugins, readAgentPluginActivations, assertAgentPluginActivationsWritable, isAgentPluginRecordedAsBundled, resolveAgentPluginActivation, normalizeActivations, setAgentPluginActivation, recordBundledAgentPluginIfAbsent, enableBundledAgentPluginUnlessOperatorDisabled, deleteAgentPluginActivation };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createActivationModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
