import { constants } from "node:fs";
import { open, readdir, lstat } from "node:fs/promises";
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
        const fd = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await fd.stat();
          if (!info.isFile()) throw new Error("Diagnostic source is not a regular file");
          if (tailBytes == null || tailBytes <= 0) return await fd.readFile();
          const length = Math.min(info.size, tailBytes);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await fd.read(buffer, 0, length, info.size - length);
          return buffer.subarray(0, bytesRead);
        } finally {
          await fd.close();
        }
      },
      async readDirectory({ absolutePath }) {
        if (!(await lstat(absolutePath)).isDirectory()) throw new Error("Diagnostic source is not a directory");
        return (await readdir(absolutePath, { withFileTypes: true }))
          .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
      },
      async stat({ absolutePath }) {
        const info = await lstat(absolutePath);
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
