/** In-memory ports for the partition interlock tests: filesystem, async writer lock, clock, scheduler. */
import path from 'node:path';
import type {
  HeldWriterLock, PartitionFsPort, PartitionWriterLockPort, WriterLockOptions,
} from '../index.js';

function enoent(target: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });
}

/** Shared by every "process" in a test: one machine, one disk. */
export class MemoryFs implements PartitionFsPort {
  files = new Map<string, string>();
  dirs = new Set<string>(['/']);
  links = new Map<string, string>();
  failRead = new Set<string>();
  failReaddir = new Set<string>();
  /** Awaited before each async op; the interleaving harness gates on it. */
  gate: (op: string, target: string) => Promise<void> = async () => {};

  private parentMustExist(target: string): void {
    if (!this.dirs.has(path.dirname(target))) throw enoent(path.dirname(target));
  }
  mkdirSync({ path: dir }: { path: string }): void {
    for (let cur = dir; !this.dirs.has(cur); cur = path.dirname(cur)) this.dirs.add(cur);
  }
  writeFileSync({ path: target, data }: { path: string; data: string }): void {
    this.parentMustExist(target); this.files.set(target, data);
  }
  renameSync({ oldPath, newPath }: { oldPath: string; newPath: string }): void {
    const data = this.files.get(oldPath);
    if (data === undefined) throw enoent(oldPath);
    this.parentMustExist(newPath); this.files.delete(oldPath); this.files.set(newPath, data);
  }
  unlinkSync({ path: target }: { path: string }): void {
    if (!this.files.delete(target)) throw enoent(target);
  }
  async writeFile(input: { path: string; data: string }): Promise<void> {
    await this.gate('write', input.path); this.writeFileSync(input);
  }
  async rename(input: { oldPath: string; newPath: string }): Promise<void> {
    await this.gate('rename', input.newPath); this.renameSync(input);
  }
  async readFile({ path: target }: { path: string }): Promise<string> {
    await this.gate('read', target);
    if (this.failRead.has(target)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const data = this.files.get(target);
    if (data === undefined) throw enoent(target);
    return data;
  }
  async readdir({ path: dir }: { path: string }): Promise<string[]> {
    await this.gate('readdir', dir);
    if (this.failReaddir.has(dir)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    if (!this.dirs.has(dir)) throw enoent(dir);
    const names = new Set<string>();
    for (const entry of [...this.files.keys(), ...this.dirs, ...this.links.keys()]) {
      if (entry !== dir && path.dirname(entry) === dir) names.add(path.basename(entry));
    }
    return [...names].sort();
  }
  async lstat({ path: target }: { path: string }): Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean }> {
    const link = this.links.has(target), dir = this.dirs.has(target);
    if (!link && !dir && !this.files.has(target)) throw enoent(target);
    return { isDirectory: () => dir && !link, isSymbolicLink: () => link };
  }
  async realpath({ path: target }: { path: string }): Promise<string> {
    for (const [from, to] of this.links) {
      if (target === from || target.startsWith(`${from}/`)) return this.realpath({ path: to + target.slice(from.length) });
    }
    if (!this.dirs.has(target) && !this.files.has(target)) throw enoent(target);
    return target;
  }
}

/** Behaves like the async file lock with `staleMs: Infinity`: held across awaits, released in `finally`. */
export class MemoryLock implements PartitionWriterLockPort {
  owners = new Map<string, string>();
  calls: WriterLockOptions[] = [];
  unknownToken = false;
  deadOwner = false;
  private next = 0;
  constructor(private readonly clock: FakeClock, private readonly scheduler: FakeScheduler) {}
  async withFileLock<T>(
    { lockPath, run }: { lockPath: string; run: (held: HeldWriterLock) => Promise<T> },
    options: WriterLockOptions,
  ): Promise<T> {
    this.calls.push(options);
    const start = this.clock.mono();
    while (this.owners.has(lockPath)) {
      if (this.clock.mono() - start >= options.timeoutMs) throw new Error('lock timeout');
      await this.scheduler.sleep({ ms: 25 });
    }
    const token = `t${++this.next}`;
    this.owners.set(lockPath, token);
    const held: HeldWriterLock = {
      token,
      assertHeld: async () => { if (this.owners.get(lockPath) !== token) throw new Error('lock lost'); },
    };
    try { return await run(held); } finally { if (this.owners.get(lockPath) === token) this.owners.delete(lockPath); }
  }
  async readToken({ lockPath }: { lockPath: string }) {
    if (this.unknownToken) return { state: 'unknown' as const, reason: 'unreadable lock' };
    const token = this.owners.get(lockPath);
    return token === undefined ? { state: 'free' as const } : { state: 'held' as const, token, owner: this.deadOwner ? 'dead' as const : 'live' as const };
  }
}

export class FakeClock {
  ms = 0;
  mono(): number { return this.ms; }
  now(): number { return 1_700_000_000_000 + this.ms; }
}

/** `sleep` advances the fake clock and yields one macrotask so concurrent actors interleave. */
export class FakeScheduler {
  timers: Array<{ ms: number; run: () => void; cancelled: boolean }> = [];
  constructor(private readonly clock: FakeClock) {}
  async sleep({ ms }: { ms: number }): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
    this.clock.ms += ms;
  }
  every({ ms, run }: { ms: number; run: () => void }) {
    const timer = { ms, run, cancelled: false };
    this.timers.push(timer);
    return { cancel: () => { timer.cancelled = true; } };
  }
  tick(): void { for (const timer of this.timers) if (!timer.cancelled) timer.run(); }
}

export const MESSAGES = {
  busy: 'Website data is being tidied. Try opening this website again in a moment.',
  unregistered: ({ directory }: { directory: string }) => `Cannot write to the settings folder (${directory}).`,
  refused: 'This website could not be opened safely. Try again.',
};
