import { toObjectArgArchiveReader, toZeroArgArchiveReader } from './archive-reader-abi.js';
export { toObjectArgArchiveReader, toZeroArgArchiveReader } from './archive-reader-abi.js';
import { planAgentPluginUpdate, AgentPluginUpdateError, type AgentPluginMcpProvisioningPort } from "@jini-ai/agent-plugins/lifecycle";
import type { readInstalledAgentPluginIdentity } from "@jini-ai/agent-plugins/lifecycle/host-tools";
import type { PluginHostPort, AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
/**
 * @file `installUploadedAgentPlugin()` — the admin "Add a plugin" upload: one operator-supplied
 * `.zip` of an agent-plugins.org package, installed for one workspace and left switched OFF.
 *
 * No second install path. Extraction, containment, size caps, the digest check and publication are
 * all `installAgentPlugin()`'s (`install.ts`), exactly as the bundled seed uses it; this module only
 * adds what an upload needs that a bundled source never does:
 *
 * - A real ZIP reader: Jini's published yauzl adapter, the same one `plugin-runtime/install-archive.ts`
 *   uses for site-plugin uploads, adapted to `install.ts`'s own reader port.
 * - One wrapping folder is accepted. Zipping a folder (macOS "Compress", a GitHub download) puts
 *   every file under `<folder>/`, plus `__MACOSX/` noise; `install.ts` wants `plugin.json` at the
 *   root. When the root has no `plugin.json` but exactly one top-level folder does, that folder is
 *   the package and everything outside it is dropped. Every path is still re-checked by `install.ts`.
 * - Replacing a disabled operator-installed plugin is explicit. Old digests are staged aside and
 *   restored on publication failure; memory stays in place. The per-plugin lock prevents ambiguous
 *   id races. Identical bytes are a harmless no-op instead.
 * - It stays off. An absent activation record reads as ACTIVE (operator installs predate the
 *   record), so the disabled `operator-installed` record is written BEFORE the package is
 *   published, the same order the bundled seed uses. A failed install leaves only that inert record.
 *
 * Nothing in an uploaded package runs: skills are markdown, and code seams only trust bundled
 * digests (`trusted-plugin-files.ts`).
 */
import path from "node:path";
import type { lstat } from "node:fs/promises";
import type { createAgentPluginLifecycle, AgentPluginLifecyclePorts, StagedTree } from "../lifecycle/index.js";
import type { PluginStateEffects } from "@jini-ai/agent-plugins/persistent-state";

import type { parseAgentPluginManifest } from "@jini-ai/agent-plugins/lifecycle";

import {
  AgentPluginInstallError,
  type AgentPluginArchiveEntry,
  type AgentPluginArchiveReaderPort,
} from "../lifecycle/index.js";
import type { InstalledAgentPlugin } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";


const MANIFEST = "plugin.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PREPASS_ENTRIES = 4096;
/** Archiver metadata a wrapping-folder zip may carry beside the folder. Never part of a package. */
const IGNORED_TOP_LEVEL = new Set(["__MACOSX"]);

export type AgentPluginUploadErrorCode = "ARCHIVE_UNREADABLE" | "PLUGIN_ID_TAKEN" | "PLUGIN_ENABLED" | "PLUGIN_BUNDLED";

/** Upload-only refusals; every other refusal is `install.ts`'s own `AgentPluginInstallError`. */
export class AgentPluginUploadError extends Error {
  readonly code: AgentPluginUploadErrorCode;

  constructor({ code, message }: { code: AgentPluginUploadErrorCode; message: string }, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentPluginUploadError";
    this.code = code;
  }
}

/** `reader`, minus every entry outside `prefix` and with `prefix` stripped from the rest.
 *  @complexity O(1) per entry. */
function withinPrefix({ reader, prefix }: { reader: AgentPluginArchiveReaderPort; prefix: string }, _optional: Record<string, never> = {}): AgentPluginArchiveReaderPort {
  if (!prefix) return reader;
  return {
    async *entries({ archive }) {
      for await (const entry of reader.entries({ archive })) {
        const name = entry.entryPath.replaceAll("\\", "/");
        if (name.startsWith(prefix)) {
          const inner = name.slice(prefix.length);
          if (inner) yield entry.kind === "file" ? { ...entry, entryPath: inner, openReadStream: required => entry.openReadStream(required) } : { ...entry, entryPath: inner };
        }
      }
    },
  };
}

async function readBounded(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.byteLength;
    if (length > MAX_MANIFEST_BYTES) throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: "plugin.json is larger than 1 MiB" });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, length);
}

