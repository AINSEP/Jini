import path from 'node:path';
import * as fs from 'node:fs/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { CONSENT_MAX_AGE_MS, type ConsentRecord, type ConsentRecordPort } from '../types.js';

const RECEIPT_FILENAME = /^[a-zA-Z0-9_-]{16,128}\.json$/;

/** Count is unknown when the host cannot inspect receipt storage. */
export type ConsentReceiptStorageHealth = { writable: boolean; count: number | null };

/** Prepare the same private directory used by receipt writes, check write/search access and count
 * receipt files without reading visitor proof. Filesystem errors propagate to the host's readiness check.
 * This is a current permissions check, not a guarantee against later capacity or I/O failures.
 * @example await readConsentReceiptStorage({ directory: '/site/consent-receipts' })
 * @complexity O(directory entries) time and space; no per-receipt reads or writes. */
export async function readConsentReceiptStorage({ directory }: { directory: string }, { filesystem = fs }: { filesystem?: Pick<typeof fs, 'mkdir' | 'access' | 'readdir'> } = {}): Promise<ConsentReceiptStorageHealth> {
  await filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await filesystem.access(directory, fs.constants.W_OK | fs.constants.X_OK);
  const entries = await filesystem.readdir(directory, { withFileTypes: true });
  return { writable: true, count: entries.filter(entry => entry.isFile() && RECEIPT_FILENAME.test(entry.name)).length };
}

/** Atomic writer owns flush/rename/permissions; the host binds its installed platform writer. */
export interface ConsentFilePorts {
  readText(required: { filePath: string }, optional?: Record<string, never>): Promise<string | null>;
  writeJson(required: { filePath: string; record: ConsentRecord }, optional?: Record<string, never>): Promise<void>;
  /** Preserve evidence outside active receipt lookup. Missing files are already inactive. */
  retire?(required: { filePath: string }, optional?: Record<string, never>): Promise<void>;
}

/** Host injects the existing platform/fs writer rather than copying its durability lifecycle. */
export type ConsentAtomicWriter = (required: { filePath: string; data: unknown }, optional: { createParent: boolean; mode: number; refuseSymlink: boolean }) => Promise<void>;

/** @complexity O(1). */
function assertLimits({ maximumRecords, retentionMs }: { maximumRecords: number; retentionMs: number }): void {
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) throw new Error('Consent receipt capacity must be a positive integer.');
  if (!Number.isFinite(retentionMs) || retentionMs < 0) throw new Error('Consent receipt retention must be nonnegative.');
}

/** Publish a flushed staging file with an exclusive hard link, then flush the directory on non-Windows hosts.
 * Filesystem/link failures propagate. No reader ever sees a partially-written proof file.
 * @complexity Startup O(r log r) time/O(r) space; subsequent writes amortized O(1) plus bounded receipt I/O. */
export function createNodeConsentFiles({ atomicWrite }: { atomicWrite: ConsentAtomicWriter }, { filesystem = fs, uniqueId = randomUUID, maximumRecords = 10000, retentionMs = CONSENT_MAX_AGE_MS, nowMs = Date.now, platform = process.platform }: { filesystem?: Pick<typeof fs, 'link' | 'unlink' | 'open' | 'readdir' | 'stat'>; uniqueId?: () => string; maximumRecords?: number; retentionMs?: number; nowMs?: () => number; platform?: NodeJS.Platform } = {}): ConsentFilePorts {
  assertLimits({ maximumRecords, retentionMs });
  const writes = new Map<string, Promise<void>>();
  const inventories = new Map<string, Map<string, number>>();
  /** Serialize publication and retirement so an inventory scan cannot race an active unlink.
   * Failed operations invalidate uncertain inventories and propagate; later work can still proceed.
   * @complexity O(1) queue bookkeeping plus the supplied work. */
  async function takingWriteTurn({ directory, work }: { directory: string; work: () => Promise<void> }, _options = {}): Promise<void> {
    const pending = (writes.get(directory) ?? Promise.resolve()).catch(() => undefined).then(work);
    writes.set(directory, pending);
    try { await pending; }
    catch (error) { inventories.delete(directory); throw error; }
    finally { if (writes.get(directory) === pending) writes.delete(directory); }
  }
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
      if (RECEIPT_FILENAME.test(name)) entries.push([name, (await filesystem.stat(path.join(directory, name))).mtimeMs]);
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
    async retire({ filePath }, _options = {}) {
      const directoryPath = path.dirname(filePath);
      await takingWriteTurn({ directory: directoryPath, work: async () => {
        const text = await this.readText({ filePath });
        if (text === null) return;
        // Publish the archive durably before unlinking the active receipt. A crash can only leave
        // the old choice active before the replacement save has been acknowledged to the visitor.
        const archived = path.join(directoryPath, 'retired', path.basename(filePath));
        if (await this.readText({ filePath: archived }) === null) await this.writeJson({ filePath: archived, record: JSON.parse(text) as ConsentRecord });
        try { await filesystem.unlink(filePath); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
        inventories.get(directoryPath)?.delete(path.basename(filePath));
        if (platform !== 'win32') {
          const directory = await filesystem.open(directoryPath, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } });
    },
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
    async writeJson({ filePath, record }, _options = {}) {
      const directoryPath = path.dirname(filePath);
      await takingWriteTurn({ directory: directoryPath, work: async () => {
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
      } });
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
    ...(files.retire ? { retire: async ({ id }: { id: string }) => files.retire!({ filePath: filePath(id) }) } : {}),
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

/** A dotted IPv4 tail becomes two hex groups so every spelling parses the same way. @complexity O(1). */
function hexIpv4Tail(address: string): string {
  if (!address.includes('.')) return address;
  const at = address.lastIndexOf(':');
  const octets = address.slice(at + 1).split('.').map(Number);
  return address.slice(0, at + 1) + ((octets[0]! << 8) + octets[1]!).toString(16) + ':' + ((octets[2]! << 8) + octets[3]!).toString(16);
}

/** Expand :: into explicit zero groups. @complexity O(1). */
function ipv6Groups(address: string): number[] {
  const [left = '', right = ''] = address.toLowerCase().split('::');
  const before = left ? left.split(':') : [];
  const after = right ? right.split(':') : [];
  const groups = address.includes('::') ? [...before, ...Array(8 - before.length - after.length).fill('0'), ...after] : before;
  return groups.map(group => parseInt(group, 16));
}

/** Group temporary IPv6 addresses by /64 using native address validation; mapped IPv4 keeps
 * its IPv4 budget. The host still owns trusted-proxy address selection. @complexity O(1). */
export function consentRateLimitKey({ address }: { address: string }, _options = {}): string {
  if (isIP(address) !== 6) return address;
  const values = ipv6Groups(hexIpv4Tail(address.split('%')[0]!));
  if (values.slice(0, 5).every(value => value === 0) && values[5] === 65535) return `${values[6]! >> 8}.${values[6]! & 255}.${values[7]! >> 8}.${values[7]! & 255}`;
  return values.slice(0, 4).map(value => value.toString(16)).join(':') + '::/64';
}
