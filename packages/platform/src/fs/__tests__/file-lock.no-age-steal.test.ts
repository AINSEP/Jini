import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFileLockSync } from '../file-lock.js';
const roots: string[] = [];
function makeTemporaryDirectory(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sync-lock-')); roots.push(root); return root; }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
// Infinity intentionally disables mtime-based stealing, preserving a live owner's lock regardless of age.
function runLocked<T>(filePath: string, run: () => T): T {
  return withFileLockSync({ lockPath: `${filePath}.lock`, run }, { timeoutMs: 2000, staleMs: Infinity, pollMs: 10, createParent: true, format: 'token', timeoutMessage: () => 'Timed out waiting for exclusive access.' });
}
describe('synchronous file lock with no age-based stealing', () => {
    // PARITY: synchronous ownership and contention contract.
    it('serializes file mutations and releases only the caller-owned lock', () => {
        const directory = makeTemporaryDirectory();
        const filePath = path.join(directory, 'state.json');
        const lockPath = `${filePath}.lock`;
        expect(runLocked(filePath, () => {
            expect(fs.existsSync(lockPath)).toBe(true);
            return 42;
        })).toBe(42);
        expect(fs.existsSync(lockPath)).toBe(false);
        expect(() => runLocked(filePath, () => {
            throw new Error('operation failed');
        })).toThrow('operation failed');
        expect(fs.existsSync(lockPath)).toBe(false);
        expect(runLocked(filePath, () => {
            const callerOwnership = fs.readFileSync(lockPath, 'utf8');
            fs.unlinkSync(lockPath);
            fs.writeFileSync(lockPath, 'replacement-owner');
            return callerOwnership;
        })).not.toBe('');
        expect(fs.readFileSync(lockPath, 'utf8')).toBe('replacement-owner');
        fs.unlinkSync(lockPath);
        expect(runLocked(filePath, () => {
            fs.writeFileSync(lockPath, 'replacement-owner-on-same-inode');
            return 84;
        })).toBe(84);
        expect(fs.readFileSync(lockPath, 'utf8')).toBe('replacement-owner-on-same-inode');
        fs.unlinkSync(lockPath);
    });
    /**
     * Regression: a contender that loses the `O_EXCL` open must RETRY, including when the owner
     * releases in the gap before it looks again. An earlier version stat'd `lockPath` between those
     * two moments and discarded the result — vestigial code from an age-based eviction that had
     * already been removed — so the ENOENT from that stat escaped `runLocked` and turned
     * an ordinary lock handoff into a hard failure.
     *
     * The race is made deterministic by failing only the FIRST `openSync` with EEXIST while no lock
     * file exists on disk, which is exactly the state a contender sees when the owner unlinks
     * immediately after its open lost.
     */
    // PARITY: synchronous ownership and contention contract.
    it('retries rather than failing when the owner releases between a contender\'s failed open and its next attempt', () => {
        const directory = makeTemporaryDirectory();
        const filePath = path.join(directory, 'state.json');
        const lockPath = `${filePath}.lock`;
        const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
            expect(fs.existsSync(lockPath)).toBe(false);
            throw Object.assign(new Error('EEXIST: file already exists, open'), { code: 'EEXIST' });
        });
        try {
            expect(runLocked(filePath, () => 'ran')).toBe('ran');
            expect(openSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(fs.existsSync(lockPath)).toBe(false);
        }
        finally {
            openSpy.mockRestore();
        }
    });
    // PARITY: synchronous ownership and contention contract.
    it('does not evict a live lock owner solely because its mtime is old', () => {
        const directory = makeTemporaryDirectory();
        const filePath = path.join(directory, 'state.json');
        const lockPath = `${filePath}.lock`;
        runLocked(filePath, () => {
            const callerOwnership = fs.readFileSync(lockPath, 'utf8');
            const base = Date.now();
            fs.utimesSync(lockPath, new Date(base - 31000), new Date(base - 31000));
            const now = vi.spyOn(Date, 'now')
                .mockReturnValueOnce(base)
                .mockReturnValue(base + 2001);
            try {
                expect(() => runLocked(filePath, () => undefined)).toThrow('Timed out waiting');
            }
            finally {
                now.mockRestore();
            }
            expect(fs.readFileSync(lockPath, 'utf8')).toBe(callerOwnership);
        });
    });
    // PARITY: synchronous ownership and contention contract.
    it('fails boundedly when another live process owns a file lock', () => {
        const directory = makeTemporaryDirectory();
        const filePath = path.join(directory, 'state.json');
        fs.writeFileSync(`${filePath}.lock`, 'owner');
        const now = vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValue(2001);
        try {
            expect(() => runLocked(filePath, () => undefined)).toThrow('Timed out waiting');
        }
        finally {
            now.mockRestore();
        }
    });

    // PARITY: non-contention create errors and release failures surface to the caller.
    // PARITY: synchronous ownership and contention contract.
    it('surfaces non-contention create and owned-release filesystem failures', () => {
      const filePath = path.join(makeTemporaryDirectory(), 'state.json');
      vi.spyOn(fs, 'openSync').mockImplementationOnce(() => { throw Object.assign(new Error('open denied'), { code: 'EACCES' }); });
      expect(() => runLocked(filePath, () => undefined)).toThrow('open denied');
      vi.restoreAllMocks();
      expect(() => runLocked(filePath, () => {
        vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw Object.assign(new Error('remove denied'), { code: 'EACCES' }); });
      })).toThrow('remove denied');
    });

});
