/**
 * @file The per-workspace ledger of WHICH installed digest each bundled Agent Plugin currently
 * ships as — written by `seed-bundled.ts` on every boot, read by the surfaces that have to pick one
 * installed package for a plugin id.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 * `packages/sha256/<digest>/` is content-addressed and nothing retires an entry, so shipping a NEW
 * VERSION of an already-installed bundled plugin lands it ALONGSIDE the old one. Both consumption
 * surfaces then refuse that plugin outright as ambiguous — `resolve-agent-plugin-refs.ts`'s
 * "refusing to guess which one to use" and `tool-registrations.ts`'s `poisonedPluginIds`. A product
 * upgrade therefore broke every enabled bundled plugin whose bytes it touched, silently, on the next
 * boot. Observed live: `higgsfield-media` (2 digests, enabled, tools gone), `supabase` (3 digests,
 * dormant), and `github` one boot away from the same fate.
 *
 * ---------------------------------------------------------------------------
 * Why a ledger rather than deleting, or than "prefer the newest"
 * ---------------------------------------------------------------------------
 * The ambiguity refusal itself is deliberate and stays exactly as it was — `resolve-agent-plugin-
 * refs.ts`'s header argues at length that silently picking one (the lexicographically-last, the
 * newest mtime, whatever hashed later) would be a WORSE failure mode than an explicit error, because
 * a wrong plugin's content would reach the agent and nothing about the run would look wrong. That
 * reasoning is untouched here. What changes is that for a BUNDLED plugin there is now something
 * authoritative to consult instead of guessing: the build's own seed recorded which digest it
 * published. A digest wins because the host shipped it, never because it sorted first.
 *
 * Three consequences worth stating plainly, because each one is a refusal this file deliberately
 * keeps:
 *
 * 1. **An id with no ledger entry is still ambiguous.** Two digests of a plugin the seeder never
 *    seeded — an operator's own installs — remain an explicit error. Nothing here has any authority
 *    over a package the host did not put on disk.
 * 2. **A ledger entry that names a digest which is not installed decides nothing.** The named digest
 *    has to be present, and be exactly one of the candidates, or the ambiguity stands.
 * 3. **An unreadable ledger reads as an empty one.** That is fail-CLOSED here, unlike
 *    `activation.ts`'s own lenient reader: an empty ledger names no winner, so every ambiguity stays
 *    an error. This file can only ever resolve an ambiguity, never create one.
 *
 * ---------------------------------------------------------------------------
 * Nothing is deleted, moved, or renamed
 * ---------------------------------------------------------------------------
 * A superseded digest's bytes stay exactly where they are. Retiring by moving directories out of a
 * live `packages/sha256/` at boot was the other candidate design and was rejected: it mutates the
 * operator's package store on a code path whose whole job is supposed to be idempotent, it races
 * anything mid-read, and — since a digest's provenance is NOT recorded per-digest anywhere — a
 * workspace that already held an operator's own install under a bundled plugin's id could have had
 * that operator's bytes moved aside by an inference. Preferring a digest at READ time disturbs
 * nothing and is undone by deleting one small JSON file. The cost is disk: superseded packages
 * accumulate until an operator prunes them, which is their call to make and reversible either way.
 *
 * Architectural role:
 * Owns one small JSON file and one pure selection rule. No knowledge of activation, installation, or
 * tools — `seed-bundled.ts` is the only writer (plus `retire-bundled.ts`, which it calls in the same
 * boot step), and the read side is two call sites that already
 * hold both a workspace root and a list of installed packages.
 */
/** Where a workspace's bundled-digest ledger lives, beside `activation.ts`'s `activations.json` and
 *  for the same reason: it is a fact about this workspace, not about a package. */
/** The same 64-lowercase-hex shape `resolve-agent-plugin-refs.ts` requires of an installed package
 *  directory name. A ledger entry that does not match it could never name a real install. */
/** The Agent Plugins name grammar, as `activation.ts` and `layout.ts` both already enforce it. */
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export const BUNDLED_DIGESTS_FILENAME = "bundled-digests.json";

/** Plugin id -> the archive digest this build seeded for it. Empty whenever nothing is recorded, or
 *  whenever the record cannot be read — see this file's header, consequence 3. */
export type BundledAgentPluginDigests = ReadonlyMap<string, string>;

/** One plugin's seed, as {@link recordBundledAgentPluginDigests} takes it — the pair `seed-
 *  bundled.ts` already holds after a successful install. */
export interface SeededBundledAgentPluginDigest {
  readonly pluginId: string;
  readonly archiveDigest: string;
}

