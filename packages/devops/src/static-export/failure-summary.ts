import type { ExportReport } from './contracts.js';

export interface ExportFailureSummary { kind: 'route' | 'asset'; identifier: string; reason: string; count: number }
/** Runtime-leaf check of routes AND assets. Routes take precedence; the count is per collection. */
export function firstExportFailure(required: { report: ExportReport }): ExportFailureSummary | undefined {
  const { report } = required;
  const route = report.routes.failed[0];
  if (route) return { kind: 'route', identifier: route.path, reason: route.reason, count: report.routes.failed.length };
  const asset = report.assets.failed[0];
  if (asset) return { kind: 'asset', identifier: asset.url, reason: asset.reason, count: report.assets.failed.length };
  return undefined;
}
