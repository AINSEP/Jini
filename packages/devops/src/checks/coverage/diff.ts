import { loadRouteCoverage, pct } from './lcov.js';
import type { FileCoverage, SourceClassifier } from './lcov.js';
import type { SourceReaderPort } from '../ports.js';

export interface TierResult { ok: boolean; pctValue: number; detail: string }
export interface FileTierEvaluation { file: string; unit: TierResult; integration: TierResult; ok: boolean }
export interface TierThresholds { unit: number; integration: number }
export interface DiffPort { changedFiles(args: { baseRef: string; repoRoot: string; sourceRoots: readonly string[] }): Promise<readonly string[]> }

/** Resolve event inputs without global environment access or a repository-specific fallback. */
export function resolveBaseRef({ fallbackRef, remote }: { fallbackRef: string; remote: string }, {
  override, positional, pullRequestBase, eventBefore,
}: { override?: string; positional?: string; pullRequestBase?: string; eventBefore?: string } = {}): string {
  if (override) return override;
  if (positional) return positional;
  if (pullRequestBase) return pullRequestBase.includes('/') ? pullRequestBase : `${remote}/${pullRequestBase}`;
  if (eventBefore && !/^0+$/.test(eventBefore)) return eventBefore;
  return fallbackRef;
}

function tier(record: FileCoverage | undefined, threshold: number, label: string): TierResult {
  if (!record) return { ok: false, pctValue: 0, detail: `no ${label} coverage record` };
  const pctValue = pct({ hit: record.brh, found: record.brf });
  return { ok: pctValue >= threshold, pctValue, detail: `${pctValue.toFixed(2)}% branch` };
}

/** Evaluate two independent tiers; missing records differ from a known branchless source file. */
export function evaluateFileTiers({ file, unitRec, integrationRec, thresholds }: {
  file: string; unitRec: FileCoverage | undefined; integrationRec: FileCoverage | undefined; thresholds: TierThresholds;
}): FileTierEvaluation {
  for (const value of Object.values(thresholds)) if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('tier thresholds must be percentages from 0 to 100');
  const brf = unitRec?.brf ?? integrationRec?.brf;
  if (brf === undefined || (unitRec && integrationRec && unitRec.brf !== integrationRec.brf)) {
    const detail = brf === undefined ? 'no coverage record on either tier' : 'inconsistent branch totals between tiers';
    return { file, unit: { ok: false, pctValue: 0, detail }, integration: { ok: false, pctValue: 0, detail }, ok: false };
  }
  if (brf === 0) {
    const result = { ok: true, pctValue: 100, detail: '0 branches in this file (vacuously passes both tiers)' };
    return { file, unit: { ...result }, integration: { ...result }, ok: true };
  }
  const unit = tier(unitRec, thresholds.unit, 'unit');
  const integration = tier(integrationRec, thresholds.integration, 'integration');
  return { file, unit, integration, ok: unit.ok && integration.ok };
}

/** Query a diff port, then parse supplied coverage artifacts only when measurable files changed. */
export async function checkCoverageDiff({ baseRef, repoRoot, sourceRoots, diff, reader, isMeasurable, unitCoveragePath, integrationCoveragePath, thresholds }: {
  baseRef: string; repoRoot: string; sourceRoots: readonly string[]; diff: DiffPort; reader: SourceReaderPort; isMeasurable: SourceClassifier;
  unitCoveragePath: string; integrationCoveragePath: string; thresholds: TierThresholds;
}): Promise<{ ok: boolean; files: readonly FileTierEvaluation[] }> {
  const changed = [...new Set(await diff.changedFiles({ baseRef, repoRoot, sourceRoots }))].filter((file) => isMeasurable({ file }));
  if (changed.length === 0) return { ok: true, files: [] };
  const unit = new Map(loadRouteCoverage({ lcovPath: unitCoveragePath, repoRoot, reader, isMeasurable }).map((record) => [record.file, record]));
  const integration = new Map(loadRouteCoverage({ lcovPath: integrationCoveragePath, repoRoot, reader, isMeasurable }).map((record) => [record.file, record]));
  const files = changed.map((file) => evaluateFileTiers({ file, unitRec: unit.get(file), integrationRec: integration.get(file), thresholds }));
  return { ok: files.every((file) => file.ok), files };
}
