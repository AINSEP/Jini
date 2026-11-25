import type { SiteCreationAllocation } from './platform-site-dir.js';

export type SiteImportSource = { url: string } | { uploadId: string };
export type SiteImportStatus = 'verifying' | 'needs-owner' | 'creating' | 'ready' | 'failed';

export interface SiteImportRecord {
  importId: string;
  principalId: string;
  requestId?: string | undefined;
  sourceDigest?: string | undefined;
  source: SiteImportSource;
  newSiteId: string | null;
  newSiteName: string | null;
  displayName: string;
  /** Private write-ahead allocation, supplied only by the existing site lifecycle. */
  creation?: SiteCreationAllocation;
  status: SiteImportStatus;
  createdAt: string;
  expiresAt: number;
  adminUrl?: string | null | undefined;
  warnings?: readonly string[] | undefined;
  credentialWarnings?: readonly { readonly path: string; readonly kind: string }[];
  hasEncryptedKeys?: boolean | undefined;
  error?: string | undefined;
}

export interface SiteImportView {
  importId: string; source: SiteImportSource; newSiteId: string | null; newSiteName: string | null;
  state: SiteImportRecord['status']; status: SiteImportRecord['status']; createdAt: string;
  warnings?: readonly string[] | undefined;
  credentialWarnings: readonly { readonly path: string; readonly kind: string }[];
  hasEncryptedKeys?: boolean | undefined;
  setupUrl?: string; adminUrl?: string | null | undefined; error?: string | undefined; instructions: string;
}

export type SiteImportPage<T = SiteImportView> = { imports: T[]; nextCursor?: string };
export type SiteImportPageInput = { principalId: string; cursor?: string; limit?: number };
export type ImportHistoryPolicy = Readonly<{
  cutoverPolicy: 'enable' | 'rollback';
  historyVisibleMs: 2_592_000_000;
  replayFenceMs: 31_536_000_000;
  legacyRetireMs: 2_592_000_000;
  sweepOnClockRollback: false;
}>;
export type MinimalImportOutcome = Pick<SiteImportRecord, 'importId' | 'status' | 'newSiteId' | 'newSiteName' | 'displayName' | 'createdAt' | 'source' | 'adminUrl' | 'error' | 'hasEncryptedKeys'>;