/**
 * Finds the package root (`""` or one wrapping `<folder>/`) and its plugin id, by reading only
 * entry names and the candidate `plugin.json` files.
 * @complexity O(e) in entry count, capped at {@link MAX_PREPASS_ENTRIES}.
 */
async function locatePackage(reader: AgentPluginArchiveReaderPort, archive: Uint8Array, parseManifest: typeof parseAgentPluginManifest): Promise<{ prefix: string; pluginId: string }> {
  const { manifests, topLevel } = await scanPackageManifests({ reader, archive });
  const folders = [...topLevel].filter((name) => name.endsWith("/"));
  const enclosingFolder = topLevel.size === 1 && folders.length === 1 ? folders[0] : null;
  if (enclosingFolder === undefined) throw new AgentPluginInstallError({ code: "MANIFEST_MISSING", message: "the archive has no enclosing plugin folder" });
  const prefix = manifests.has(MANIFEST) ? "" : enclosingFolder;
  const raw = prefix === null ? undefined : manifests.get(prefix + MANIFEST);
  if (prefix === null || raw === undefined) {
    throw new AgentPluginInstallError({ code: "MANIFEST_MISSING", message: "the archive does not contain a plugin.json at its root or inside one top-level folder" });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: "plugin.json is not valid JSON" }, { cause: error });
  }
  const parsed = parseManifest({ value });
  if (!parsed.ok) throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: `plugin.json failed validation: ${parsed.errors.join("; ")}` });
  return { prefix, pluginId: parsed.manifest.name };
}

export interface InstallUploadedAgentPluginRequired {
  readonly archive: Uint8Array;
  /** Lowercase hex SHA-256 the client computed from the file it chose; catches a corrupted upload. */
  readonly expectedSha256: string;
  /** From the authenticated request context, never from the archive. */
  readonly workspaceId: string;
  /** The authenticated principal, recorded as the activation record's `updatedBy`. */
  readonly actor: string;
  readonly replace?: boolean;
  readonly update?: { readonly pluginId: string; readonly expectedOldDigest: string };
}

export interface InstallUploadedAgentPluginOptional {
  readonly pluginHost?: PluginHostPort;
  readonly mcpProvisioning?: AgentPluginMcpProvisioningPort;
  readonly snapshotSettings?: import("@jini-ai/agent-plugins/lifecycle").UpdateAgentPluginRequired["snapshotSettings"];
  readonly parseManifest: typeof parseAgentPluginManifest;
  readonly readInstallIdentity: typeof readInstalledAgentPluginIdentity;
  readonly sha256: (archive: Uint8Array) => string;
  readonly archiveReader: AgentPluginArchiveReaderPort;
  readonly lifecycle: Pick<ReturnType<typeof createAgentPluginLifecycle>, 'installAgentPlugin' | 'listInstalledPlugins' | 'stageForRemoval' | 'restoreStagedTrees' | 'removeFrozenPackageTree' | 'setAgentPluginActivation' | 'isAgentPluginRecordedAsBundled' | 'resolveAgentPluginActivation'>;
  readonly createLifecycle: (required: { layout: AgentPluginLayout }, optional: Partial<Pick<AgentPluginLifecyclePorts, 'mcpProvisioning'>> & Pick<AgentPluginLifecyclePorts, 'identityAdmission'>) => Pick<ReturnType<typeof createAgentPluginLifecycle>, 'updateAgentPlugin'>;
  readonly maxAgentPluginInstallArchiveBytes: () => number;
  readonly contain: PluginStateEffects['contain'];
  readonly assertOwnedPluginPath: (input: { contain: PluginStateEffects['contain']; workspaceRoot: string; entryPath: string }) => Promise<string>;
  readonly lstat: typeof lstat;
  readonly warnCleanup: (input: { pluginId: string; error: unknown }) => void;
  readonly layout: AgentPluginLayout;
  readonly path?: Pick<typeof path, "join" | "relative">;
}

