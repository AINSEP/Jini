/**
 * @file Turns a bundled Agent Plugin's SOURCE DIRECTORY (tracked in this repo, shipped in the
 * product) into the `{ archive: Uint8Array, expectedSha256, archiveReader }` triple
 * `installAgentPlugin` requires — so a pre-placed package goes through the exact same install path
 * as one downloaded from a URL, rather than around it.
 *
 * ---------------------------------------------------------------------------
 * Why not just copy the directory
 * ---------------------------------------------------------------------------
 * Because `installAgentPlugin` is where every guarantee lives: lexical and symlink zip-slip
 * refusal, entry/file/total-byte caps, atomic staging-then-publish, `chmod 0o555` freezing,
 * content-addressed dedup, and the tenant-scoped `forWorkspace()` resolution that makes it
 * impossible to publish into another workspace's tree. A `cp -R` in a seeder would reimplement
 * none of them, and every one it skipped would be a guarantee that silently applies to
 * operator-installed plugins and not to the one the host ships itself.
 *
 * The obstacle is only that `installAgentPlugin` speaks archives, and a directory is not one.
 * {@link packAgentPluginDirectory} therefore serialises the directory into a tiny, deterministic
 * archive format, and {@link createBundledSourceArchiveReader} reads it back — a round trip, not a
 * bypass. `yauzl`/`yazl` were the obvious alternative and are wrong here: `yazl` is a
 * devDependency used only by dev tooling and test fixtures (`development/scripts/package-agent-plugin.ts`
 * says so in its own header, "must never be imported by production code"), and DEFLATE would make
 * the digest depend on a compressor's version rather than on the bytes.
 *
 * ---------------------------------------------------------------------------
 * The digest is a real content digest
 * ---------------------------------------------------------------------------
 * `installAgentPlugin` verifies `sha256(archive) === expectedSha256` before extracting anything, and
 * uses that digest as the content address. Because this format is byte-deterministic — sorted
 * paths, explicit lengths, no timestamps, no permissions, no compression — the digest is a genuine
 * function of the package's own file contents and names. Two builds of the same source tree produce
 * the same digest, which is what makes seeding idempotent (`install.ts`'s `alreadyPublished` fast
 * path) instead of re-extracting on every boot.
 *
 * Architectural role:
 * One directory walk (the only I/O) plus a pure encoder/decoder pair. `seed-bundled.ts` composes it
 * with `installAgentPlugin`.
 */
/** Magic + version line. A reader that does not see this refuses rather than guessing. */
/** Guards a caller that points this at the wrong directory (a `node_modules`, a whole repo). Well
 *  above any real plugin; below `install.ts`'s own `maxEntries` of 4096 so the friendlier error
 *  comes from here. */
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import { createPackagePathsModule } from "./package-paths.js";
import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from "./install.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export interface PackedAgentPluginArchive {
  /** Bundled archive bytes, or a 32-byte canonical token requiring the paired archiveReader. */
  readonly bytes: Uint8Array;

  /** Lowercase hex SHA-256 of {@link bytes} — passed straight to `installAgentPlugin`'s
   *  `expectedSha256`, which recomputes and compares it rather than trusting it. */
  readonly sha256: string;

  /** Package-relative POSIX paths included, sorted — the bundled-v1 encoding uses this order. */
  readonly files: readonly string[];
  /** Paired snapshot reader for canonical-files-v1 tokens; absent for bundled-v1. */
  readonly archiveReader?: AgentPluginArchiveReaderPort;
}

