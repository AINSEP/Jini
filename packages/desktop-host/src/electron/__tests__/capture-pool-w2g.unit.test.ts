import { expect, test } from 'vitest';
import { createElectronUrlCapturePool } from '../electron-url-capture.js';

test('a partition handed off just before cancellation returns to the pool', async () => {
  const pool = createElectronUrlCapturePool({});
  const deadline = Date.now() + 60_000;
  const first = await pool.acquire({ deadline });
  const second = await pool.acquire({ deadline });
  const controller = new AbortController();
  const waiting = pool.acquire({ deadline }, { signal: controller.signal });
  const rejected = expect(waiting).rejects.toMatchObject({ code: 'aborted' });
  pool.release({ slot: first });
  controller.abort();
  await rejected;
  const reused = await pool.acquire({ deadline });
  expect(reused).toBe(first);
  pool.release({ slot: reused });
  pool.release({ slot: second });
});

test('an already aborted caller cannot consume a free partition', async () => {
  const pool = createElectronUrlCapturePool({});
  const deadline = Date.now() + 60_000;
  await expect(pool.acquire({ deadline }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' });
  const first = await pool.acquire({ deadline });
  const second = await pool.acquire({ deadline });
  expect([first, second]).toEqual([0, 1]);
  pool.release({ slot: first });
  pool.release({ slot: second });
});
