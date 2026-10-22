import { createRequire } from "node:module";

// The writer's small test-only interface keeps its untyped CommonJS package outside production.
const yazl = createRequire(import.meta.url)("yazl") as {
  ZipFile: new () => {
    addEmptyDirectory(metadataPath: string): void;
    addBuffer(buffer: Buffer, metadataPath: string, options?: { mode: number }): void;
    end(): void;
    outputStream: NodeJS.ReadableStream;
  };
};

/**
 * @file Test-only real-zip construction, via `yazl` (`yauzl`'s own write-side sibling, same
 * author). Used exclusively to build fixtures for `__tests__/unit/yauzl-archive-reader.real-zip.unit.test.ts`
 * — production code never imports this file or `yazl` (it's a devDependency for exactly this
 * reason). Mirrors `plugin-runtime/__tests__/fixtures/` convention (a dedicated fixtures dir, not
 * inline literals duplicated per test).
 */

export interface ZipFixtureEntry {
  readonly path: string;
  readonly content: string | Buffer;
  /** Unix `st_mode` — e.g. `0o120777` (S_IFLNK | rwxrwxrwx) to fabricate a real symlink entry, or
   * `0o100755` for an executable regular file. Defaults to yazl's own default (a plain file). */
  readonly mode?: number;
}

/** Builds real file entries and explicit directories (paths ending in /). */
export async function buildZipFixture({ entries }: { readonly entries: readonly ZipFixtureEntry[] }): Promise<Buffer> {
  const zipfile = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.path.endsWith("/")) {
      zipfile.addEmptyDirectory(entry.path);
      continue;
    }
    const buffer = typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : entry.content;
    zipfile.addBuffer(buffer, entry.path, entry.mode !== undefined ? { mode: entry.mode } : undefined);
  }
  zipfile.end();
  return collectBuffer(zipfile.outputStream);
}

function collectBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