/** Opt-in source selection, resource bounds and archive identity. Omission preserves bundled-v1. */
export interface PackAgentPluginDirectoryOptional {
  /** Exact package-relative files or directory subtrees. Empty selects nothing. An explicit path
   * and its ancestors override excludeNames; excluded descendants of a selected subtree still skip.
   * Suffix exclusions and default test skips win even over explicit paths. */
  readonly allowPaths?: readonly string[];
  /** Entry basenames excluded at every depth unless explicitly allowed (or needed to reach one). */
  readonly excludeNames?: readonly string[];
  /** Case-sensitive path suffixes excluded at every depth, including directories and explicit paths. */
  readonly excludeSuffixes?: readonly string[];
  /** Include __tests__ directories and .test./.spec. files. Defaults to false; other filters still apply. */
  readonly includeTests?: boolean;
  /** Nonnegative safe integers; root depth is zero. Supplied bounds fail rather than truncate. */
  readonly limits?: {
    readonly maxEntries: number;
    readonly maxDepth: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxArchiveBytes: number;
  };
  readonly symlinkPolicy?: 'skip' | 'reject';
  readonly specialFilePolicy?: 'skip' | 'reject';
  /** canonical-files-v1 returns a digest token and a reader bound to the captured source snapshot. */
  readonly digestEncoding?: 'bundled-v1' | 'canonical-files-v1';
}

interface PackingState {
  readonly options: PackAgentPluginDirectoryOptional;
  readonly allowPaths: readonly string[] | undefined;
  readonly excluded: ReadonlySet<string>;
  readonly files: Set<string>;
  entries: number;
  totalBytes: number;
  archiveBytes: number;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const MAGIC = ports.bundledArchiveMagic;

  const MAX_SOURCE_FILES = 2048;
  const { normalizePackageEntryPath } = createPackagePathsModule(ports);

