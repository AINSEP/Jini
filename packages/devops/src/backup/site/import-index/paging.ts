import type { ImportHistoryPolicy, SiteImportPage, SiteImportRecord } from '@jini-ai/core/contracts/site/site-import-history';
import type { SqliteSyncClient } from '@jini-ai/core/contracts/storage';
import { SiteShareRefusal } from '../share-refusal.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CURSOR = /^v1\.([0-9]{1,15})\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

export function encodeCursor({ createdMs, importId }: { createdMs: number; importId: string }, _optional: Record<string, never> = {}): string {
  const text = `v1.${createdMs}.${importId}`;
  let cursor = ''; let buffer = 0; let bits = 0;
  for (let index = 0; index < text.length; index++) {
    buffer = (buffer << 8) | text.charCodeAt(index); bits += 8;
    while (bits >= 6) { bits -= 6; cursor += ALPHABET[(buffer >>> bits) & 63]; }
  }
  if (bits > 0) cursor += ALPHABET[(buffer << (6 - bits)) & 63];
  return cursor;
}

export function decodeCursor({ cursor }: { cursor: string }, _optional: Record<string, never> = {}): { createdMs: number; importId: string } {
  const invalid = { code: 'INVALID_CURSOR', message: 'This list of imports changed. Reload it to see the newest imports.' };
  if (cursor.length > 96 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new SiteShareRefusal(invalid);
  let text = ''; let buffer = 0; let bits = 0;
  for (const character of cursor) {
    buffer = (buffer << 6) | ALPHABET.indexOf(character); bits += 6;
    if (bits >= 8) { bits -= 8; text += String.fromCharCode((buffer >>> bits) & 255); }
  }
  const match = CURSOR.exec(text);
  if (!match) throw new SiteShareRefusal(invalid);
  const result = { createdMs: Number(match[1]), importId: match[2]! };
  if (!Number.isSafeInteger(result.createdMs) || result.createdMs < 0 || encodeCursor(result) !== cursor) throw new SiteShareRefusal(invalid);
  return result;
}

export function listPage({ db, clock, policy, principalId, cursor, limit }: {
  db: SqliteSyncClient; clock: { nowMs(): number }; policy: ImportHistoryPolicy; principalId: string; cursor?: string; limit?: number;
}, _optional: Record<string, never> = {}): SiteImportPage<SiteImportRecord> {
  const size = limit !== undefined && Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 50;
  const now = clock.nowMs();
  const bound = cursor === undefined ? undefined : decodeCursor({ cursor });
  // A cursor never selects a principal.
  const sql = `SELECT row_json FROM imports WHERE principal_id = ? AND (settled_ms IS NULL OR settled_ms > ?)${bound === undefined ? '' : ' AND (created_ms, import_id) < (?,?)'} ORDER BY created_ms DESC, import_id DESC LIMIT ?`;
  const parameters = bound === undefined ? [principalId, now - policy.historyVisibleMs, size + 1] : [principalId, now - policy.historyVisibleMs, bound.createdMs, bound.importId, size + 1];
  const rows = db.prepare<unknown[], { row_json: string }>(sql).all(...parameters);
  const imports = rows.slice(0, size).map(row => JSON.parse(row.row_json) as SiteImportRecord);
  const last = imports.at(-1);
  return { imports, ...(rows.length > size && last !== undefined ? { nextCursor: encodeCursor({ createdMs: Date.parse(last.createdAt), importId: last.importId }) } : {}) };
}

export function listAll({ readPage }: { readPage: (required: { cursor?: string }, optional?: Record<string, never>) => SiteImportPage<SiteImportRecord> }, _optional: Record<string, never> = {}): SiteImportRecord[] {
  const imports: SiteImportRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = readPage(cursor === undefined ? {} : { cursor }, {});
    imports.push(...page.imports);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return imports;
}
