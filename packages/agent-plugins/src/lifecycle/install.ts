import { listInstalledPackageRoots } from "./installed-package-roots.js";
import { createUninstallModule } from "./uninstall.js";
import { AgentPluginInstallError } from "./install-errors.js";
import { createInstalledPackageIndex } from "./installed-package-index.js";
import { readPluginIdentity, assertPluginIdentityAvailable } from "@jini-ai/core/plugin-directory";
/**
 * @file `installAgentPlugin()` — content-addressed, adversarially-hardened extraction of one Agent
 * Plugin (agent-plugins.org) archive into one workspace's own `AgentPluginWorkspaceLayout.packages`.
 *
 * This is the highest-risk unit in the whole feature. Extraction is where containment actually
 * breaks — everything downstream (capability projection, a future MCP admission gate) trusts that a
 * "package root" is exactly the bytes the archive declared, laid out exactly where the archive said,
 * with nothing outside it touched. Two independently-cited attack classes drive the checks here:
 *
 * - **Zip-slip / archive-extraction path traversal** (Snyk's zip-slip research; JFrog's
 *   `mholt/archiver` writeup; the `node-tar` GHSA-8qq5-rm4j-mr97 advisory) has two vectors: a
 *   crafted entry NAME containing `../` (caught by {@link normalizePackageEntryPath}'s lexical
 *   check), and a crafted SYMLINK entry whose target a later, innocent-looking entry name walks
 *   through. The convergent ecosystem fix for the second vector — and the one this module takes — is
 *   to refuse symlink entries outright rather than attempt to validate where they point: a plugin
 *   has no legitimate reason to ship a symlink inside its own package, and the Agent Plugins spec's
 *   own path-safety clause only ever promises symlinks MAY resolve inside the root, never that a
 *   client must accept one.
 * - **Decompression bombs**, in both the classic "one file lies about its size" shape (caught by
 *   bounding bytes actually observed leaving `openReadStream()`, not the archive's own declared
 *   size) and the "many small files" shape (caught by a running total across the whole archive).
 *
 * Why this is a SEPARATE format from the host runtime-plugin format's loader (`plugin-runtime/loader.ts`), not a
 * shared one: verified against that file directly. `loadPlugin()`'s BR-01 pipeline requires
 * `manifest.integrity` (a per-file SHA-256 map), `manifest.sdkRange` checked against a runtime
 * the host plugin SDK version, and a `server/index.mjs` ESM entry point it `import()`s. An Agent Plugin has
 * none of those — no integrity map, no SDK range, no single entry point, and (per this feature's own
 * FINAL decision) no code the host ever imports or executes at all in v1: Skills are markdown read for
 * context injection, and MCP servers are preview-only (`capability-projection.ts`). Adapting Agent
 * Plugins into `loadPlugin()`'s pipeline would mean inventing values for fields the open standard
 * does not define, which is precisely the "package format vs. execution/trust model" conflation this
 * feature's own owner-locked decisions (see `CTX-AGENTPLUGINS-2026-08-12.md` F2) rule out.
 *
 * Why the archive itself is a `ArchiveReaderPort`, not a concrete zip/tar library call: this
 * codebase's own port+adapter discipline (`mcp-federation/ports.ts`'s `McpSessionPort`/
 * `McpStdioChannel` split is the direct precedent) — and, concretely, no zip/tar dependency exists
 * in this repo's `package.json` today. Choosing and vetting one (license, maintenance, streaming
 * support) is a real decision outside a Programmer's scope to make silently; this module declares
 * the seam and is exercised end-to-end by a scripted double, so a real adapter is a pure addition
 * with zero change to the hardening logic here. See the handoff's REMAINING section.
 *
 * Content-addressing (`ws/<workspaceId>/packages/sha256/<archiveDigest>/`): the digest is verified
 * BEFORE extraction ever touches the archive reader, so an install with a mismatched digest never
 * even attempts to unpack — the digest is the trust boundary between "bytes a marketplace claimed"
 * and "bytes this process is willing to run a parser over". A second install of byte-identical
 * content BY THE SAME WORKSPACE is recognized from the digest alone and short-circuits without a
 * second extraction. Deliberately NOT shared across workspaces — see `layout.ts`'s header (owner
 * decision, tenant-grade isolation, 2026-08-12): this function resolves the workspace-scoped layout
 * itself, exactly once, from an instance-level `AgentPluginLayout` plus one `workspaceId` (see the
 * SECURITY note on {@link InstallAgentPluginRequired} below) — the caller is what makes two
 * different workspaces' installs land in disjoint trees, simply by supplying a different
 * `workspaceId` for each; this function's own internal `forWorkspace()` call is what turns that into
 * disjoint, internally-consistent paths.
 *
 * Architectural role:
 * The one place this feature performs filesystem writes for installed package bytes. No network I/O
 * (archive bytes and their expected digest are caller-supplied — see the module header above for why
 * "how does the archive get here" is out of this slice) and no execution of anything extracted.
 */
