import type { MinimalImportOutcome, SiteImportRecord, SiteImportStatus } from '@jini-ai/core/contracts/site/site-import-history';
import { SiteShareRefusal } from '../share-refusal.js';

export function isTerminal({ status }: { status: SiteImportStatus }, _optional: Record<string, never> = {}): boolean {
  return status === 'ready' || status === 'failed';
}

const ALLOWED_NEXT: Record<SiteImportStatus, readonly SiteImportStatus[]> = { verifying: ['verifying', 'needs-owner', 'failed'], 'needs-owner': ['creating', 'failed'], creating: ['creating', 'ready', 'failed'], ready: ['ready'], failed: [] };

function refuse({ message }: { message: string }, _optional: Record<string, never> = {}): never {
  throw new SiteShareRefusal({ code: 'INVALID_INPUT', message });
}

// Once the previous record is ready its link is trimmed to its origin, so both sides are compared by origin.
function sourceForCompare({ ready, source }: { ready: boolean; source: SiteImportRecord['source'] }, _optional: Record<string, never> = {}): SiteImportRecord['source'] {
  return ready && 'url' in source ? { url: new URL(source.url).origin } : source;
}

function assertSameIdentity({ previous, row, ready }: { previous: SiteImportRecord; row: SiteImportRecord; ready: boolean }, _optional: Record<string, never> = {}): void {
  for (const key of ['importId', 'principalId', 'requestId', 'createdAt', 'sourceDigest'] as const) {
    if (previous[key] !== row[key]) refuse({ message: 'Import identity cannot change.' });
  }
  if (JSON.stringify(sourceForCompare({ ready, source: row.source })) !== JSON.stringify(sourceForCompare({ ready, source: previous.source }))) refuse({ message: 'Import identity cannot change.' });
}

function assertReadyUnchanged({ previous, row }: { previous: SiteImportRecord; row: SiteImportRecord }, _optional: Record<string, never> = {}): void {
  const { adminUrl: _oldUrl, error: _oldError, ...before } = { ...previous, source: sourceForCompare({ ready: true, source: previous.source }) };
  const { adminUrl: _newUrl, error: _newError, ...after } = { ...row, source: sourceForCompare({ ready: true, source: row.source }) };
  if (JSON.stringify(before) !== JSON.stringify(after)) refuse({ message: 'Only import start results can change.' });
}

export function assertTransition({ previous, row }: { previous: SiteImportRecord | undefined; row: SiteImportRecord }, _optional: Record<string, never> = {}): void {
  if (!previous) {
    if (row.status !== 'verifying') refuse({ message: 'Invalid import transition.' });
    return;
  }
  if (!ALLOWED_NEXT[previous.status].includes(row.status)) refuse({ message: 'Invalid import transition.' });
  assertSameIdentity({ previous, row, ready: previous.status === 'ready' });
  if (previous.status === 'ready') assertReadyUnchanged({ previous, row });
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

// The replay fence is shared by live admission and legacy backfill so both pick the same kind and value for one source:
// an upload id when uploaded, else the archive digest, else (no digest known) the source's origin.
export function replayFenceFor({ source, digest }: { source: SiteImportRecord['source']; digest: string | undefined }, _optional: Record<string, never> = {}): { fenceKind: 'sha256' | 'upload' | 'origin'; fenceValue: string } {
  if ('uploadId' in source) return { fenceKind: 'upload', fenceValue: source.uploadId };
  if (digest === undefined) return { fenceKind: 'origin', fenceValue: new URL(source.url).origin };
  return { fenceKind: 'sha256', fenceValue: digest.toLowerCase() };
}
