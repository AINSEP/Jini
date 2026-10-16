import path from 'node:path';
import * as fs from 'node:fs/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { CONSENT_MAX_AGE_MS, type ConsentRecord, type ConsentRecordPort } from '../types.js';

/** Atomic writer owns flush/rename/permissions; the host binds its installed platform writer. */
export interface ConsentFilePorts {
  readText(required: { filePath: string }, optional?: Record<string, never>): Promise<string | null>;
  writeJson(required: { filePath: string; record: ConsentRecord }, optional?: Record<string, never>): Promise<void>;
}

/** Host injects the existing platform/fs writer rather than copying its durability lifecycle. */
export type ConsentAtomicWriter = (required: { filePath: string; data: unknown }, optional: { createParent: boolean; mode: number; refuseSymlink: boolean }) => Promise<void>;

/** Publish a flushed staging file with an exclusive hard link, then flush the directory on non-Windows hosts.
 * Filesystem/link failures propagate. No reader ever sees a partially-written proof file.
 * @complexity Startup O(r log r) time/O(r) space; subsequent writes amortized O(1) plus bounded receipt I/O. */
export function createNodeConsentFiles({ atomicWrite }: { atomicWrite: ConsentAtomicWriter }, { filesystem = fs, uniqueId = randomUUID, maximumRecords = 10000, retentionMs = CONSENT_MAX_AGE_MS, nowMs = Date.now, platform = process.platform }: { filesystem?: Pick<typeof fs, 'link' | 'unlink' | 'open' | 'readdir' | 'stat'>; uniqueId?: () => string; maximumRecords?: number; retentionMs?: number; nowMs?: () => number; platform?: NodeJS.Platform } = {}): ConsentFilePorts {
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) throw new Error('Consent receipt capacity must be a positive integer.');
  if (!Number.isFinite(retentionMs) || retentionMs < 0) throw new Error('Consent receipt retention must be nonnegative.');
  const writes = new Map<string, Promise<void>>();
  const inventories = new Map<string, Map<string, number>>();
  /** Serialize capacity checks/publication in this adapter. The host selects proof retention;
   * cookie expiry is not a legal proof-erasure policy. This bounded default is configurable,
   * and capacity eviction may shorten it; hosts needing longer proof retention must size accordingly.
   * Scan once at startup, then maintain an oldest-first inventory rather than stat every save.
   * @complexity Initial O(r log r); cached lookup O(1), pruning amortized O(1) per receipt. */
  async function inventory({ directory }: { directory: string }, _options = {}): Promise<Map<string, number>> {
    const cached = inventories.get(directory);
    if (cached) return cached;
    let names: string[];
    try { names = await filesystem.readdir(directory); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') names = [];
      else throw error;
    }
    const entries: Array<[string, number]> = [];
    for (const name of names) {
      if (/^[a-zA-Z0-9_-]{16,128}\.json$/.test(name)) entries.push([name, (await filesystem.stat(path.join(directory, name))).mtimeMs]);
    }
    entries.sort((left, right) => left[1] - right[1]);
    const retained = new Map(entries);
    inventories.set(directory, retained);
    return retained;
  }
  /** Expiry and capacity remove only owned receipts; unrelated files stay intact. */
  async function capacity({ directory, retained }: { directory: string; retained: Map<string, number> }, _options = {}): Promise<void> {
    const cutoff = nowMs() - retentionMs;
    for (const [name, timestamp] of retained) {
      if (retained.size < maximumRecords && timestamp >= cutoff) break;
      try { await filesystem.unlink(path.join(directory, name)); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
      retained.delete(name);
    }
  }
  return {
    async readText({ filePath }) {
      try {
        const handle = await filesystem.open(filePath, 'r');
        try {
          if ((await handle.stat()).size > 4096) throw new Error('Consent receipt exceeds 4096 bytes.');
          return await handle.readFile('utf8');
        } finally { await handle.close(); }
      }
      catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async writeJson({ filePath, record }) {
      const directoryPath = path.dirname(filePath);
      const pending = (writes.get(directoryPath) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        if (JSON.stringify(record).length > 4096) throw new Error('Consent receipt exceeds 4096 bytes.');
        const retained = await inventory({ directory: directoryPath });
        if (retained.has(path.basename(filePath))) throw new Error('Consent receipt ID already exists.');
        const staging = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${uniqueId()}.pending`);
        await atomicWrite({ filePath: staging, data: record }, { createParent: true, mode: 0o600, refuseSymlink: true });
        try {
          await capacity({ directory: directoryPath, retained });
          await filesystem.link(staging, filePath);
          retained.set(path.basename(filePath), nowMs());
          if (platform !== 'win32') {
            const directory = await filesystem.open(path.dirname(filePath), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
          }
        } finally { await filesystem.unlink(staging); }
      });
      writes.set(directoryPath, pending);
      try { await pending; } catch (error) { inventories.delete(directoryPath); throw error; } finally { if (writes.get(directoryPath) === pending) writes.delete(directoryPath); }
    },
  };
}

/** Per-site opaque filenames; IDs cannot navigate out of the configured proof directory.
 * One immutable file per choice keeps historic policy versions without schema changes.
 * @complexity O(1) record lookup; publication uses the injected writer's cached capacity/retention inventory.
 * @throws Invalid ID, filesystem and malformed JSON errors; only absence returns null. */
export function createConsentFileRecords({ directory, files }: { directory: string; files: ConsentFilePorts }, _options = {}): ConsentRecordPort {
  const filePath = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) throw new Error('Invalid consent receipt ID.');
    return path.join(directory, `${id}.json`);
  };
  return {
    async read({ id }) {
      const text = await files.readText({ filePath: filePath(id) });
      if (text === null) return null;
      if (text.length > 4096) throw new Error('Consent receipt exceeds 4096 bytes.');
      return JSON.parse(text) as unknown;
    },
    async save({ record }) {
      const destination = filePath(record.id);
      // The injected writer must also enforce exclusive publication against concurrent collisions.
      if (await files.readText({ filePath: destination }) !== null) throw new Error('Consent receipt ID already exists.');
      await files.writeJson({ filePath: destination, record });
    },
  };
}

/** Group temporary IPv6 addresses by /64 using native address validation; mapped IPv4 keeps
 * its IPv4 budget. The host still owns trusted-proxy address selection. @complexity O(1). */
export function consentRateLimitKey({ address }: { address: string }, _options = {}): string {
  if (isIP(address) !== 6) return address;
  let normalized = address.split('%')[0]!;
  if (normalized.includes('.')) {
    const at = normalized.lastIndexOf(':');
    const octets = normalized.slice(at + 1).split('.').map(Number);
    normalized = normalized.slice(0, at + 1) + ((octets[0]! << 8) + octets[1]!).toString(16) + ':' + ((octets[2]! << 8) + octets[3]!).toString(16);
  }
  const [left = '', right = ''] = normalized.toLowerCase().split('::');
  const before = left ? left.split(':') : [];
  const after = right ? right.split(':') : [];
  const groups = normalized.includes('::') ? [...before, ...Array(8 - before.length - after.length).fill('0'), ...after] : before;
  const values = groups.map(group => parseInt(group, 16));
  if (values.slice(0, 5).every(value => value === 0) && values[5] === 65535) return `${values[6]! >> 8}.${values[6]! & 255}.${values[7]! >> 8}.${values[7]! & 255}`;
  return values.slice(0, 4).map(value => value.toString(16)).join(':') + '::/64';
}