import { createPersistentStateModule } from "./persistent-state.js";
import { createAgentPluginUpdateStore, settleAgentPluginUpdateJournal } from "./update-store.js";
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import type { AgentPluginLayout } from "./layout.js";
import { PackagePathViolation } from "./package-paths.js";
import { createPackagePathsModule } from "./package-paths.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { InstalledAgentPlugin } from "./types.js";
export type { InstalledAgentPlugin, InstalledAgentPluginSkill } from "./types.js";

export { AgentPluginInstallError } from "./install-errors.js";
export type { AgentPluginInstallErrorCode } from "./install-errors.js";
/** One archive entry. A symlink is modeled as its OWN kind rather than folded into "file" — the
 * zip-slip research this module's header cites is explicit that the symlink-entry vector is
 * distinct from the lexical-traversal one, and the two need independent tests and independent
 * handling (see the "symlink entries are rejected outright" rule below). */
export type AgentPluginArchiveEntry =
  | {
      readonly kind: "file";
      readonly entryPath: string;

      /** The archive format's own claimed size. Never trusted alone — see `DECOMPRESSION_BOMB`. */
  readonly declaredSize?: (number) | undefined;
      readonly executable?: (boolean) | undefined;
      readonly openReadStream: (required: Record<string, never>) => AsyncIterable<Uint8Array>;
    }
  | { readonly kind: "directory"; readonly entryPath: string }
  | { readonly kind: "symlink" | "hardlink" | "device" | "fifo"; readonly entryPath: string; readonly linkTarget?: string | undefined };

/**
 * `entries` must be a pure function of the archive bytes: an install iterates it twice, once to
 * check entry-count limits from metadata alone and once to extract.
 */
/** `entries` is a pure function of archive bytes: metadata preflight and extraction iterate it twice. */
export interface AgentPluginArchiveReaderPort {
  entries(required: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry>;
}

export interface InstallAgentPluginRequired {
  readonly archive: Uint8Array;

  /** Lowercase hex SHA-256 the caller expects `archive` to hash to — a real marketplace flow would
   * supply this from the server's own metadata; verified here, never trusted from the archive
   * itself. */
  readonly expectedSha256: string;
  readonly archiveReader: AgentPluginArchiveReaderPort;