export interface InstalledUploadedAgentPlugin {
  readonly plugin: InstalledAgentPlugin;
  /** True when these exact bytes were already installed; nothing was written. */
  readonly alreadyInstalled: boolean;
  readonly enabled?: boolean;
  readonly warnings?: readonly string[];
  readonly upgradeFrom?: readonly string[];
}

/** An explicit update's result: the lifecycle owner's `updateAgentPlugin` always reports the
 *  plugin's kept on/off state and its warnings, so neither is optional on this path. */
export type UpdatedUploadedAgentPlugin = InstalledUploadedAgentPlugin & { readonly enabled: boolean; readonly warnings: readonly string[] };

/**
 * Installs one uploaded Agent Plugin `.zip`, switched off.
 * @throws {AgentPluginInstallError} Size, digest, manifest and every extraction refusal.
 * @throws {AgentPluginUploadError} An unreadable archive, or an id another package already holds.
 * @complexity O(e + b) in entry count and extracted bytes, both capped by `install.ts`.
 */
export function installUploadedAgentPlugin(
  required: InstallUploadedAgentPluginRequired & { readonly update: NonNullable<InstallUploadedAgentPluginRequired["update"]> },
  optional: InstallUploadedAgentPluginOptional,
): Promise<UpdatedUploadedAgentPlugin>;
export function installUploadedAgentPlugin(
  required: InstallUploadedAgentPluginRequired,
  optional: InstallUploadedAgentPluginOptional,
): Promise<InstalledUploadedAgentPlugin>;
export async function installUploadedAgentPlugin(
  required: InstallUploadedAgentPluginRequired,
  optional: InstallUploadedAgentPluginOptional,
): Promise<InstalledUploadedAgentPlugin> {
  const { archive, expectedSha256, workspaceId, actor } = required;
  const { installAgentPlugin, stageForRemoval, restoreStagedTrees, setAgentPluginActivation } = optional.lifecycle;
  const { assertOwnedPluginPath, contain: containAgentPluginStatePath } = optional;
  const layout = optional.layout;
  const reader = optional.archiveReader;

  const digest = validateUploadedBytes({ archive, expectedSha256, maxAgentPluginInstallArchiveBytes: optional.maxAgentPluginInstallArchiveBytes, sha256: optional.sha256 });

  const { prefix, pluginId } = await locatePackage(reader, archive, optional.parseManifest);
  if (required.update) {
    return updateUploadedAgentPlugin({ ...required, update: required.update, expectedSha256: digest, archiveReader: withinPrefix({ reader, prefix }), candidateId: pluginId }, optional);
  }
  const workspaceLayout = layout.forWorkspace({ workspaceId });
  let alreadyInstalled = false;
  let upgradeFrom: string[] = [];
  const plugin = await installAgentPlugin({ archive, expectedSha256: digest,
    archiveReader: withinPrefix({ reader, prefix }), layout, workspaceId }, {
    // The lock belongs to installAgentPlugin. Doing an id check outside it lets two uploads
    // both pass and publish ambiguous digests. Keep check, disabled activation, and swap together.
    publishGuard: async ({ plugin: indexed, publish }) => {
      const run = () => publishUploadedAgentPlugin({ workspaceLayout, pluginId, digest, required, optional, indexed, publish, actor, stageForRemoval, restoreStagedTrees, setAgentPluginActivation, assertOwnedPluginPath, containAgentPluginStatePath,
        markAlreadyInstalled: () => { alreadyInstalled = true; }, setUpgradeFrom: versions => { upgradeFrom = versions; } });
      if (!optional.pluginHost) return run();
      const identity = await optional.readInstallIdentity({ plugin: indexed });
      return optional.pluginHost.withInstallIdentity({ candidate: { id: identity.id, localId: pluginId, family: "agent-plugin" }, run });
    },
  });
  return { plugin, alreadyInstalled, ...(upgradeFrom.length > 0 ? { upgradeFrom } : {}) };
}

