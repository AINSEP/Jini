import { open, readFile, readdir, stat } from "node:fs/promises";
import { arch, hostname, platform, release, totalmem, type } from "node:os";
import JSZip from "jszip";
import type { DiagnosticsPorts } from "./ports.js";

/** Explicit Node/JSZip adapter. Hosts opt into local filesystem and process access here.
 * Tail reads retain bounded memory usage and always close the file descriptor.
 */
export function createNodeDiagnosticsPorts(_required: Record<string, never>): DiagnosticsPorts {
  return {
    filesystem: {
      async readFile({ absolutePath }, { tailBytes } = {}) {
        if (tailBytes == null || tailBytes <= 0) return await readFile(absolutePath);
        const info = await stat(absolutePath);
        if (info.size <= tailBytes) return await readFile(absolutePath);
        const fd = await open(absolutePath, "r");
        try {
          const buffer = Buffer.alloc(tailBytes);
          const { bytesRead } = await fd.read(buffer, 0, tailBytes, info.size - tailBytes);
          return buffer.subarray(0, bytesRead);
        } finally {
          await fd.close();
        }
      },
      async readDirectory({ absolutePath }) {
        return (await readdir(absolutePath, { withFileTypes: true }))
          .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
      },
      async stat({ absolutePath }) {
        const info = await stat(absolutePath);
        return { isFile: info.isFile(), mtimeMs: info.mtimeMs };
      },
    },
    clock: { nowMs: () => Date.now() },
    system: {
      platform: () => process.platform,
      machineInfo: () => ({
        hostname: hostname(), platform: platform(), release: release(), arch: arch(),
        type: type(), totalMemoryBytes: totalmem(), nodeVersion: process.version,
        pid: process.pid, ppid: process.ppid, cwd: process.cwd(),
      }),
    },
    archiveFactory: {
      create() {
        const zip = new JSZip();
        return {
          file({ name, content }) { zip.file(name, content); },
          async generate() {
            return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
          },
        };
      },
    },
  };
}