  /**
   * SECURITY (2026-08-13, security pass Finding 2 — tenant isolation, `ADS-memory/reports/security/
   * 2026-08-13-post-session-security-pass.md`): this field used to be an already-resolved
   * `AgentPluginWorkspaceLayout` (`{ root, packages, staging, pluginDataDir }`) — a plain interface
   * of four independently-typed string/function fields with no tag identifying which workspace it
   * came from. Nothing stopped a caller from hand-assembling one from two DIFFERENT real
   * `forWorkspace()` results (wrong variable capture, a stale cached layout, a future code path that
   * builds one by hand instead of calling `forWorkspace`) — such a value type-checked identically to
   * a correctly-resolved one, and `installAgentPlugin` published into whatever `packages`/`staging`
   * it was handed with no consistency check. Proven at the unit level in `install.unit.test.ts`
   * (a layout stitching workspace A's `root`/`pluginDataDir` onto workspace B's real `packages`/
   * `staging` published into workspace B's real, on-disk store with no error).
   *
   * The fix: `installAgentPlugin` no longer accepts a pre-resolved workspace layout as input AT ALL.
   * It takes the RAW MATERIALS instead — the INSTANCE-level layout (`resolveAgentPluginLayout()`,
   * carries no workspace-scoped path of its own) plus one `workspaceId` — and calls
   * `layout.forWorkspace(workspaceId)` itself, exactly once, internally. There is no longer any
   * `AgentPluginWorkspaceLayout`-shaped parameter here for a caller to stitch fields into: the one
   * and only path from these two inputs to `packages`/`staging`/`pluginDataDir` is the real
   * `forWorkspace()` closure, called atomically, so the four resulting paths can never disagree with
   * each other about which workspace they belong to. Passing a hand-built `{ packages, staging, ... }`
   * literal where this field is expected is now a compile-time type error, not a runtime hazard.
   *
   * `workspaceId` must still come from the authenticated principal's own request context, never
   * derived from `layout` itself (a hand-built or malicious `AgentPluginLayout` could fake a
   * `forWorkspace` implementation identically) — that half of the guarantee is a caller obligation
   * this type cannot enforce, the same way `archiveReader` above is a fully caller-trusted port. What
   * IS closed is the specific, demonstrated bug class: stitching or hand-assembling an
   * already-resolved workspace layout from parts.
   */
  readonly layout: AgentPluginLayout;

  /** The workspace this install is for. Combined with {@link layout} via `layout.forWorkspace(workspaceId)`
   * — see the SECURITY note on {@link layout} above. */
  readonly workspaceId: string;
}

export interface InstallAgentPluginOptional {
  /** Full bounded extraction/validation in staging, with no package or memory publication. */
  readonly previewOnly?: boolean;
  /** Host policy transaction inside the per-plugin lock after validation. Call publish exactly
   * once to install; returning an existing package without calling it is a deduplicated no-op. */
  /** Host policy transaction, called inside the existing per-plugin lock after validation.
   * It must invoke publish exactly once to install. Shared lifecycle counterpart is in chat-tools.jini.patch. */
  readonly publishGuard?: (required: { readonly plugin: InstalledAgentPlugin; readonly publish: () => Promise<InstalledAgentPlugin> }, optional: Record<string, never>) => Promise<InstalledAgentPlugin>;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const persistentState = createPersistentStateModule(ports);
  const chmod = ports.filesystem.chmod.bind(ports.filesystem);
  const mkdir = ports.filesystem.mkdir.bind(ports.filesystem);
  const mkdtemp = ports.filesystem.mkdtemp.bind(ports.filesystem);
  const open = ports.filesystem.open.bind(ports.filesystem);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const index = createInstalledPackageIndex({ ports });
  const indexInstalledRoot = (packageRoot: string, archiveDigest: string) => index.indexInstalledRoot({ packageRoot, archiveDigest });
  const { assertContainedOnDisk, normalizePackageEntryPath } = createPackagePathsModule(ports);
  const LIMITS = {
    maxArchiveBytes: 32 * 1024 * 1024,
    maxEntries: 4096,
    maxFileBytes: 16 * 1024 * 1024,
    maxTotalExtractedBytes: 64 * 1024 * 1024,
  } as const;