/**
 * The explicit update: the candidate must carry the plugin id being updated, and the host must have
 * bound the settings-snapshot owner. Both are checked before the lifecycle owner opens its
 * transaction, so a refusal here changes nothing. The owner then re-checks the id, the installed
 * digest, bundled provenance and downgrades under the plugin lock.
 * @throws {AgentPluginUpdateError} PLUGIN_ID_MISMATCH, and every refusal of the lifecycle owner.
 * @throws {Error} A host that did not bind `snapshotSettings` (a wiring fault, not the caller's).
 * @complexity O(e + b), as the install it delegates to.
 */
async function updateUploadedAgentPlugin(
  required: InstallUploadedAgentPluginRequired & { readonly update: NonNullable<InstallUploadedAgentPluginRequired["update"]>; readonly archiveReader: AgentPluginArchiveReaderPort; readonly candidateId: string },
  optional: InstallUploadedAgentPluginOptional,
): Promise<UpdatedUploadedAgentPlugin> {
  if (required.candidateId !== required.update.pluginId) throw new AgentPluginUpdateError({ code: "PLUGIN_ID_MISMATCH", message: "This package is a different plugin. Choose a package for the plugin you are updating." });
  const snapshotSettings = optional.snapshotSettings;
  if (!snapshotSettings) throw new Error("Agent Plugin update is unavailable: the host did not bind the plugin settings snapshot owner.");
  const pluginHost = optional.pluginHost;
  const lifecycle = optional.createLifecycle({ layout: optional.layout }, {
    ...(optional.mcpProvisioning ? { mcpProvisioning: optional.mcpProvisioning } : {}),
    ...(pluginHost ? { identityAdmission: ({ id, localId, run }) => pluginHost.withInstallIdentity({ candidate: { id, localId, family: "agent-plugin" }, run }) } : {}),
  });
  return lifecycle.updateAgentPlugin({ archive: required.archive, expectedSha256: required.expectedSha256, archiveReader: required.archiveReader,
    layout: optional.layout, workspaceId: required.workspaceId, actor: required.actor, ...required.update, snapshotSettings });
}

type UpdateRevision = Parameters<typeof planAgentPluginUpdate>[0]["candidate"];

/** Same id is the upgrade identity; different bytes alone are not evidence of a different plugin.
 * Bundled provenance and active/undetermined records are checked strictly before a replacement.
 * Downgrades are refused here, the path preview and install share, so preview never offers a
 * replacement that install would then refuse. */
async function checkExisting(required: { workspaceRoot: string; pluginId: string; digest: string; replace: boolean; candidate: UpdateRevision; lifecycle: InstallUploadedAgentPluginOptional["lifecycle"] }, _optional: Record<string, never> = {}): Promise<InstalledAgentPlugin[]> {
  const { listInstalledPlugins } = required.lifecycle;
  const existing = (await listInstalledPlugins({ workspaceRoot: required.workspaceRoot })).filter(plugin => plugin.pluginId === required.pluginId);
  if (!existing.some(plugin => plugin.archiveDigest === required.digest) && existing.length > 0) await assertReplaceable(required);
  for (const previous of existing) {
    if (planAgentPluginUpdate({ installed: previous, candidate: required.candidate }).action === "downgrade-refused") throw new AgentPluginUpdateError({ code: "PLUGIN_DOWNGRADE_REFUSED", message: "Plugin downgrades are refused." });
  }
  return existing;
}

/** A different package under an installed id replaces it only when asked, never a bundled plugin,
 * and only while the installed one is switched off. */
