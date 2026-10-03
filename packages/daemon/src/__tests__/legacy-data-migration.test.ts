/**
 * Unit tests for the generic legacy-data-dir migrator. Hermetic: each test
 * runs against a fresh pair of mkdtemp() directories. The fixture `config`
 * below stands in for a host's real payload shape (this suite uses an
 * OD-shaped fixture only to prove behavioral parity with the ported
 * mechanism's origin test suite — the module itself has no knowledge of it).
 */
import * as fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LegacyMigrationError,
  dataDirHasExistingPayload,
  dataDirIsEmptyOrFresh,
  legacyDirHasPayload,
  migrateLegacyDataDirSync,
  promoteStaged,
  type LegacyDataMigrationConfig,
} from '../legacy-data-migration.js';

const config: LegacyDataMigrationConfig = {
  payloadEntries: ['app.sqlite', 'app-config.json', 'media-config.json', 'projects', 'artifacts'],
  proofEntry: 'app.sqlite',
};

interface SilentLogger {
  info(args: { message: string }): void;
  warn(message: string): void;
  readonly entries: { level: 'info' | 'warn'; message: string }[];
}

function makeLogger(): SilentLogger {
  const entries: { level: 'info' | 'warn'; message: string }[] = [];
  return {
    entries,
    info: ({ message: m }) => entries.push({ level: 'info', message: m }),
    warn: (m) => entries.push({ level: 'warn', message: m }),
  };
}

function writeFile(filePath: string, contents = 'x'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function seedLegacyDir(legacyDir: string): void {
  writeFile(path.join(legacyDir, 'app.sqlite'), 'fake-sqlite');
  writeFile(path.join(legacyDir, 'app-config.json'), '{"v":1}');
  writeFile(path.join(legacyDir, 'media-config.json'), '{"providers":{}}');
  writeFile(path.join(legacyDir, 'projects', 'p1', 'index.html'), '<html>1</html>');
  writeFile(path.join(legacyDir, 'projects', 'p2', 'page.html'), '<html>2</html>');
  writeFile(path.join(legacyDir, 'artifacts', 'a1', 'final.html'), '<html>a</html>');
}

/** Symlinks need elevated permission on stock Windows; skip cleanly there. */
function trySymlink(target: string, linkPath: string, type: 'dir' | 'file'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type === 'dir' ? 'junction' : 'file');
    return true;
  } catch {
    return false;
  }
}