  /** Publisher ids are metadata, never filesystem segments. The workspace identity lock
   * serializes installs under different local names competing for one qualified id.
   * @complexity O(d) manifest reads for d installed revisions; no executable imports. */
  async function assertIdentityAvailable(workspaceRoot: string, candidate: InstalledAgentPlugin): Promise<void> {
    // Installed roots are canonical paths; compare against the same root even when the host
    // supplied an OS alias (macOS /var -> /private/var). Containment still rejects escaped links.
    workspaceRoot = await ports.filesystem.realpath(workspaceRoot);
    for (const root of await listInstalledPackageRoots({ ports, workspaceRoot })) {
      const manifestPath = path.join(root.packageRoot, 'plugin.json');
      await persistentState.assertOwnedPath({ workspaceRoot, entryPath: path.relative(workspaceRoot, manifestPath) });
      let raw: Record<string, unknown>;
      let identity: ReturnType<typeof readPluginIdentity>;
      try {
        raw = JSON.parse(await readFile(manifestPath, 'utf8'));
        identity = readPluginIdentity({ manifest: raw, name: root.localId, namespace: ports.extensionNamespace });
      } catch {
        // A damaged unrelated install must not block fresh installs or bundled seeding.
        ports.onEvent?.({ event: 'agent-plugin-identity-warning', message: `Plugin '${root.localId}': installed identity manifest is unreadable or invalid; omitted from identity admission.` });
        continue;
      }
      try {
        assertPluginIdentityAvailable({ candidate: { id: candidate.id!, localId: candidate.pluginId, family: 'agent-plugin' },
          installed: [{ ...identity, localId: root.localId, family: 'agent-plugin', version: typeof raw.version === 'string' ? raw.version : null, enabled: false }] });
      } catch { throw new AgentPluginInstallError({ code: 'PLUGIN_ID_CONFLICT', message: 'The publisher-qualified plugin id conflicts with an installed package.' }); }
    }
  }

  /** Retires only this plugin's superseded revisions after accepted publication, under the same
   * identity/plugin locks. Persistent data, learned facts and notes never enter this operation.
   * Reuse uninstall's frozen-tree staging so an interrupted removal is no longer a live digest.
   * There is no previous-revision rollback slot in this lifecycle; failed publication keeps all
   * prior bytes. Cleanup faults warn without turning an accepted install into a failed install.
   * @complexity O(d + f), d workspace revisions, f files in this plugin's superseded packages.
   */
  async function pruneSupersededRevisions(
    { workspaceRoot, installed }: { workspaceRoot: string; installed: InstalledAgentPlugin },
    _optional: Record<string, never> = {},
  ): Promise<void> {
    try {
      const removal = createUninstallModule(ports);
      for (const root of await listInstalledPackageRoots({ ports, workspaceRoot })) {
        if (root.localId !== installed.pluginId || root.archiveDigest === installed.archiveDigest) continue;
        try {
          const staged = await removal.stageForRemoval(path.dirname(root.packageRoot), root.packageRoot);
          await removal.removeFrozenPackageTree(staged.quarantined);
        } catch {
          ports.onEvent?.({ event: 'agent-plugin-revision-prune-warning', message: `Plugin '${installed.pluginId}': a superseded revision could not be pruned.` });
        }
      }
    } catch {
      ports.onEvent?.({ event: 'agent-plugin-revision-prune-warning', message: `Plugin '${installed.pluginId}': superseded revisions could not be scanned for pruning.` });
    }
  }

  /** Exposes `LIMITS.maxArchiveBytes` for a caller outside this module — concretely, a test asserting
 * `@jini-ai/agent-plugins/lifecycle`'s fetch cap constant stays pinned to this one. The local fetch-archive.ts fork was deleted; see the package's fetch module
 * for why it duplicates the number instead of importing it (no runtime dependency on `install.ts`);
 * this accessor is what lets a test assert the pairing without either module importing the other. */
  function maxAgentPluginInstallArchiveBytes(): number {
    return LIMITS.maxArchiveBytes;
  }

  const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