async function assertReplaceable(required: { workspaceRoot: string; pluginId: string; replace: boolean; lifecycle: InstallUploadedAgentPluginOptional["lifecycle"] }, _optional: Record<string, never> = {}): Promise<void> {
  const { isAgentPluginRecordedAsBundled, resolveAgentPluginActivation } = required.lifecycle;
  if (!required.replace) throw new AgentPluginUploadError({ code: "PLUGIN_ID_TAKEN", message: "This plugin ID is already installed. Choose Replace existing version to upgrade it." });
  if (await isAgentPluginRecordedAsBundled({ workspaceRoot: required.workspaceRoot, pluginId: required.pluginId })) throw new AgentPluginUploadError({ code: "PLUGIN_BUNDLED", message: "A bundled plugin owns this ID and cannot be replaced by an uploaded plugin." });
  if ((await resolveAgentPluginActivation({ workspaceRoot: required.workspaceRoot, pluginId: required.pluginId })).verdict !== "inactive") throw new AgentPluginUploadError({ code: "PLUGIN_ENABLED", message: "Switch off the installed plugin before replacing its version." });
}

/** Every uploaded package carries this, install and update alike; only install adds that it stays OFF,
 *  since an update keeps the installed plugin's on/off state. */
export const UPLOADED_AGENT_PLUGIN_TRUST_WARNING = "Trust: local / unverified publisher. Uploaded Agent Plugin code is not trusted to run. Skills can guide the assistant.";

export interface AgentPluginUploadPreview {
  readonly pluginId: string;
  readonly version?: string;
  readonly digest: string;
  readonly skills: readonly string[];
  readonly upgradeFrom?: readonly string[];
  readonly warning: string;
}

/** Extracts through the real install validator in staging; preview never publishes code or memory.
 * Host paths from that ephemeral extraction are deliberately absent from this projection. */
export async function previewUploadedAgentPlugin(required: InstallUploadedAgentPluginRequired, optional: InstallUploadedAgentPluginOptional): Promise<AgentPluginUploadPreview> {
  validateUploadedBytes({ ...required, maxAgentPluginInstallArchiveBytes: optional.maxAgentPluginInstallArchiveBytes, sha256: optional.sha256 });
  const reader = optional.archiveReader;
  const layout = optional.layout;
  const { installAgentPlugin } = optional.lifecycle;
  const { prefix, pluginId } = await locatePackage(reader, required.archive, optional.parseManifest);
  const plugin = await installAgentPlugin({ archive: required.archive, expectedSha256: required.expectedSha256,
    archiveReader: withinPrefix({ reader, prefix }), layout, workspaceId: required.workspaceId }, { previewOnly: true });
  const existing = await checkExisting({ workspaceRoot: layout.forWorkspace({ workspaceId: required.workspaceId }).root, pluginId, digest: plugin.archiveDigest, replace: required.replace === true, candidate: plugin, lifecycle: optional.lifecycle });
  const upgradeFrom = existing.filter(entry => entry.archiveDigest !== plugin.archiveDigest).flatMap(entry => entry.version ? [entry.version] : []);
  return { pluginId, ...(plugin.version ? { version: plugin.version } : {}), digest: plugin.archiveDigest,
    skills: plugin.skills.map(skill => skill.name), ...(upgradeFrom.length > 0 ? { upgradeFrom } : {}),
    warning: `${UPLOADED_AGENT_PLUGIN_TRUST_WARNING} It stays OFF until you enable it.`,
  };
}

/** Both preview and install check the upload cap/digest before a reader opens any stream.
 * installAgentPlugin repeats these checks at the extraction boundary. */
function validateUploadedBytes(required: { archive: Uint8Array; expectedSha256: string; maxAgentPluginInstallArchiveBytes(): number; sha256: (archive: Uint8Array) => string }, _optional: Record<string, never> = {}): string {
  if (required.archive.byteLength > required.maxAgentPluginInstallArchiveBytes()) {
    throw new AgentPluginInstallError({ code: "ARCHIVE_TOO_LARGE", message: "archive exceeds the 32 MiB upload cap" });
  }
  const digest = required.sha256(required.archive);
  if (!/^[a-f0-9]{64}$/i.test(required.expectedSha256) || digest !== required.expectedSha256.toLowerCase()) {
    throw new AgentPluginInstallError({ code: "DIGEST_MISMATCH", message: "the uploaded bytes do not match the file that was chosen" });
  }
  return digest;
}

