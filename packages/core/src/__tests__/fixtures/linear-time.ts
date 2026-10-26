import { expect } from 'vitest';

// Load-tolerant linear-time guard. Wall-clock ceilings flaked when the machine was busy, and so did
// wall-clock ratios: a load burst can land on one step only. So this times thread CPU time, which
// waiting for a core does not inflate, and compares the code against itself: it times `size / 64`,
// `size / 8` and `size` and fails when an 8x larger input costs more than 24x the step before.
// There is no absolute ceiling. Linear code measures ~3-11x per step (GC and string allocation push
// it past 8); quadratic code ~64x. Each checked step keeps the fastest of up to three runs. A step
// under FLOOR_MS counts as FLOOR_MS, where timer noise dominates. The small steps make a quadratic
// regression fail in a few minutes instead of running for an hour at `size`.

const STEP = 8;
const MAX_STEP_RATIO = 24;
const FLOOR_MS = 5;
const RUNS = 3;

// CPU time of this thread, in ms. Wall-clock time also counts the time a busy machine leaves the
// thread waiting for a core.
const cpuMs = (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

const timeRun = (run: () => unknown): number => {
  const started = cpuMs();
  run();
  return cpuMs() - started;
};

/**
 * Asserts `prepare(count)()` runs in linear time in `count`, up to `size`. `prepare` builds the
 * input for `count` outside the timing and returns the work to time.
 */
export function expectLinearTime({ size, prepare }: { size: number; prepare: (count: number) => () => unknown }): void {
  let previousMs: number | undefined;
  for (const count of [size / (STEP * STEP), size / STEP, size].map(Math.floor)) {
    const run = prepare(count);
    let fastestMs = timeRun(run);
    if (previousMs !== undefined) {
      for (let attempt = 1; attempt < RUNS && fastestMs / previousMs >= MAX_STEP_RATIO; attempt++) {
        fastestMs = Math.min(fastestMs, timeRun(run));
      }
      expect(fastestMs / previousMs, `${count} items took ${fastestMs.toFixed(1)} ms`).toBeLessThan(MAX_STEP_RATIO);
    }
    previousMs = Math.max(fastestMs, FLOOR_MS);
  }
}
