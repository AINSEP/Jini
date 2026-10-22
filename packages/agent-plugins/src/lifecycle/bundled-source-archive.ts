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
import path from "node:path";
import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from "./install.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export interface PackedAgentPluginArchive {
  readonly bytes: Uint8Array;

  /** Lowercase hex SHA-256 of {@link bytes} — passed straight to `installAgentPlugin`'s
   *  `expectedSha256`, which recomputes and compares it rather than trusting it. */
  readonly sha256: string;

  /** Package-relative POSIX paths included, sorted — the same order they appear in `bytes`. */
  readonly files: readonly string[];
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const MAGIC = ports.bundledArchiveMagic;

  const MAX_SOURCE_FILES = 2048;

  /**
 * Serialises every regular file under `sourceDir` into one deterministic archive.
 *
 * Symlinks and any other non-regular entry are skipped rather than followed: a bundled package is
 * this repository's own tracked content, so a symlink in it would be a mistake, and following one
 * is the exact vector `install.ts` refuses on the extraction side. Skipping keeps the two sides
 * agreeing instead of producing an archive the installer would then reject.
 *
 * @throws {Error} If the tree holds more than {@link MAX_SOURCE_FILES} files.
 * @throws Propagates `readdir`/`readFile` errors — a bundled package that cannot be read is a build
 * defect, not a runtime condition to degrade around.
 * @complexity O(f) files, O(b) total bytes; both bounded by the cap above and by `install.ts`'s own
 * `LIMITS` on the extraction side.
 */
  async function packAgentPluginDirectory(sourceDir: string): Promise<PackedAgentPluginArchive> {
    const relativePaths = (await listRegularFiles(sourceDir, "")).sort();
    if (relativePaths.length > MAX_SOURCE_FILES) {
      throw new Error(
        `bundled agent plugin at '${sourceDir}' has ${relativePaths.length} files, over the ${MAX_SOURCE_FILES}-file cap — is this the right directory?`,
      );
    }

    const chunks: Buffer[] = [Buffer.from(MAGIC, "utf8")];
    for (const relativePath of relativePaths) {
      const content = await readFile(path.join(sourceDir, relativePath));
      const pathBytes = Buffer.from(relativePath, "utf8");
      chunks.push(Buffer.from(`F ${pathBytes.byteLength} ${content.byteLength}\n`, "utf8"), pathBytes, content);
    }

    const bytes = Buffer.concat(chunks);
    return {
      bytes: new Uint8Array(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      files: relativePaths,
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
 * Lists every regular file under `dir`, as POSIX-style package-relative paths.
 *
 * @complexity O(f) in filesystem entries under `dir`.
 */
  async function listRegularFiles(dir: string, prefix: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...(await listRegularFiles(path.join(dir, entry.name), relative)));
      } else if (entry.isFile()) {
        files.push(relative);
      }
      // Symlinks and everything else: skipped. See this function's own doc.
    }
    return files;
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
