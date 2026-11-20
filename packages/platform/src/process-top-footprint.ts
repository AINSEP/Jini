import type { ProcessPrivateMemory } from "./process.js";

/** top uses binary K/M/G and may append a change marker. Invalid/unsafe values stay unknown. O(1). */
function topBytes({ text }: { text: string }, _options = {}): number | null {
  const match = /^(\d+(?:\.\d+)?)([BKMG])[+-]?$/.exec(text);
  if (!match || match[2] === undefined) return null;
  const scale: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  const multiplier = scale[match[2]];
  if (multiplier === undefined) return null;
  const bytes = Math.round(Number(match[1]) * multiplier);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Only the requested PID table is trusted; duplicate rows invalidate that PID. O(text length + p) space/time. */
export function topReadings({ text, pids }: { text: string; pids: readonly number[] }, _options = {}): ProcessPrivateMemory['readings'] {
  const readings = new Map<number, number | null>();
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex(line => /^\s*PID\s+MEM\s*$/.test(line));
  const table = header < 0 ? [] : lines.slice(header + 1);
  const requested = new Set(pids);
  for (const line of table) {
    const row = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (!row || row[2] === undefined) continue;
    const pid = Number(row[1]);
    if (requested.has(pid)) readings.set(pid, readings.has(pid) ? null : topBytes({ text: row[2] }));
  }
  return pids.map(pid => ({ pid, bytes: readings.get(pid) ?? null }));
}