describe('migrateLegacyDataDirSync', () => {
  let legacyDir: string;
  let dataDir: string;

  beforeEach(() => {
    legacyDir = mkdtempSync(path.join(os.tmpdir(), 'jini-legacy-'));
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'jini-data-'));
  });

  afterEach(async () => {
    await rm(legacyDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns noop when legacyDir is not set', () => {
    const log = makeLogger();
    expect(migrateLegacyDataDirSync({ ...config, legacyDir: undefined, dataDir }, { ...config, logger: log })).toMatchObject({ status: 'noop' });
    expect(log.entries).toHaveLength(0);
  });

  it('returns noop when legacyDir is the empty string', () => {
    expect(migrateLegacyDataDirSync({ ...config, legacyDir: '', dataDir }, { ...config, logger: makeLogger() })).toMatchObject({ status: 'noop' });
  });

  it('returns noop when legacyDir equals dataDir', () => {
    expect(migrateLegacyDataDirSync({ ...config, legacyDir: dataDir, dataDir }, { ...config, logger: makeLogger() })).toMatchObject({ status: 'noop' });
  });

  it('throws LegacyMigrationError when legacyDir has no proof entry', () => {
    writeFile(path.join(legacyDir, 'README.txt'), 'unrelated');
    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LegacyMigrationError);
    expect((captured as LegacyMigrationError).code).toBe('legacy_dir_invalid');
  });

  it('throws LegacyMigrationError when dataDir already has the proof entry', () => {
    seedLegacyDir(legacyDir);
    writeFile(path.join(dataDir, 'app.sqlite'), 'NEW-DATA-DO-NOT-OVERWRITE');

    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LegacyMigrationError);
    expect((captured as LegacyMigrationError).code).toBe('data_dir_not_empty');
    expect(fs.readFileSync(path.join(dataDir, 'app.sqlite'), 'utf8')).toBe('NEW-DATA-DO-NOT-OVERWRITE');
  });

  it('throws when dataDir already has a payload entry other than the proof entry', () => {
    seedLegacyDir(legacyDir);
    writeFile(path.join(dataDir, 'projects', 'preexisting', 'index.html'), '<html/>');

    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LegacyMigrationError);
    expect((captured as LegacyMigrationError).code).toBe('data_dir_not_empty');
    expect(fs.existsSync(path.join(dataDir, 'projects', 'preexisting', 'index.html'))).toBe(true);
  });

  it('migrates payload to a fresh dataDir', () => {
    seedLegacyDir(legacyDir);
    const log = makeLogger();
    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: log });

    expect(result.status).toBe('migrated');
    expect(result.copied).toEqual(expect.arrayContaining(['app.sqlite', 'app-config.json', 'media-config.json', 'projects', 'artifacts']));
    expect(fs.readFileSync(path.join(dataDir, 'app.sqlite'), 'utf8')).toBe('fake-sqlite');
    expect(fs.readFileSync(path.join(dataDir, 'projects', 'p1', 'index.html'), 'utf8')).toBe('<html>1</html>');
    expect(fs.readFileSync(path.join(dataDir, 'artifacts', 'a1', 'final.html'), 'utf8')).toBe('<html>a</html>');
    expect(log.entries.some((e) => e.message.includes('migrating legacy data'))).toBe(true);
    expect(log.entries.some((e) => e.message.includes('migration complete'))).toBe(true);
  });

  it('writes a marker after success, using the configured marker file name', () => {
    seedLegacyDir(legacyDir);
    migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, markerFile: '.custom-marker', logger: makeLogger() });
    const marker = JSON.parse(fs.readFileSync(path.join(dataDir, '.custom-marker'), 'utf8'));
    expect(marker.legacyDir).toBe(path.resolve(legacyDir));
    expect(typeof marker.migratedAt).toBe('string');
  });

  it('defaults the marker file name to .migrated-from', () => {
    seedLegacyDir(legacyDir);
    migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(fs.existsSync(path.join(dataDir, '.migrated-from'))).toBe(true);
  });

  it('defaults to a console logger when none is supplied', () => {
    seedLegacyDir(legacyDir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config });
      expect(result.status).toBe('migrated');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migrating legacy data'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migration complete'));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('rethrows (via the outer rollback) when the default marker writer fails, e.g. a markerFile naming a missing subdirectory', () => {
    seedLegacyDir(legacyDir);
    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, markerFile: 'missing-subdir/marker.json', logger: makeLogger() });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    // The default writeMarker's own catch cleans up its temp file and
    // rethrows, and the outer rollback then removes every promoted entry.
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual([]);
  });

  it('idempotent: a second call after success returns skipped without re-copying', () => {
    seedLegacyDir(legacyDir);
    migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    fs.rmSync(path.join(dataDir, 'app.sqlite'));

    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/marker/);
    expect(fs.existsSync(path.join(dataDir, 'app.sqlite'))).toBe(false);
  });

  it('marker beats a missing legacyDir on the next call', async () => {
    seedLegacyDir(legacyDir);
    const first = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(first.status).toBe('migrated');

    await rm(legacyDir, { recursive: true, force: true });

    const second = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(second.status).toBe('skipped');
    expect(second.reason).toMatch(/marker/);
  });

  it('migrates even when dataDir does not exist yet', async () => {
    seedLegacyDir(legacyDir);
    await rm(dataDir, { recursive: true, force: true });

    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(result.status).toBe('migrated');
    expect(fs.existsSync(path.join(dataDir, 'app.sqlite'))).toBe(true);
  });

  it('uses singular "entry" phrasing in the completion log when exactly one entry is copied', () => {
    writeFile(path.join(legacyDir, 'app.sqlite'), 'fake');
    const log = makeLogger();
    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: log });
    expect(result.copied).toEqual(['app.sqlite']);
    expect(log.entries.some((e) => e.message.includes('copied 1 entry ('))).toBe(true);
  });

  it('skips entries that are absent in the legacy dir', () => {
    writeFile(path.join(legacyDir, 'app.sqlite'), 'fake');
    writeFile(path.join(legacyDir, 'projects', 'only', 'page.html'), '<x/>');

    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(result.status).toBe('migrated');
    expect(result.copied).toContain('app.sqlite');
    expect(result.copied).toContain('projects');
    expect(result.copied).not.toContain('media-config.json');
    expect(result.copied).not.toContain('artifacts');
  });

  it('refuses to migrate when a symlink is anywhere inside the legacy payload', () => {
    seedLegacyDir(legacyDir);
    const escapeTarget = mkdtempSync(path.join(os.tmpdir(), 'jini-escape-'));
    writeFile(path.join(escapeTarget, 'secret.txt'), 'should not be reachable');
    const linkPath = path.join(legacyDir, 'projects', 'evil-link');

    if (!trySymlink(escapeTarget, linkPath, 'dir')) {
      fs.rmSync(escapeTarget, { recursive: true, force: true });
      return;
    }

    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(LegacyMigrationError);
    expect((captured as LegacyMigrationError).code).toBe('symlink_in_payload');
    expect(fs.existsSync(path.join(dataDir, '.migrated-from'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'app.sqlite'))).toBe(false);

    fs.rmSync(escapeTarget, { recursive: true, force: true });
  });

  it('cleans up the staging dir on staging failure (no half-copied state in dataDir)', () => {
    seedLegacyDir(legacyDir);
    const escapeTarget = mkdtempSync(path.join(os.tmpdir(), 'jini-stage-cleanup-'));
    const linkPath = path.join(legacyDir, 'projects', 'late-link');
    if (!trySymlink(escapeTarget, linkPath, 'dir')) {
      fs.rmSync(escapeTarget, { recursive: true, force: true });
      return;
    }

    expect(() => migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() })).toThrowError(LegacyMigrationError);

    const parent = path.dirname(dataDir);
    const base = path.basename(dataDir);
    const leftovers = fs.readdirSync(parent).filter((entry) => entry.startsWith(`${base}.migrate-`));
    expect(leftovers).toEqual([]);

    fs.rmSync(escapeTarget, { recursive: true, force: true });
  });

  it('rolls back already-promoted entries when promotion fails mid-loop', () => {
    const stagingDir = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.migrate-rollback-test`);
    fs.mkdirSync(stagingDir, { recursive: true });
    writeFile(path.join(stagingDir, 'app.sqlite'), 'staged-sqlite');
    writeFile(path.join(stagingDir, 'app-config.json'), 'staged-config');

    // Pre-create dataDir/app-config.json as a non-empty directory so
    // renameSync (file -> non-empty dir) and the cpSync fallback both fail —
    // a real failure injection, not a mock.
    fs.mkdirSync(path.join(dataDir, 'app-config.json'), { recursive: true });
    writeFile(path.join(dataDir, 'app-config.json', 'block.txt'), 'occupied');

    let captured: unknown;
    try {
      promoteStaged({ stagingDir: stagingDir, dataDir: dataDir, entries: ['app.sqlite', 'app-config.json'] });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual([]);

    fs.rmSync(stagingDir, { recursive: true, force: true });
  });

  it('rolls back promoted payload when writeMarker fails after promotion', () => {
    seedLegacyDir(legacyDir);

    let captured: unknown;
    try {
      migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger(), writeMarker: ({ dataDir: markerDataDir, legacyDir: _legacyDir, markerFile }) => {
          fs.writeFileSync(path.join(markerDataDir, markerFile), 'partial bytes before crash', 'utf8');
          const e = new Error('synthetic ENOSPC writing marker') as NodeJS.ErrnoException;
          e.code = 'ENOSPC';
          throw e;
        } });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, '.migrated-from'))).toBe(false);

    const result = migrateLegacyDataDirSync({ ...config, legacyDir, dataDir }, { ...config, logger: makeLogger() });
    expect(result.status).toBe('migrated');
    expect(fs.existsSync(path.join(dataDir, 'app.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, '.migrated-from'))).toBe(true);
  });
});

describe('dataDirIsEmptyOrFresh', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'jini-fresh-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('treats a missing directory as fresh', async () => {
    await rm(dataDir, { recursive: true, force: true });
    expect(dataDirIsEmptyOrFresh({ dataDir: dataDir, config: config })).toBe(true);
  });

  it('treats an empty directory as fresh', () => {
    expect(dataDirIsEmptyOrFresh({ dataDir: dataDir, config: config })).toBe(true);
  });

  it('treats a directory with arbitrary scratch but no proof entry as fresh', () => {
    writeFile(path.join(dataDir, 'lockfile'), '');
    expect(dataDirIsEmptyOrFresh({ dataDir: dataDir, config: config })).toBe(true);
  });

  it('treats a directory with the proof entry as not fresh', () => {
    writeFile(path.join(dataDir, 'app.sqlite'), 'real-data');
    expect(dataDirIsEmptyOrFresh({ dataDir: dataDir, config: config })).toBe(false);
  });
});

describe('legacyDirHasPayload', () => {
  let legacyDir: string;
  beforeEach(() => {
    legacyDir = mkdtempSync(path.join(os.tmpdir(), 'jini-legacy-prove-'));
  });
  afterEach(async () => {
    await rm(legacyDir, { recursive: true, force: true });
  });

  it('returns false when the directory is missing', async () => {
    await rm(legacyDir, { recursive: true, force: true });
    expect(legacyDirHasPayload({ legacyDir: legacyDir, config: config })).toBe(false);
  });

  it('returns false when the directory exists but has no proof entry', () => {
    writeFile(path.join(legacyDir, 'README.md'), 'unrelated');
    expect(legacyDirHasPayload({ legacyDir: legacyDir, config: config })).toBe(false);
  });

  it('returns true when the directory contains the proof entry', () => {
    writeFile(path.join(legacyDir, 'app.sqlite'), 'real');
    expect(legacyDirHasPayload({ legacyDir: legacyDir, config: config })).toBe(true);
  });
});

describe('dataDirHasExistingPayload', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'jini-payload-probe-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns an empty list when the directory is missing', async () => {
    await rm(dataDir, { recursive: true, force: true });
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual([]);
  });

  it('returns an empty list when the directory holds only foreign files', () => {
    writeFile(path.join(dataDir, 'unrelated.log'), 'logs');
    writeFile(path.join(dataDir, '.DS_Store'), '');
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual([]);
  });

  it('detects the proof entry alone', () => {
    writeFile(path.join(dataDir, 'app.sqlite'), 'real');
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual(['app.sqlite']);
  });

  it('detects a directory-shaped payload entry alone', () => {
    writeFile(path.join(dataDir, 'projects', 'p1', 'index.html'), '<x/>');
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual(['projects']);
  });

  it('returns every payload entry that exists, in declared order', () => {
    writeFile(path.join(dataDir, 'app.sqlite'), 'real');
    writeFile(path.join(dataDir, 'media-config.json'), '{"providers":{}}');
    writeFile(path.join(dataDir, 'artifacts', 'a1', 'final.html'), '<x/>');
    expect(dataDirHasExistingPayload({ dataDir: dataDir, config: config })).toEqual(['app.sqlite', 'media-config.json', 'artifacts']);
  });
});