  /**
 * Serialises runtime regular files under `sourceDir` into one deterministic archive.
 *
 * By default, symlinks and any other non-regular entry are skipped rather than followed: a bundled package is
 * this repository's own tracked content, so a symlink in it would be a mistake, and following one
 * is the exact vector `install.ts` refuses on the extraction side. Skipping keeps the two sides
 * agreeing instead of producing an archive the installer would then reject.
 * Optional policies can reject these entries; supplied limits bound traversal and handle reads.
 *
 * @throws {Error} If the tree holds more than {@link MAX_SOURCE_FILES} files.
 * @throws Propagates `readdir`/`readFile` errors — a bundled package that cannot be read is a build
 * defect, not a runtime condition to degrade around.
 * @complexity O(f log f + b) for sorting f selected files and reading b bytes, plus traversal.
 * Supplied limits bound source I/O; `install.ts` independently retains its extraction ceilings.
 */
  async function packAgentPluginDirectory(sourceDir: string, options: PackAgentPluginDirectoryOptional = {}): Promise<PackedAgentPluginArchive> {
    const state = createPackingState({ options });
    assertPackingLimit({ state, name: 'maxArchiveBytes', value: state.archiveBytes });
    await refuseRoot({ sourceDir, state });
    const relativePaths = (await listRegularFiles({ dir: sourceDir, prefix: '', depth: 0, state })).sort();
    assertSourceFileCount({ relativePaths, sourceDir });

    const chunks: Buffer[] = [Buffer.from(MAGIC, "utf8")];
    const snapshot: { entryPath: string; content: Buffer }[] = [];
    const canonical = options.digestEncoding === 'canonical-files-v1';
    const digest = createHash('sha256');
    for (const relativePath of relativePaths) {
      const content = options.limits
        ? await readBoundedFile({ sourceDir, relativePath, state })
        : await readFile(path.join(sourceDir, relativePath));
      const pathBytes = Buffer.from(relativePath, "utf8");
      if (canonical) {
        digest.update(JSON.stringify([relativePath, content.byteLength]), 'utf8').update(content);
        snapshot.push({ entryPath: relativePath, content });
      } else {
        chunks.push(Buffer.from(`F ${pathBytes.byteLength} ${content.byteLength}\n`, "utf8"), pathBytes, content);
      }
      state.totalBytes += content.byteLength;
      if (!canonical) state.archiveBytes += encodedFileBytes({ relativePath, fileBytes: content.byteLength });
    }

    const bytes = canonical ? digest.digest() : Buffer.concat(chunks);
    return {
      bytes: new Uint8Array(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      files: relativePaths,
      ...(canonical ? { archiveReader: createSnapshotReader({ token: bytes, snapshot }) } : {}),
    };
  }

  function assertSourceFileCount({ relativePaths, sourceDir }: { relativePaths: readonly string[]; sourceDir: string }): void {
    if (relativePaths.length > MAX_SOURCE_FILES) {
      throw new Error(
        `bundled agent plugin at '${sourceDir}' has ${relativePaths.length} files, over the ${MAX_SOURCE_FILES}-file cap — is this the right directory?`,
      );
    }
  }

  /** Validate caller bounds before I/O and normalize selection through the package path owner. */
  function createPackingState({ options }: { options: PackAgentPluginDirectoryOptional }): PackingState {
    if (options.limits) {
      for (const name of ['maxEntries', 'maxDepth', 'maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxArchiveBytes'] as const) {
        const value = options.limits[name];
        if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid packing limit ${name}`);
      }
    }
    return {
      options,
      // A directory written as 'dist/' selects the same subtree as 'dist' (normalize already collapsed '//').
      allowPaths: options.allowPaths?.map(value => normalizePackageEntryPath(value).replace(/\/$/, '')),
      excluded: new Set(options.excludeNames ?? []),
      files: new Set(), entries: 0, totalBytes: 0,
      archiveBytes: options.digestEncoding === 'canonical-files-v1' ? 32 : Buffer.byteLength(MAGIC),
    };
  }

  /** Only a reject policy refuses a non-directory root. Otherwise the root is read as before:
   * readdir follows a symlinked root, so any options object (even all-undefined) keeps legacy output. */
  async function refuseRoot({ sourceDir, state }: { sourceDir: string; state: PackingState }): Promise<void> {
    if (state.options.symlinkPolicy !== 'reject' && state.options.specialFilePolicy !== 'reject') return;
    const stat = await ports.filesystem.lstat(sourceDir);
    if (!stat.isDirectory()) refuseEntry({ state, entryPath: sourceDir, symlink: stat.isSymbolicLink() });
  }

  function assertPackingLimit({ state, name, value }: {
    state: PackingState; name: keyof NonNullable<PackAgentPluginDirectoryOptional['limits']>; value: number;
  }): void {
    const limit = state.options.limits?.[name];
    if (limit !== undefined && value > limit) throw new Error(`bundled agent plugin exceeds packing ${name} (${limit})`);
  }

  function encodedFileBytes({ relativePath, fileBytes }: { relativePath: string; fileBytes: number }): number {
    const pathBytes = Buffer.byteLength(relativePath);
    return Buffer.byteLength(`F ${pathBytes} ${fileBytes}\n`) + pathBytes + fileBytes;
  }

  /** Check actual read bytes before retaining a chunk, including the bundled header/path overhead. */
  function checkFileBudget({ state, relativePath, fileBytes }: { state: PackingState; relativePath: string; fileBytes: number }): void {
    assertPackingLimit({ state, name: 'maxFileBytes', value: fileBytes });
    assertPackingLimit({ state, name: 'maxTotalBytes', value: state.totalBytes + fileBytes });
    const archiveBytes = state.options.digestEncoding === 'canonical-files-v1'
      ? state.archiveBytes : state.archiveBytes + encodedFileBytes({ relativePath, fileBytes });
    assertPackingLimit({ state, name: 'maxArchiveBytes', value: archiveBytes });
  }

  /** Bounded handle reads also detect growing files; every success/failure closes the handle.
   * @throws Propagates filesystem failures and rejects a changed file kind or any exceeded cap.
   * @complexity O(b) bytes read, O(b) captured bytes within the supplied file/total/archive caps. */
  async function readBoundedFile({ sourceDir, relativePath, state }: {
    sourceDir: string; relativePath: string; state: PackingState;
  }): Promise<Buffer> {
    const { handle, stat } = await openWalkedFile({ target: path.join(sourceDir, relativePath), relativePath });
    try {
      checkFileBudget({ state, relativePath, fileBytes: stat.size });
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      for (;;) {
        const limits = state.options.limits!;
        const remaining = Math.min(limits.maxFileBytes - fileBytes, limits.maxTotalBytes - state.totalBytes - fileBytes);
        const buffer = Buffer.alloc(Math.min(64 * 1024, remaining + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
        if (bytesRead === 0) return Buffer.concat(chunks, fileBytes);
        fileBytes += bytesRead;
        checkFileBudget({ state, relativePath, fileBytes });
        chunks.push(buffer.subarray(0, bytesRead));
      }
    } finally {
      await handle.close();
    }
  }

  /** O_NOFOLLOW/O_NONBLOCK do not exist on Windows, so no-follow cannot rest on open flags alone:
   * the opened object must also be the regular file the walk lstat'ed (same dev/ino). A link or file
   * swapped in between is refused, failing closed on every platform. Refusals close the handle. */
  async function openWalkedFile({ target, relativePath }: { target: string; relativePath: string }) {
    const walked = await ports.filesystem.lstat(target);
    const handle = await ports.filesystem.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await handle.stat();
      if (!walked.isFile() || !stat.isFile() || stat.dev !== walked.dev || stat.ino !== walked.ino) {
        throw new Error(`bundled agent plugin source is no longer a regular file: '${relativePath}'`);
      }
      return { handle, stat };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  /** A token identifies only this snapshot. Copy yielded bytes so a reader cannot mutate later reads. */
  function createSnapshotReader({ token, snapshot }: {
    token: Buffer; snapshot: readonly { entryPath: string; content: Buffer }[];
  }): AgentPluginArchiveReaderPort {
    return {
      async *entries({ archive }) {
        if (!token.equals(archive)) throw new Error('bundled agent plugin archive: snapshot token mismatch');
        for (const { entryPath, content } of snapshot) {
          yield { kind: 'file', entryPath, declaredSize: content.byteLength,
            openReadStream: () => onceAsyncIterable(new Uint8Array(content)) };
        }
      },
    };
  }

  /**
 * Reads the format {@link packAgentPluginDirectory} writes, as an `AgentPluginArchiveReaderPort`.
 *
 * Yields only `kind: "file"` entries — the format has no directory, symlink, or device entries to
 * represent, which is itself a small safety property: the whole class of entry `install.ts` rejects
 * cannot be expressed in an archive this reader produces.
 *
 * @complexity O(n) in the archive's byte length; each file's bytes are yielded once, not copied
 * into an intermediate list.
 */
  function createBundledSourceArchiveReader(): AgentPluginArchiveReaderPort {
    return {
      entries({ archive }: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry> {
        return readEntries(archive);
      },
    };
  }

  async function* readEntries(archive: Uint8Array): AsyncIterable<AgentPluginArchiveEntry> {
    const buffer = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
    const magic = Buffer.from(MAGIC, "utf8");
    if (buffer.byteLength < magic.byteLength || !buffer.subarray(0, magic.byteLength).equals(magic)) {
      throw new Error("bundled agent plugin archive: bad magic — this reader only understands the configured bundled archive format");
    }

    let offset = magic.byteLength;
    while (offset < buffer.byteLength) {
      const newlineIndex = buffer.indexOf(0x0a, offset);
      if (newlineIndex === -1) throw new Error("bundled agent plugin archive: truncated entry header");

      const header = buffer.subarray(offset, newlineIndex).toString("utf8");
      const match = /^F (\d+) (\d+)$/.exec(header);
      if (!match) throw new Error(`bundled agent plugin archive: malformed entry header '${header}'`);

      const pathLength = Number(match[1]);
      const contentLength = Number(match[2]);
      const pathStart = newlineIndex + 1;
      const contentStart = pathStart + pathLength;
      const contentEnd = contentStart + contentLength;
      if (contentEnd > buffer.byteLength) throw new Error("bundled agent plugin archive: truncated entry body");

      const entryPath = buffer.subarray(pathStart, contentStart).toString("utf8");
      const content = buffer.subarray(contentStart, contentEnd);

      yield {
        kind: "file",
        entryPath,
        declaredSize: contentLength,
        openReadStream: () => onceAsyncIterable(new Uint8Array(content)),
      };

      offset = contentEnd;
    }
  }

  /** One-shot async iterable over a single chunk — the shape `AgentPluginArchiveEntry.openReadStream`
 *  wants, without pulling in a stream implementation for an already-in-memory buffer. */
  async function* onceAsyncIterable(chunk: Uint8Array): AsyncIterable<Uint8Array> {
    yield chunk;
  }

  /**
 * Lists runtime regular files under `dir`, as POSIX-style package-relative paths.
 * By default, test directories and test/spec files are excluded so test-only edits cannot change installed
 * runtime contents or their content-addressed digest.
 *
 * @complexity O(e * (a + s)) selection checks for e entries, a allowlist paths and s suffixes.
 * Path comparison cost scales with path length; selection uses O(1) auxiliary space per entry.
 */
  async function listRegularFiles({ dir, prefix, depth, state }: {
    dir: string; prefix: string; depth: number; state: PackingState;
  }): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    state.entries += entries.length;
    assertPackingLimit({ state, name: 'maxEntries', value: state.entries });
    const files: string[] = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isNameExcluded({ name: entry.name, relative, directory: entry.isDirectory(), state })) continue;
      if (!selectPath({ relative, directory: entry.isDirectory(), state })) continue;
      if (entry.isDirectory()) {
        files.push(...await directoryEntryFiles({ name: entry.name, dir, relative, depth, state }));
      } else {
        files.push(...regularEntryFiles({ entry, relative, state }));
      }
      // Symlinks and everything else: skipped by default. See this function's own doc.
    }
    return files;
  }

  async function directoryEntryFiles({ name, dir, relative, depth, state }: { name: string; dir: string; relative: string; depth: number; state: PackingState }): Promise<string[]> {
    if (name === '__tests__' && !state.options.includeTests) return [];
    assertPackingLimit({ state, name: 'maxDepth', value: depth + 1 });
    return listRegularFiles({ dir: path.join(dir, name), prefix: relative, depth: depth + 1, state });
  }

  function regularEntryFiles({ entry, relative, state }: { entry: { name: string; isFile(): boolean; isSymbolicLink(): boolean }; relative: string; state: PackingState }): string[] {
    if (entry.isFile() && (state.options.includeTests || !/\.(test|spec)\./.test(entry.name))) {
      recordFile({ relative, state });
      return [relative];
    }
    if (!entry.isFile()) refuseEntry({ state, entryPath: relative, symlink: entry.isSymbolicLink() });
    return [];
  }

  function recordFile({ relative, state }: { relative: string; state: PackingState }): void {
    state.files.add(relative);
    assertPackingLimit({ state, name: 'maxFiles', value: state.files.size });
  }

  /** An exact allow-path reopens excluded ancestors without reopening unrelated siblings.
   * A selected subtree does not implicitly override name exclusions farther down that subtree.
   * @complexity O(a * p) time for a allow-paths of length p, O(1) space. No I/O or mutation. */
  function isNameExcluded({ name, relative, directory, state }: {
    name: string; relative: string; directory: boolean; state: PackingState;
  }): boolean {
    return state.excluded.has(name) && !state.allowPaths?.some(allowed =>
      relative === allowed || (directory && allowed.startsWith(`${relative}/`)));
  }

  /** Ancestors of an allowed path must be traversed, but their unrelated siblings are pruned.
   * Suffix exclusions always win. O((a + s) * p) time, O(1) space; no I/O or mutation. */
  function selectPath({ relative, directory, state }: { relative: string; directory: boolean; state: PackingState }): boolean {
    if (state.options.excludeSuffixes?.some(suffix => relative.endsWith(suffix))) return false;
    return state.allowPaths === undefined || state.allowPaths.some(allowed =>
      relative === allowed || relative.startsWith(`${allowed}/`) || (directory && allowed.startsWith(`${relative}/`)));
  }

  function refuseEntry({ state, entryPath, symlink }: { state: PackingState; entryPath: string; symlink: boolean }): void {
    const policy = symlink ? state.options.symlinkPolicy : state.options.specialFilePolicy;
    if (policy === 'reject') throw new Error(`bundled agent plugin refuses ${symlink ? 'symlink' : 'special file'} '${entryPath}'`);
  }

  return { packAgentPluginDirectory, createBundledSourceArchiveReader };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createBundledSourceArchiveModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