/** The narrow slice of an `InstalledAgentPlugin` {@link preferBundledAgentPluginDigests} reads, so
 *  callers holding richer shapes keep their own types through it. */
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

  /**
 * Reads one workspace's bundled-digest ledger.
 *
 * @param workspaceRoot - `AgentPluginWorkspaceLayout.root`, never an instance-level path.
 * @returns The recorded plugin-id -> digest map, or an EMPTY map for a missing, unreadable,
 * malformed, or wrong-version file. Malformed INDIVIDUAL entries are skipped rather than discarding
 * the whole ledger, matching `activation.ts`'s own per-entry discipline.
 * @throws Nothing. An empty answer is always safe: it names no winner, so every ambiguity this
 * module could have resolved simply stays the explicit error it already was.
 * @complexity One file read plus O(p) in the recorded plugin count.
 */
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

  /**
 * Validates an already-`JSON.parse`d ledger value, dropping anything that does not match the shape.
 * Pure, so the parsing rules are assertable without touching a filesystem.
 *
 * @complexity O(p) in the entry count.
 */
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

  /**
 * Records the digest this boot seeded for each bundled plugin, merged over whatever was already
 * recorded.
 *
 * MERGED, not replaced, for failure isolation (the property `seed-bundled.ts`'s header names): a
 * plugin that failed to seed this boot — an unreadable source directory, a transient I/O fault —
 * must not lose the perfectly good entry an earlier boot wrote for it, which is what a wholesale
 * rewrite of only this boot's successes would do.
 *
 * A plugin id seeded TWICE in one run under two different digests (two bundled source directories
 * declaring the same manifest `name`) is dropped from the ledger entirely, prior entry included:
 * the build itself is ambiguous about what it ships, so there is nothing authoritative to record and
 * the explicit ambiguity refusal downstream is the correct outcome.
 *
 * @param seeded - One entry per successfully seeded plugin. An empty list writes nothing at all —
 * not even an empty file — so a boot that seeded nothing cannot create a workspace directory or
 * truncate an existing ledger.
 * @throws {Error} Any filesystem fault from the write. The caller (`seed-bundled.ts`) captures it
 * into its report rather than failing the boot.
 * @complexity One file read and one atomic write, O(p) in the recorded plugin count.
 */
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

  /**
 * This boot's verdict per plugin id: the digest it seeded, or `undefined` when the run seeded the
 * same id under two different digests and therefore has no authoritative answer for it.
 *
 * Split out as a pure step so the "a self-contradictory build records NOTHING" rule is assertable
 * without a filesystem, and so {@link recordBundledAgentPluginDigests} reads as merge-then-write.
 *
 * @complexity O(n) in the seeded-entry count.
 */
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

  /**
 * Drops one plugin id from the ledger — for `retire-bundled.ts`, once a retired bundled plugin's
 * packages are gone and no build will ever seed it again.
 *
 * Every other entry is kept byte-for-byte, `seededAt` included: this rewrites the raw `plugins` bag
 * rather than the normalized map, so it cannot lose a field a later schema adds. A missing,
 * unreadable, malformed, or wrong-version ledger, or one with no entry for `pluginId`, writes
 * nothing — there is nothing to drop, and a fail-closed reader already treats such a file as empty.
 *
 * @returns Whether an entry was removed.
 * @throws {Error} Any filesystem fault from the write. `retire-bundled.ts` captures it into its report.
 * @complexity One file read and at most one atomic write, O(p) in the recorded plugin count.
 */
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

  /** Temp-file-then-`rename`, so a reader never observes a half-written ledger and a crash mid-write
 *  leaves the previous one intact — the same durability shape `activation.ts`'s
 *  `writeActivationsAtomically` uses, minus its cross-process lock: this file has exactly one writer
 *  (the boot seeder, retirement included), and two concurrent boots of the SAME build write byte-identical content.
 *  @complexity One write and one rename. */
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

  /**
 * Drops the SUPERSEDED installs of any bundled plugin id from a list of installed packages, leaving
 * every other entry — and every other plugin id — exactly as it was.
 *
 * An id is narrowed only when all three hold: it has more than one installed digest, the ledger
 * records a digest for it, and exactly one of its installed digests is that recorded one. Anything
 * else passes through untouched, so the caller's own ambiguity refusal still fires for every case
 * this module has no authority over (this file's header, consequences 1 and 2).
 *
 * Applied at READ time by the surfaces that must pick one package per plugin id. Deliberately NOT
 * folded into `listInstalledPlugins` itself: `uninstall.ts` needs to see EVERY digest of a plugin to
 * remove them, and a filter hidden inside the shared walk would make superseded bytes unremovable.
 *
 * @returns A list in the input's own order, with superseded entries removed. The input is never
 * mutated.
 * @complexity O(n) in the installed-package count, over one O(n) pre-pass that counts digests per
 * plugin id.
 */
  function preferBundledAgentPluginDigests<T extends InstalledDigestIdentity>(
    installed: readonly T[],
    bundled: BundledAgentPluginDigests,
  ): readonly T[] {
    if (bundled.size === 0) return installed;

    const supersededIds = idsNarrowableToTheirBundledDigest(installed, bundled);
    if (supersededIds.size === 0) return installed;

    return installed.filter((plugin) => !supersededIds.has(plugin.pluginId) || plugin.archiveDigest === bundled.get(plugin.pluginId));
  }

  /**
 * The plugin ids whose installed digests the ledger can authoritatively narrow to one — every id
 * that is installed under several digests, exactly one of which is the digest this build seeded.
 *
 * @complexity O(n) in the installed-package count.
 */
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

  /** Whether `value` is a plain (non-null, non-array) object — the shape both this file's JSON-adjacent
 *  values must have before their own fields are worth looking at. Duplicated from `activation.ts`'s
 *  private helper of the same name rather than widening that module's public surface, matching this
 *  codebase's own precedent for small private formatting/shape helpers (see `resolve-agent-plugin-
 *  refs.ts`'s note on `humanize()`). */
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