  /**
 * Verifies, extracts, and publishes one Agent Plugin archive.
 *
 * @throws {AgentPluginInstallError} For every expected failure — a hostile or malformed archive, a
 * digest mismatch, an invalid manifest. Never partially publishes: any failure after extraction has
 * begun removes the whole staging directory before rethrowing.
 * @complexity O(e) in archive entry count, O(b) in total extracted bytes — both explicitly bounded
 * by {@link LIMITS}, so this function's cost cannot be driven unbounded by a hostile archive.
 */
// The ONE call that turns (instance layout, workspaceId) into real, internally-consistent
// packages/staging/pluginDataDir paths — see the SECURITY note on `InstallAgentPluginRequired.layout`
// above for why this replaces accepting an already-resolved `AgentPluginWorkspaceLayout` directly.
// `forWorkspace` itself still throws for a syntactically invalid `workspaceId`, unchanged.
// Whether this install succeeded (bytes now live at `finalRoot`) or failed, the staging
// transaction directory itself must never be left behind — on success `rename` already moved
// `extractionRoot` out of it, so this only ever removes the (now-empty, or failure-abandoned)
// temp directory, never the published package.
  async function installAgentPlugin(
    required: InstallAgentPluginRequired,
    optional: InstallAgentPluginOptional = {}
  ): Promise<InstalledAgentPlugin> {
    const { archive, expectedSha256, archiveReader, layout, workspaceId } = required;

    const workspaceLayout = layout.forWorkspace({ workspaceId });

    if (archive.byteLength > LIMITS.maxArchiveBytes) {
      throw new AgentPluginInstallError({ code: "ARCHIVE_TOO_LARGE", message: `archive is ${archive.byteLength} bytes, over the ${LIMITS.maxArchiveBytes}-byte cap` });
    }

    const digest = sha256(archive);
    if (!SHA256_HEX_PATTERN.test(expectedSha256) || digest !== expectedSha256.toLowerCase()) {
      throw new AgentPluginInstallError({ code: "DIGEST_MISMATCH", message: `archive SHA-256 '${digest}' does not match the expected '${expectedSha256}' — refusing to extract unverified bytes` });
    }

    await mkdir(workspaceLayout.root, { recursive: true, mode: 0o700 });
    await persistentState.assertOwnedPath({ workspaceRoot: workspaceLayout.root, entryPath: "staging" });
    await mkdir(workspaceLayout.staging, { recursive: true, mode: 0o700 });
    await assertEntryCountWithinCap(archiveReader.entries({ archive }));
    const transactionRoot = await mkdtemp(path.join(workspaceLayout.staging, "install-"));
    const extractionRoot = path.join(transactionRoot, "root");
    await mkdir(extractionRoot, { mode: 0o700 });

    try {
      const executablePaths = await extractEntries(archiveReader.entries({ archive }), extractionRoot);
      const indexed = await indexInstalledRoot(extractionRoot, digest);
      if (optional.previewOnly) return indexed;

      return await persistentState.withIdentityLock({ workspaceRoot: workspaceLayout.root, run: async () => {
        await assertIdentityAvailable(workspaceLayout.root, indexed);
        const publishWithinPluginLock = () => persistentState.withPluginLock({ workspaceRoot: workspaceLayout.root, pluginId: indexed.pluginId, run: async () => {
          // Every install and replacement, not only an update, is a mutation of this plugin: an
          // unfinished update journal refuses it here, under the same plugin lock, because boot
          // recovery removes only the journal's own candidate digest and would otherwise restore the
          // old revision beside whatever this install published.
          // The journal lives under the layout this install was given, the one it publishes into.
          await settleAgentPluginUpdateJournal({ store: createAgentPluginUpdateStore({ ports: { ...ports, layout }, workspaceId, pluginId: indexed.pluginId }) });
          // Layout B needs the manifest id before choosing the package destination. Dedup still
          // skips publication and freezing, after one bounded staging extraction.
          // Owner decision 2026-10-04: learned facts begin empty for each site; author guidance stays
          // in package docs. Package extension files never seed learned memory or the user's notes.
          // Content-addressed dedup, scoped to THIS workspace's own tree (`workspaceLayout` was just
          // resolved above, atomically, from this same `workspaceId`): identical bytes were already
          // extracted, verified, and frozen by a prior install of this same workspace's — never
          // re-extracted for a different workspace, by construction, since a different workspace's
          // `workspaceLayout.packages` is a different path entirely. one bounded staging extraction precedes this check.
          // Publish BEFORE freezing permissions, not after: `rename()` moves `extractionRoot` as a single
          // directory-entry operation, and on this filesystem renaming an already-read-only (0o555)
          // directory itself fails EACCES (observed, not merely theoretical — see the regression test this
          // ordering fixed). Freezing after publish also closes a smaller race for free: nothing outside
          // this function can observe the package at its live path while it is still writable, because the
          // live path does not exist until `publish` returns.
          let publishedPlugin: InstalledAgentPlugin | undefined;
          const publishPackage = async (): Promise<InstalledAgentPlugin> => {
            // The manifest identifies the plugin only after bounded staging extraction (Layout B).
            const pluginId = indexed.pluginId;
            const packagesDir = workspaceLayout.pluginPackagesDir({ pluginId });
            await persistentState.assertOwnedPath({ workspaceRoot: workspaceLayout.root, entryPath: path.relative(workspaceLayout.root, packagesDir) });
            await mkdir(packagesDir, { recursive: true, mode: 0o700 });
            const finalRoot = await assertContainedOnDisk(packagesDir, digest);
            for (const directory of [workspaceLayout.pluginDataDir({ pluginId }),
              workspaceLayout.pluginMemoryDir({ pluginId, kind: 'learned' }),
              workspaceLayout.pluginMemoryDir({ pluginId, kind: 'notes' })]) {
              await persistentState.assertOwnedPath({ workspaceRoot: workspaceLayout.root, entryPath: path.relative(workspaceLayout.root, directory) });
              await mkdir(directory, { recursive: true, mode: 0o700 });
            }
            if (await isRealDirectory(finalRoot)) {
              publishedPlugin = await indexInstalledRoot(finalRoot, digest);
              return publishedPlugin;
            }
            await publish(extractionRoot, finalRoot);
            await freezeTree(finalRoot, executablePaths);
            /** Absolute, read-only (frozen) path to the extracted package root. */
            publishedPlugin = { ...indexed, packageRoot: finalRoot };
            return publishedPlugin;
          };
          const installed = await (optional.publishGuard ? optional.publishGuard({ plugin: indexed, publish: publishPackage }, {}) : publishPackage());
          if (publishedPlugin) await pruneSupersededRevisions({ workspaceRoot: workspaceLayout.root, installed: publishedPlugin });
          return installed;
        } });
        if (ports.identityAdmission) return ports.identityAdmission({ id: indexed.id!, localId: indexed.pluginId, run: publishWithinPluginLock }, {});
        return publishWithinPluginLock();
      } });
    } finally {

      await rm(transactionRoot, { recursive: true, force: true });
    }
  }

