/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from "./install.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export interface PackedAgentPluginArchive {
  readonly bytes: Uint8Array;

  readonly sha256: string;

  readonly files: readonly string[];
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const MAGIC = ports.bundledArchiveMagic;

  const MAX_SOURCE_FILES = 2048;

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

  async function* onceAsyncIterable(chunk: Uint8Array): AsyncIterable<Uint8Array> {
    yield chunk;
  }

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
