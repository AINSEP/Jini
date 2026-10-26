/** Pure post-GC floor policy shared by native desktop and server soak harnesses. */
export interface MemoryCheckpoint { completed: number; samples: readonly number[] }
export interface MemoryFloorVerdict {
  pass: boolean;
  baselineFloor: number;
  floors: number[];
  growth: number;
  tailGrowth: number;
  failures: string[];
}

/** Select a floor, rejecting incomplete instrumentation. O(n) readings, O(1) extra space. */
function sampleFloor({ samples }: { samples: readonly number[] }, _options = {}): number {
  if (!samples.length || !samples.every(Number.isFinite)) throw new RangeError('Expected finite memory samples');
  return samples.reduce((floor, value) => Math.min(floor, value), Infinity);
}

/** Validate the measurement contract before comparisons. O(b) baseline readings, O(1) space. */
function readBaseline({ samples, limit, count }: { samples: readonly number[]; limit: number; count: number }, _options = {}): number {
  if (!Number.isFinite(limit) || limit <= 0 || limit >= 1) throw new RangeError('Memory limit must be between 0 and 1');
  const baseline = sampleFloor({ samples });
  if (baseline <= 0) throw new RangeError('Memory baseline must be positive');
  if (!count) throw new RangeError('Expected memory checkpoints');
  return baseline;
}

/** Last-three growth is charged only when both steps rise. O(1) time and space. */
function risingTail({ floors, baseline }: { floors: readonly number[]; baseline: number }, _options = {}): number {
  const tail = floors.slice(-3);
  if (tail.length < 3) return 0;
  if (tail[1]! <= tail[0]! || tail[2]! <= tail[1]!) return 0;
  return (tail[2]! - tail[0]!) / baseline;
}

/** Evaluate checkpoint minima against this run's warm-up, without effects or input mutation.
 * Desktop (`checkSlope: false`) checks every floor; server checks the end and strictly rising tail.
 * @param input Baseline and checkpoint readings in the same byte unit; completed is caller metadata.
 * @param options Fractional limit (default .15); server tail uses half that limit.
 * @returns Floors, normalized growth, and explicit failure reasons.
 * @throws RangeError for empty/nonfinite readings, nonpositive baseline or limit outside (0, 1).
 * @example evaluateMemoryFloors({ baselineSamples: [100, 101], checkpoints: [{ completed: 500, samples: [102, 105] }] });
 * @complexity O(n) total readings, O(c) space for c checkpoints.
 */
export function evaluateMemoryFloors(
  { baselineSamples, checkpoints }: { baselineSamples: readonly number[]; checkpoints: readonly MemoryCheckpoint[] },
  { limit = 0.15, checkSlope = true }: { limit?: number; checkSlope?: boolean } = {},
): MemoryFloorVerdict {
  const baselineFloor = readBaseline({ samples: baselineSamples, limit, count: checkpoints.length });
  const floors = checkpoints.map(checkpoint => sampleFloor({ samples: checkpoint.samples }));
  const growth = (floors.at(-1)! - baselineFloor) / baselineFloor;
  const tailGrowth = risingTail({ floors, baseline: baselineFloor });
  const failures: string[] = [];
  if (checkSlope) {
    if (growth > limit) failures.push('end floor');
    if (tailGrowth > limit / 2) failures.push('rising tail');
  } else if (floors.some(floor => (floor - baselineFloor) / baselineFloor > limit)) failures.push('checkpoint floor');
  return { pass: failures.length === 0, baselineFloor, floors, growth, tailGrowth, failures };
}
