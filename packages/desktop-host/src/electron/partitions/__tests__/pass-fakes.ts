/** In-memory durable JSON store and a directory-aware filesystem for the ledger and partition-pass tests. */
import path from 'node:path';
import type { JsonFileRead, QuarantineNotice } from '@jini-ai/core/contracts/site/fs-durable-json';
import type { PartitionPassFsPort, RetirementLedgerStore } from '../index.js';
import { MemoryFs } from './fakes.js';

const errno = (code: string, target: string) => Object.assign(new Error(`${code}: ${target}`), { code });

/** Fault hook: return an error code to make that operation fail. `frozen` models a crashed process. */
export type FaultHook = (op: string, target: string, data?: string) => string | undefined;

export class MemoryDurableJson implements RetirementLedgerStore {
  value: unknown = undefined;
  raw: JsonFileRead | null = null;
  quarantined = 0;
  quarantineResult = true;
  failWrite: (value: unknown) => boolean = () => false;
  frozen = () => false;
  read(_required: Record<string, never>): JsonFileRead {
    if (this.raw) return this.raw;
    return this.value === undefined ? { state: 'missing' } : { state: 'ok', value: structuredClone(this.value) };
  }
  write({ value }: { value: unknown }): void {
    if (this.frozen() || this.failWrite(value)) throw errno('EIO', 'ledger');
    this.raw = null; this.value = structuredClone(value);
  }
  quarantine(_required: { notice: QuarantineNotice }): boolean {
    if (!this.quarantineResult) return false;
    this.quarantined += 1; this.raw = null; this.value = undefined; return true;
  }
  withLock<T>({ critical }: { critical: () => T }): T { return critical(); }
}

/** `MemoryFs` plus directory trees, device numbers, recursive removal and fault injection. */
export class PassFs extends MemoryFs implements PartitionPassFsPort {
  devs = new Map<string, number>();
  fault: FaultHook = () => undefined;
  frozen = false;
  private check(op: string, target: string, data?: string): void {
    if (this.frozen) throw errno('EIO', target);
    const failure = this.fault(op, target, data);
    if (failure) throw errno(failure, target);
  }
  override async writeFile(input: { path: string; data: string }): Promise<void> {
    this.check('write', input.path, input.data); return super.writeFile(input);
  }
  override async rename({ oldPath, newPath }: { oldPath: string; newPath: string }): Promise<void> {
    await this.gate('rename', newPath);
    this.check('rename', newPath);
    if (!this.dirs.has(oldPath)) { this.renameSync({ oldPath, newPath }); return; }
    if (this.dirs.has(newPath) || this.files.has(newPath)) throw errno('ENOTEMPTY', newPath);
    if (!this.dirs.has(path.dirname(newPath))) throw errno('ENOENT', newPath);
    const move = (p: string) => (p === oldPath || p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p);
    this.dirs = new Set([...this.dirs].map(move));
    this.files = new Map([...this.files].map(([p, d]) => [move(p), d]));
    this.devs = new Map([...this.devs].map(([p, d]) => [move(p), d]));
  }
  override async lstat({ path: target }: { path: string }) {
    if (this.frozen) throw errno('EIO', target);
    const failure = this.fault('lstat', target);
    if (failure) throw errno(failure, target);
    const base = await super.lstat({ path: target });
    return { ...base, dev: this.devs.get(target) ?? 1 };
  }
  async mkdir({ path: dir }: { path: string }): Promise<void> { this.check('mkdir', dir); this.mkdirSync({ path: dir }); }
  async rm({ path: target }: { path: string }): Promise<void> {
    this.check('rm', target);
    if (!this.dirs.has(target) && !this.files.has(target)) throw errno('ENOENT', target);
    const inside = (p: string) => p === target || p.startsWith(`${target}/`);
    for (const d of [...this.dirs]) if (inside(d)) this.dirs.delete(d);
    for (const f of [...this.files.keys()]) if (inside(f)) this.files.delete(f);
  }
  /** Creates a directory with the given files (relative name → contents). */
  tree(dir: string, files: Record<string, string> = {}): void {
    this.mkdirSync({ path: dir });
    for (const [name, data] of Object.entries(files)) {
      this.mkdirSync({ path: path.dirname(path.join(dir, name)) });
      this.files.set(path.join(dir, name), data);
    }
  }
}