async function scanPackageManifests(
  { reader, archive }: { reader: AgentPluginArchiveReaderPort; archive: Uint8Array },
  _optional: Record<string, never> = {},
) {
  const manifests = new Map<string, Buffer>();
  const topLevel = new Set<string>();
  let count = 0;
  try {
    for await (const entry of reader.entries({ archive })) {
      count++;
      if (count > MAX_PREPASS_ENTRIES) throw new AgentPluginInstallError({ code: "TOO_MANY_ENTRIES", message: `archive exceeds the ${MAX_PREPASS_ENTRIES}-entry cap` });
      await indexPackageManifest({ entry, manifests, topLevel });
    }
  } catch (error) {
    if (error instanceof AgentPluginInstallError) throw error;
    throw new AgentPluginUploadError({ code: "ARCHIVE_UNREADABLE", message: "the file is not a readable .zip archive" }, { cause: error });
  }
  return { manifests, topLevel };
}

async function indexPackageManifest(
  { entry, manifests, topLevel }: { entry: AgentPluginArchiveEntry; manifests: Map<string, Buffer>; topLevel: Set<string> },
  _optional: Record<string, never> = {},
) {
  const name = entry.entryPath.replaceAll("\\", "/").replace(/^\.\//, "");
  const [head] = name.split("/");
  if (head && !IGNORED_TOP_LEVEL.has(head)) topLevel.add(name.includes("/") ? `${head}/` : head);
  if (entry.kind === "file" && /^(?:[^/]+\/)?plugin\.json$/.test(name)) manifests.set(name, await readBounded(entry.openReadStream({})));
}

async function removeFailedPublication(
  { packagesDir, digest, staged, lstat, removeFrozenPackageTree, path: paths }: { path: Pick<typeof path, "join">; packagesDir: string; digest: string; staged: readonly StagedTree[]; lstat: InstallUploadedAgentPluginOptional["lstat"]; removeFrozenPackageTree: InstallUploadedAgentPluginOptional["lifecycle"]["removeFrozenPackageTree"] },
  _optional: Record<string, never> = {},
) {
  const destination = paths.join(packagesDir, digest);
  // publish can fail while freezing its new tree. Remove that tree before restoring the old
  // one, so a failed upgrade never leaves two resolvable versions under the same id.
  if (staged.length > 0) {
    try { if ((await lstat(destination)).isDirectory()) await removeFrozenPackageTree({ root: destination }); }
    catch (cleanupError) { if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError; }
  }
}

async function retireReplacedPackages(
  { staged, pluginId, removeFrozenPackageTree, warnCleanup }: { staged: readonly StagedTree[]; pluginId: string; removeFrozenPackageTree: InstallUploadedAgentPluginOptional["lifecycle"]["removeFrozenPackageTree"]; warnCleanup: InstallUploadedAgentPluginOptional["warnCleanup"] },
  _optional: Record<string, never> = {},
) {
  // Publication is settled. Cleanup must never delete the new version then try to restore
  // an old tree whose cleanup already succeeded. Quarantine names are excluded from discovery.
  for (const tree of staged) {
    try { await removeFrozenPackageTree({ root: tree.quarantined }); }
    catch (error) { warnCleanup({ pluginId, error }); }
  }
}

async function publishUploadedAgentPlugin({ workspaceLayout, pluginId, digest, required, optional, indexed, publish, actor, stageForRemoval, restoreStagedTrees, setAgentPluginActivation, assertOwnedPluginPath, containAgentPluginStatePath, markAlreadyInstalled, setUpgradeFrom }: {
  workspaceLayout: ReturnType<AgentPluginLayout['forWorkspace']>; pluginId: string; digest: string;
  required: InstallUploadedAgentPluginRequired; optional: InstallUploadedAgentPluginOptional;
  indexed: UpdateRevision; publish: () => Promise<InstalledAgentPlugin>;
  actor: string;
  stageForRemoval: InstallUploadedAgentPluginOptional['lifecycle']['stageForRemoval'];
  restoreStagedTrees: InstallUploadedAgentPluginOptional['lifecycle']['restoreStagedTrees'];
  setAgentPluginActivation: InstallUploadedAgentPluginOptional['lifecycle']['setAgentPluginActivation'];
  assertOwnedPluginPath: InstallUploadedAgentPluginOptional['assertOwnedPluginPath'];
  containAgentPluginStatePath: InstallUploadedAgentPluginOptional['contain'];
  markAlreadyInstalled: () => void; setUpgradeFrom: (versions: string[]) => void;
}, _optional = {}): Promise<InstalledAgentPlugin> {
        const existing = await checkExisting({ workspaceRoot: workspaceLayout.root, pluginId, digest, replace: required.replace === true, candidate: indexed, lifecycle: optional.lifecycle });
        const same = existing.find(entry => entry.archiveDigest === digest);
        if (same) { markAlreadyInstalled(); return same; }
        setUpgradeFrom(existing.flatMap(entry => entry.version ? [entry.version] : []));
        const staged: StagedTree[] = [];
        const packagesDir = workspaceLayout.pluginPackagesDir({ pluginId });
        await assertOwnedPluginPath({ contain: containAgentPluginStatePath, workspaceRoot: workspaceLayout.root, entryPath: (optional.path ?? path).relative(workspaceLayout.root, packagesDir) });
        let installed: InstalledAgentPlugin;
        try {
          for (const previous of existing) staged.push(await stageForRemoval({ packagesDir, packageRoot: previous.packageRoot }));
          // Write OFF before publication: a missing activation record otherwise means active.
          // Replacement already proved this record OFF; preserve it exactly on success or rollback.
          if (existing.length === 0) await setAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId, enabled: false, actor }, { origin: "operator-installed" });
          installed = await publish();
        } catch (error) {
          await removeFailedPublication({ packagesDir, digest, staged, lstat: optional.lstat, removeFrozenPackageTree: optional.lifecycle.removeFrozenPackageTree, path: optional.path ?? path });
          throw await restoreStagedTrees({ staged, cause: error });
        }
        await retireReplacedPackages({ staged, pluginId, removeFrozenPackageTree: optional.lifecycle.removeFrozenPackageTree, warnCleanup: optional.warnCleanup });
        return installed;
      }