  /** The `(target '...')` suffix on the symlink-rejection message, or nothing when the entry carries
 * no `linkTarget` at all — split out purely to keep that `&&`/ternary pair out of
 * {@link extractOneEntry}'s own branch count. */
  function symlinkRejectionMessage(entry: AgentPluginArchiveEntry): string {
    const targetSuffix = "linkTarget" in entry && entry.linkTarget ? ` (target '${entry.linkTarget}')` : "";
    return `archive entry '${entry.entryPath}' has kind '${entry.kind}', which Agent Plugin packages are not permitted to contain${targetSuffix}`;
  }

  /** `normalizePackageEntryPath()`, with its thrown error re-shaped into the module's own
 * `AgentPluginInstallError` vocabulary. */
  function normalizeEntryPathOrThrow(entryPath: string): string {
    try {
      return normalizePackageEntryPath(entryPath);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "UNSAFE_ENTRY_PATH", message: `archive entry path is unsafe: '${entryPath}'` }, { cause: error });
    }
  }

  /** `assertContainedOnDisk()`, with its thrown error re-shaped the same way. */
  async function resolveContainedDestinationOrThrow(extractionRoot: string, normalized: string): Promise<string> {
    try {
      return await assertContainedOnDisk(extractionRoot, normalized);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "UNSAFE_ENTRY_PATH", message: `archive entry resolves outside the package root: '${normalized}'` }, {
        cause: error instanceof PackagePathViolation ? error : undefined,
      });
    }
  }

  /**
 * Applies every hardening rule in this module's header to one archive entry: symlink rejection,
 * path normalization, duplicate detection, containment, the per-file size cap, and (for a file
 * entry) the actual write. Returns the running total-extracted-bytes count, since that is the one
 * piece of `extractEntries`'s loop state a single entry's processing can change.
 */
