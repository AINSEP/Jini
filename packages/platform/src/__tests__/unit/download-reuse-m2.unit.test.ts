import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { downloadCopyAndClear, inspectManagedDownload, MANAGED_DOWNLOAD_ERROR_CODES } from '../../download.js';

test.each([
  { existing: 'abc', conflict: false }, { existing: 'different', conflict: true },
])('existing output is preserved: $existing', async ({ existing, conflict }) => {
  const root = await mkdtemp(join(tmpdir(), 'jini-download-m2-'));
  const outputPath = join(root, 'output.bin');
  const target = { basePath: join(root, 'cache'), bucket: 'artifacts', fileName: 'asset.bin' };
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('abc'));
  try {
    await writeFile(outputPath, existing);
    const copying = downloadCopyAndClear({ ...target, outputPath, fetch: fetchImpl,
      payload: { url: 'https://assets.example/asset.bin', checksum: {
        algorithm: 'sha256', value: createHash('sha256').update('abc').digest('hex'),
      } } });
    if (conflict) {
      await expect(copying).rejects.toMatchObject({ name: 'ManagedDownloadError', code: MANAGED_DOWNLOAD_ERROR_CODES.OUTPUT_CONFLICT });
      expect((await inspectManagedDownload(target)).complete).toBe(true);
    } else {
      await expect(copying).resolves.toMatchObject({ bytes: 3, cleanup: 'removed', outputPath });
      expect((await inspectManagedDownload(target)).complete).toBe(false);
    }
    expect(await readFile(outputPath, 'utf8')).toBe(existing);
    expect(fetchImpl).toHaveBeenCalledOnce();
  } finally { await rm(root, { recursive: true, force: true }); }
});