export function createAgentPluginUpload(required: InstallUploadedAgentPluginOptional, _optional = {}) {
  function install(input: InstallUploadedAgentPluginRequired & { update: NonNullable<InstallUploadedAgentPluginRequired['update']> }, optional?: Pick<InstallUploadedAgentPluginOptional, 'pluginHost' | 'mcpProvisioning' | 'snapshotSettings'>): Promise<UpdatedUploadedAgentPlugin>;
  function install(input: InstallUploadedAgentPluginRequired, optional?: Pick<InstallUploadedAgentPluginOptional, 'pluginHost' | 'mcpProvisioning' | 'snapshotSettings'>): Promise<InstalledUploadedAgentPlugin>;
  function install(input: InstallUploadedAgentPluginRequired, optional: Pick<InstallUploadedAgentPluginOptional, 'pluginHost' | 'mcpProvisioning' | 'snapshotSettings'> = {}) { return installUploadedAgentPlugin(input, { ...required, ...optional }); }
  return {
    installUploadedAgentPlugin: install,
    previewUploadedAgentPlugin: (input: InstallUploadedAgentPluginRequired, optional: Pick<InstallUploadedAgentPluginOptional, 'pluginHost' | 'mcpProvisioning' | 'snapshotSettings'> = {}) => previewUploadedAgentPlugin(input, { ...required, ...optional }),
  };
}

