import { pct } from './lcov.js';
import type { FileCoverage, SourceClassifier } from './lcov.js';

export interface CoverageFloor { line: number; branch: number; funcs: number }
export interface AreaFloor extends CoverageFloor { prefix: string }
export interface FloorResult { count: number; line: number; branch: number; funcs: number; failures: readonly string[] }
export interface AreaFloorResult extends FloorResult { area: AreaFloor }

/** Aggregate counters before comparing percentages; an empty measurable scope always fails. */
export function evaluateFloor({ files, floors }: { files: readonly FileCoverage[]; floors: CoverageFloor }): FloorResult {
  for (const value of Object.values(floors)) if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('coverage floors must be percentages from 0 to 100');
  const totals = files.reduce((sum, record) => ({ lf: sum.lf + record.lf, lh: sum.lh + record.lh, brf: sum.brf + record.brf, brh: sum.brh + record.brh, fnf: sum.fnf + record.fnf, fnh: sum.fnh + record.fnh }), { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 });
  const actual = { line: pct({ hit: totals.lh, found: totals.lf }), branch: pct({ hit: totals.brh, found: totals.brf }), funcs: pct({ hit: totals.fnh, found: totals.fnf }) };
  const failures: string[] = [];
  if (files.length === 0) failures.push('0 measurable files');
  else for (const axis of ['line', 'branch', 'funcs'] as const) if (actual[axis] < floors[axis]) failures.push(`${axis} ${actual[axis].toFixed(2)}% < floor ${floors[axis]}%`);
  return { count: files.length, ...actual, failures };
}

/** Evaluate one declared area with a host classifier; the prefix must match whole directories. */
export function evaluateArea({ area, all, isMeasurable }: {
  area: AreaFloor; all: readonly FileCoverage[]; isMeasurable: SourceClassifier;
}): AreaFloorResult {
  const prefix = `${area.prefix.replace(/\/+$/, '')}/`;
  const files = all.filter((record) => record.file.startsWith(prefix) && isMeasurable({ file: record.file }));
  return { area, ...evaluateFloor({ files, floors: { line: area.line, branch: area.branch, funcs: area.funcs } }) };
}
