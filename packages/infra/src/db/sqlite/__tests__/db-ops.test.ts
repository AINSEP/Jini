import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SqliteDbOpsAdapter } from '../db-ops.js';
import { openSqliteDb } from '../open.js';

const schema = { notes: sqliteTable('notes', { id: text('id').primaryKey() }) };

describe('SqliteDbOpsAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jini-infra-dbops-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('getCapabilities', () => {
    it('reports a cheap file-snapshot, which is what distinguishes SQLite from a networked driver', async () => {
      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath: ':memory:',
        readWatermark: () => 0,
      });
      await expect(adapter.getCapabilities()).resolves.toEqual({
        restorePoint: { costClass: 'cheap', kind: 'file-snapshot' },
      });
    });
  });

  describe('captureRestorePoint', () => {
    it('writes a real, restorable backup next to the live database file', async () => {
      const filePath = join(dir, 'content.db');
      const db = openSqliteDb({ filePath, schema });
      db.$client.exec('CREATE TABLE notes (id text PRIMARY KEY)');
      db.$client.exec("INSERT INTO notes (id) VALUES ('n1')");

      const adapter = new SqliteDbOpsAdapter({ db, filePath, readWatermark: () => 5 });
      const point = await adapter.captureRestorePoint({ scopeId: 'store' });

      expect(point.watermarkAtCapture).toBe(5);
      expect(dirname(point.artifactRef)).toBe(dir);
      expect(existsSync(point.artifactRef)).toBe(true);

      // The artifact is a genuine database, not an empty placeholder.
      const restored = openSqliteDb({ filePath: point.artifactRef, schema });
      expect(restored.$client.prepare('SELECT id FROM notes').all()).toEqual([{ id: 'n1' }]);
    });

    it('stamps the watermark read at capture time into the filename', async () => {
      const filePath = join(dir, 'content.db');
      const db = openSqliteDb({ filePath, schema });
      const adapter = new SqliteDbOpsAdapter({
        db,
        filePath,
        readWatermark: () => 99,
        now: () => 1700000000000,
      });
      const point = await adapter.captureRestorePoint({ scopeId: 'store' });
      expect(basename(point.artifactRef)).toBe('restore-point-store-wm99-1700000000000.db');
    });

    it('sanitizes a scopeId so it cannot escape the target directory', async () => {
      const filePath = join(dir, 'content.db');
      const db = openSqliteDb({ filePath, schema });
      const adapter = new SqliteDbOpsAdapter({ db, filePath, readWatermark: () => 1, now: () => 2 });
      const point = await adapter.captureRestorePoint({ scopeId: '../../escape' });
      expect(dirname(point.artifactRef)).toBe(dir);
      expect(basename(point.artifactRef)).toBe('restore-point-______escape-wm1-2.db');
    });

    it('falls back to the OS temp directory for an in-memory connection', async () => {
      const backup = vi.fn().mockResolvedValue(undefined);
      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup } },
        filePath: ':memory:',
        readWatermark: () => 0,
        now: () => 1,
      });
      const point = await adapter.captureRestorePoint({ scopeId: 's' });
      expect(dirname(point.artifactRef)).toBe(tmpdir());
      expect(backup).toHaveBeenCalledWith(point.artifactRef);
    });

    it('defaults its clock to Date.now when none is injected', async () => {
      const backup = vi.fn().mockResolvedValue(undefined);
      const before = Date.now();
      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup } },
        filePath: ':memory:',
        readWatermark: () => 0,
      });
      const point = await adapter.captureRestorePoint({ scopeId: 's' });
      const stamped = Number(/-wm0-(\d+)\.db$/.exec(basename(point.artifactRef))?.[1]);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('restoreFromArtifact', () => {
    it('swaps the live file for the artifact and demands a restart', async () => {
      const filePath = join(dir, 'content.db');
      writeFileSync(filePath, 'LIVE');
      const artifactRef = join(dir, 'artifact.db');
      writeFileSync(artifactRef, 'ARTIFACT');

      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath,
        readWatermark: () => 0,
      });
      await expect(adapter.restoreFromArtifact({ artifactRef })).resolves.toEqual({ restartRequired: true });
      expect(readFileSync(filePath, 'utf8')).toBe('ARTIFACT');
    });

    it('leaves no temp file behind after the atomic rename', async () => {
      const filePath = join(dir, 'content.db');
      writeFileSync(filePath, 'LIVE');
      const artifactRef = join(dir, 'artifact.db');
      writeFileSync(artifactRef, 'ARTIFACT');

      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath,
        readWatermark: () => 0,
      });
      await adapter.restoreFromArtifact({ artifactRef });
      const leftovers = readFileSync(filePath, 'utf8');
      expect(leftovers).toBe('ARTIFACT');
      expect(existsSync(join(dir, `.content.db.restoring-`))).toBe(false);
    });

    it('removes stale WAL and SHM sidecars so the swapped file is unambiguous', async () => {
      const filePath = join(dir, 'content.db');
      writeFileSync(filePath, 'LIVE');
      writeFileSync(`${filePath}-wal`, 'STALE');
      writeFileSync(`${filePath}-shm`, 'STALE');
      const artifactRef = join(dir, 'artifact.db');
      writeFileSync(artifactRef, 'ARTIFACT');

      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath,
        readWatermark: () => 0,
      });
      await adapter.restoreFromArtifact({ artifactRef });
      expect(existsSync(`${filePath}-wal`)).toBe(false);
      expect(existsSync(`${filePath}-shm`)).toBe(false);
    });

    it('rejects when the artifact does not exist, leaving the live file untouched', async () => {
      const filePath = join(dir, 'content.db');
      writeFileSync(filePath, 'LIVE');
      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath,
        readWatermark: () => 0,
      });
      await expect(adapter.restoreFromArtifact({ artifactRef: join(dir, 'nope.db') })).rejects.toThrow();
      expect(readFileSync(filePath, 'utf8')).toBe('LIVE');
    });

    it('is a no-op for an in-memory connection — no file to swap, so no restart either', async () => {
      const adapter = new SqliteDbOpsAdapter({
        db: { $client: { backup: vi.fn() } },
        filePath: ':memory:',
        readWatermark: () => 0,
      });
      await expect(adapter.restoreFromArtifact({ artifactRef: 'ignored' })).resolves.toEqual({
        restartRequired: false,
      });
    });
  });
});
