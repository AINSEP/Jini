import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { normalizeIpcPath, readJsonFile, removePointerIfCurrent, resolveDaemonRegistryPath, writeJsonFile } from '../index.js';

test('object inputs preserve atomic state and guarded pointer removal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'args-convention-'));
  try {
    const filePath = resolveDaemonRegistryPath({ dataDir: dir }, { fileName: 'pointer.json' });
    await writeJsonFile({ filePath, payload: { runId: 'new' } });
    await removePointerIfCurrent({ pointerPath: filePath, runId: 'old' });
    expect(await readJsonFile({ filePath })).toEqual({ runId: 'new' });
    await removePointerIfCurrent({ pointerPath: filePath, runId: 'new' });
    expect(await readJsonFile({ filePath })).toBeNull();
    expect(normalizeIpcPath({ ipc: join(dir, 'socket') })).toBe(join(dir, 'socket'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