export function bindAgentPluginUpload(required: Omit<InstallUploadedAgentPluginOptional, 'layout' | 'archiveReader' | 'path' | 'snapshotSettings' | 'pluginHost' | 'mcpProvisioning' | 'lifecycle' | 'createLifecycle'> & {
  lifecycle: Omit<InstallUploadedAgentPluginOptional['lifecycle'], 'installAgentPlugin'> & {
    installAgentPlugin(input: Omit<Parameters<InstallUploadedAgentPluginOptional['lifecycle']['installAgentPlugin']>[0], 'archiveReader'> & { archiveReader: ReturnType<typeof toZeroArgArchiveReader> }, optional?: Parameters<InstallUploadedAgentPluginOptional['lifecycle']['installAgentPlugin']>[1]): ReturnType<InstallUploadedAgentPluginOptional['lifecycle']['installAgentPlugin']>;
  };
  createLifecycle(input: Parameters<InstallUploadedAgentPluginOptional['createLifecycle']>[0], optional: Parameters<InstallUploadedAgentPluginOptional['createLifecycle']>[1]): {
    updateAgentPlugin(input: Omit<Parameters<ReturnType<InstallUploadedAgentPluginOptional['createLifecycle']>['updateAgentPlugin']>[0], 'archiveReader'> & { archiveReader: ReturnType<typeof toZeroArgArchiveReader> }): ReturnType<ReturnType<InstallUploadedAgentPluginOptional['createLifecycle']>['updateAgentPlugin']>;
  };
  path: Pick<typeof path, 'join' | 'relative'>;
  archiveReader(): AgentPluginArchiveReaderPort;
}, _optional = {}) {
  function install(
    input: InstallUploadedAgentPluginRequired & { update: NonNullable<InstallUploadedAgentPluginRequired['update']> },
    optional: Pick<InstallUploadedAgentPluginOptional, 'layout' | 'snapshotSettings' | 'pluginHost' | 'mcpProvisioning'> & { archiveReader?: Parameters<typeof toObjectArgArchiveReader>[0]['reader'] },
  ): Promise<UpdatedUploadedAgentPlugin>;
  function install(input: InstallUploadedAgentPluginRequired, optional: Pick<InstallUploadedAgentPluginOptional, 'layout' | 'snapshotSettings' | 'pluginHost' | 'mcpProvisioning'> & { archiveReader?: Parameters<typeof toObjectArgArchiveReader>[0]['reader'] }): Promise<InstalledUploadedAgentPlugin>;
  function install(input: InstallUploadedAgentPluginRequired, optional: Pick<InstallUploadedAgentPluginOptional, 'layout' | 'snapshotSettings' | 'pluginHost' | 'mcpProvisioning'> & { archiveReader?: Parameters<typeof toObjectArgArchiveReader>[0]['reader'] }) {
    return installUploadedAgentPlugin(input, {
      ...required, ...optional, archiveReader: optional.archiveReader ? toObjectArgArchiveReader({ reader: optional.archiveReader }) : required.archiveReader(),
      lifecycle: { ...required.lifecycle, installAgentPlugin: (input, optional) => required.lifecycle.installAgentPlugin({ ...input, archiveReader: toZeroArgArchiveReader({ reader: input.archiveReader }) }, optional) },
      createLifecycle: (input, optional) => {
        const lifecycle = required.createLifecycle(input, optional);
        return { updateAgentPlugin: input => lifecycle.updateAgentPlugin({ ...input, archiveReader: toZeroArgArchiveReader({ reader: input.archiveReader }) }) };
      },
    });
  }
  return {
    installUploadedAgentPlugin: install,
    previewUploadedAgentPlugin: (input: InstallUploadedAgentPluginRequired, optional: Pick<InstallUploadedAgentPluginOptional, 'layout' | 'pluginHost' | 'mcpProvisioning'> & { archiveReader?: Parameters<typeof toObjectArgArchiveReader>[0]['reader'] }) => previewUploadedAgentPlugin(input, {
      ...required, ...optional, archiveReader: optional.archiveReader ? toObjectArgArchiveReader({ reader: optional.archiveReader }) : required.archiveReader(),
      lifecycle: { ...required.lifecycle, installAgentPlugin: (input, optional) => required.lifecycle.installAgentPlugin({ ...input, archiveReader: toZeroArgArchiveReader({ reader: input.archiveReader }) }, optional) },
    }),
  };
}
