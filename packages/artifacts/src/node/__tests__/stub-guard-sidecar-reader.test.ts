import { describe, expect, it } from 'vitest';
import { createNodeArtifactStubFilesystem, type ArtifactSidecarFileHandle } from '../stub-guard.js';

/** A handle whose fstat reports `reportedSize` but whose reads stream `actual` bytes in 4 KiB chunks. */
function growingHandle(reportedSize: number, actual: number): ArtifactSidecarFileHandle & { closed: boolean } {
  let served = 0;
  return {
    closed: false,
    async stat() { return { isFile: () => true, size: reportedSize }; },
    async read(buffer, offset, length) {
      const bytesRead = Math.min(length, 4096, actual - served);
      buffer.fill(0x61, offset, offset + bytesRead);
      served += bytesRead;
      return { bytesRead };
    },
    async close() { this.closed = true; },
  };
}

describe('bounded sidecar reader', () => {
  it('refuses a sidecar that grew past the limit after its size was checked, and still closes it', async () => {
    const handle = growingHandle(10, 70_000);
    const filesystem = createNodeArtifactStubFilesystem({}, { openFile: async () => handle });
    await expect(filesystem.readFile({ path: '/scan/a.artifact.json', maxBytes: 64 * 1024 })).rejects.toThrow('Artifact sidecar exceeds the byte limit');
    expect(handle.closed).toBe(true);
  });

  it('opens without following links and returns exactly the bytes read when within the limit', async () => {
    const opened: Array<{ path: string; flags: number }> = [];
    const handle = growingHandle(5, 5);
    const filesystem = createNodeArtifactStubFilesystem({}, { openFile: async (request) => { opened.push(request); return handle; } });
    expect(await filesystem.readFile({ path: '/scan/a.artifact.json', maxBytes: 16 })).toBe('aaaaa');
    expect(opened.map(({ path }) => path)).toEqual(['/scan/a.artifact.json']);
    const { constants } = await import('node:fs');
    expect(opened[0]!.flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(handle.closed).toBe(true);
  });
});
