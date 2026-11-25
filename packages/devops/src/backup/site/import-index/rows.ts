import type { MinimalImportOutcome, SiteImportRecord, SiteImportStatus } from '@jini-ai/core/contracts/site/site-import-history';
import { SiteShareRefusal } from '../share-refusal.js';

export function isTerminal({ status }: { status: SiteImportStatus }, _optional: Record<string, never> = {}): boolean {
  return status === 'ready' || status === 'failed';
}

export function assertTransition({ previous, row }: { previous: SiteImportRecord | undefined; row: SiteImportRecord }, _optional: Record<string, never> = {}): void {
  if (!previous) {
    if (row.status !== 'verifying') throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Invalid import transition.' });
    return;
  }
  const allowed: Record<SiteImportStatus, readonly SiteImportStatus[]> = { verifying: ['verifying', 'needs-owner', 'failed'], 'needs-owner': ['creating', 'failed'], creating: ['creating', 'ready', 'failed'], ready: ['ready'], failed: [] };
  if (!allowed[previous.status].includes(row.status)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Invalid import transition.' });
  for (const key of ['importId', 'principalId', 'requestId', 'createdAt', 'sourceDigest'] as const) {
    if (previous[key] !== row[key]) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Import identity cannot change.' });
  }
  const source = previous.status === 'ready' && 'url' in row.source ? { url: new URL(row.source.url).origin } : row.source;
  const previousSource = previous.status === 'ready' && 'url' in previous.source ? { url: new URL(previous.source.url).origin } : previous.source;
  if (JSON.stringify(source) !== JSON.stringify(previousSource)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Import identity cannot change.' });
  if (previous.status === 'ready') {
    const { adminUrl: _oldUrl, error: _oldError, ...before } = { ...previous, source: previousSource };
    const { adminUrl: _newUrl, error: _newError, ...after } = { ...row, source };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new SiteShareRefusal({ code: 'INVALID_INPUT', message: 'Only import start results can change.' });
  }
}

export function toRowParams({ row, settledMs }: { row: SiteImportRecord; settledMs: number | null }, _optional: Record<string, never> = {}) {
  const detail = isTerminal(row) && 'url' in row.source ? { ...row, source: { url: new URL(row.source.url).origin } } : row;
  return { importId: row.importId, principalId: row.principalId, requestId: row.requestId ?? null, status: row.status, createdMs: Date.parse(row.createdAt), settledMs, expiresMs: row.expiresAt, rowJson: JSON.stringify(detail) };
}

export function minimalOutcome({ row }: { row: SiteImportRecord }, _optional: Record<string, never> = {}): MinimalImportOutcome {
  return {
    importId: row.importId, status: row.status, newSiteId: row.newSiteId, newSiteName: row.newSiteName, displayName: row.displayName, createdAt: row.createdAt,
    source: isTerminal(row) && 'url' in row.source ? { url: new URL(row.source.url).origin } : row.source,
    ...(row.adminUrl === undefined ? {} : { adminUrl: row.adminUrl }),
    ...(row.error === undefined ? {} : { error: row.error }),
    ...(row.hasEncryptedKeys === undefined ? {} : { hasEncryptedKeys: row.hasEncryptedKeys }),
  };
}