// Refused BEFORE path normalization: a symlink entry is never acceptable regardless of how
// "safe" its own name looks, matching the ecosystem fix this module's header cites — validating
// where a permitted symlink might point is more attack surface than refusing the entry kind.
  async function extractOneEntry(args: {
    entry: AgentPluginArchiveEntry;
    extractionRoot: string;
    seen: Set<string>;
    executablePaths: Set<string>;
    totalBytesSoFar: number;
  }): Promise<number> {
    const { entry, extractionRoot, seen, executablePaths, totalBytesSoFar } = args;

    if (entry.kind !== "file" && entry.kind !== "directory") {
      throw new AgentPluginInstallError({ code: "SYMLINK_ENTRY_REJECTED", message: symlinkRejectionMessage(entry) });
    }

    const normalized = normalizeEntryPathOrThrow(entry.entryPath);

    if (seen.has(normalized)) {
      throw new AgentPluginInstallError({ code: "DUPLICATE_ENTRY", message: `duplicate archive entry '${normalized}' — refusing a second write over an already-vetted first one` });
    }
    seen.add(normalized);

    const destination = await resolveContainedDestinationOrThrow(extractionRoot, normalized);

    if (entry.kind === "directory") {
      await mkdir(destination, { recursive: true, mode: 0o700 });
      return totalBytesSoFar;
    }

    if ((entry.declaredSize ?? 0) > LIMITS.maxFileBytes) {
      throw new AgentPluginInstallError({ code: "FILE_TOO_LARGE", message: `archive file '${normalized}' declares ${entry.declaredSize} bytes, over the ${LIMITS.maxFileBytes}-byte cap` });
    }

    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const totalBytes = await writeContainedFile({
      destination,
      normalized,
      stream: entry.openReadStream({}),
      totalBytesSoFar,
    });

    if (entry.executable) executablePaths.add(normalized);
    return totalBytes;
  }

  /**
   * Refuses a "million small files" archive from entry metadata alone, before a staging
   * transaction exists. Checking only inside the extraction loop meant an over-cap archive first
   * had the cap's worth of files contained, written and then deleted again. Every reader derives
   * its entries from the archive bytes, so a second iteration costs one central-directory walk
   * and opens no content stream.
   */
  /** Ported from Jini 78d4b60b: reject from metadata before a staging transaction exists.
 * A second central-directory walk opens no content streams and avoids over-cap disk churn. */
  async function assertEntryCountWithinCap(entries: AsyncIterable<AgentPluginArchiveEntry>): Promise<void> {
    // Only the count matters, so the entries are stepped through without being bound to a name.
    // Leaving early closes the walk the way for-await would, without letting a failing close
    // replace the cap error.
    const iterator = entries[Symbol.asyncIterator]();
    let entryCount = 0;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      entryCount += 1;
      if (entryCount > LIMITS.maxEntries) {
        await Promise.resolve(iterator.return?.()).catch(() => undefined);
        throw tooManyEntriesError();
      }
    }
  }

  function tooManyEntriesError(): AgentPluginInstallError {
    return new AgentPluginInstallError({ code: "TOO_MANY_ENTRIES", message: `archive exceeds the ${LIMITS.maxEntries}-entry cap` });
  }

  /** Extracts every entry into `extractionRoot`, enforcing every hardening rule in this module's
 * header. Returns the set of archive-relative paths the archive marked executable, for
 * {@link freezeTree} to preserve the `+x` bit on. */
  async function extractEntries(
    entries: AsyncIterable<AgentPluginArchiveEntry>,
    extractionRoot: string,
  ): Promise<ReadonlySet<string>> {
    const seen = new Set<string>();
    const executablePaths = new Set<string>();
    let entryCount = 0;
    let totalBytes = 0;

    for await (const entry of entries) {
      entryCount += 1;
      // Still enforced here: the pre-pass trusts the reader to yield the same entries twice.
      if (entryCount > LIMITS.maxEntries) throw tooManyEntriesError();

      totalBytes = await extractOneEntry({ entry, extractionRoot, seen, executablePaths, totalBytesSoFar: totalBytes });
    }

    return executablePaths;
  }

  /** Streams one file entry to disk, bounding both its own size and the running archive total against
 * bytes ACTUALLY observed — never the archive format's declared size, which a decompression bomb
 * lies about by construction. `O_EXCL` refuses to write over anything already at `destination`
 * (there cannot legitimately be one — `extractEntries`'s duplicate check already refused a second
 * entry for the same path); `O_NOFOLLOW` refuses to follow a final-component symlink if the
 * filesystem somehow already had one (defense in depth — this module never creates one itself). */
  async function writeContainedFile(params: {
    destination: string;
    normalized: string;
    stream: AsyncIterable<Uint8Array>;
    totalBytesSoFar: number;
  }): Promise<number> {
    let flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
    if (ports.process.platform !== "win32") flags |= constants.O_NOFOLLOW;

    const handle = await open(params.destination, flags, 0o600);
    let fileBytes = 0;
    let totalBytes = params.totalBytesSoFar;

    try {
      for await (const chunk of params.stream) {
        fileBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;

        if (fileBytes > LIMITS.maxFileBytes) {
          throw new AgentPluginInstallError({ code: "DECOMPRESSION_BOMB", message: `archive file '${params.normalized}' exceeded the ${LIMITS.maxFileBytes}-byte cap while decompressing — its declared size was a lie` });
        }
        if (totalBytes > LIMITS.maxTotalExtractedBytes) {
          throw new AgentPluginInstallError({ code: "TOTAL_SIZE_EXCEEDED", message: `archive exceeds the ${LIMITS.maxTotalExtractedBytes}-byte total extracted-size cap` });
        }

        await handle.write(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
      }
    } finally {
      await handle.close();
    }

    return totalBytes;
  }

  /** Makes every file/directory under `root` read-only (executables keep `+x`, per the Agent Plugins
 * spec's own MCP `command` needing to launch a `./`-relative script — not exercised by anything in
 * this slice, since MCP execution is out of scope for v1, but the bit is preserved now rather than
 * silently dropped for whenever it is).
 *
 * Stated plainly rather than implied (`mcp-federation/trust.ts`'s own "what this tier deliberately
 * does NOT claim" discipline): this is best-effort defense against an ACCIDENTAL same-process write
 * into what is supposed to be a read-only `PLUGIN_ROOT`, not a security boundary against a
 * determined attacker already running code as this same OS user — that user can `chmod` again. */
  async function freezeTree(root: string, executables: ReadonlySet<string>, prefix = ""): Promise<void> {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(root, entry.name);

      if (entry.isDirectory()) {
        await freezeTree(absolute, executables, relative);
        await chmod(absolute, 0o555);
      } else {
        await chmod(absolute, executables.has(relative) ? 0o555 : 0o444);
      }
    }
    await chmod(root, 0o555);
  }

  /** Publishes `extractionRoot` to `finalRoot` by rename — atomic on the same filesystem, so a reader
   * can never observe a partially-extracted package at the live path. Tolerates losing a race against
   * a concurrent install of the byte-identical digest (the same content, published a moment earlier by
   * another process) rather than treating that as a failure. */
  // macOS reports EACCES, rather than ENOTEMPTY, when the winning install has already
  // frozen its destination directory. Still require a real directory below: a permission
  // failure with no published winner must remain PUBLISH_FAILED.
  async function publish(extractionRoot: string, finalRoot: string): Promise<void> {
    try {
      await rename(extractionRoot, finalRoot);
    } catch (error) {

      if (!isErrnoException(error) || (error.code !== "EEXIST" && error.code !== "ENOTEMPTY" && error.code !== "EACCES")) {
        throw new AgentPluginInstallError({ code: "PUBLISH_FAILED", message: `failed to publish the extracted package to '${finalRoot}'` }, { cause: error });
      }
      if (!(await isRealDirectory(finalRoot))) {
        throw new AgentPluginInstallError({ code: "PUBLISH_FAILED", message: `'${finalRoot}' exists but is not a real, published package directory` }, { cause: error });
      }
      // Lost the race to a concurrent install of identical bytes — the bytes at `finalRoot` are the
      // ones this install itself would have written, so this is not a failure.
    }
  }

  async function isRealDirectory(target: string): Promise<boolean> {
    try {
      const info = await stat(target);
      return info.isDirectory();
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  function sha256(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && "code" in error;
  }

  return { maxAgentPluginInstallArchiveBytes, installAgentPlugin, indexInstalledRoot };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createInstallModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
