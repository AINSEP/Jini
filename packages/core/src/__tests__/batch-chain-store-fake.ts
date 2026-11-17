import type { ToolExecutionContext } from '../tool-registry.js';

export const STALE_TEXT = 'This file changed after it was read. Read it again and retry; this change was not applied.';

/** A file the fake store holds: its bytes and a version that moves on every write. */
interface FakeFile { version: number; bytes: string }

/** What a host's `prepare` pins for one item: the file, the change, and the version it saw. */
export interface FakePrepared { key: string; append: string; pinned: number }

/** Fake of a versioned file store. `write` is the atomic compare-and-write a host owns:
 * it refuses when the pinned version is not the current one and reports the version it committed. */
export function fakeVersionedStore(initial: Record<string, string>) {
  const files = new Map<string, FakeFile>(Object.entries(initial).map(([key, bytes]) => [key, { version: 0, bytes }]));
  let reads = 0;
  const file = (key: string): FakeFile => {
    const found = files.get(key);
    if (!found) throw new Error(`No fake file ${key}`);
    return found;
  };
  return {
    /** Counted read, used by the fake host's `prepare` to take a pin. */
    read: ({ key }: { key: string }): number => { reads += 1; return file(key).version; },
    readCount: (): number => reads,
    write({ key, pinned, append }: { key: string; pinned: number; append: string }): number {
      const target = file(key);
      if (target.version !== pinned) throw new Error(STALE_TEXT);
      // A byte-identical write changes nothing, so the version stays where it was.
      if (append === '') return target.version;
      target.bytes += append;
      target.version += 1;
      return target.version;
    },
    /** A writer outside the batch. */
    foreignWrite({ key, append }: { key: string; append: string }): void {
      const target = file(key);
      target.bytes += append;
      target.version += 1;
    },
    bytes: ({ key }: { key: string }): string => file(key).bytes,
    version: ({ key }: { key: string }): number => file(key).version,
  };
}

export type FakeVersionedStore = ReturnType<typeof fakeVersionedStore>;

/** The asynchronous `prepare` of the fake host: pins the version it reads now. */
export function fakePrepare({ store }: { store: FakeVersionedStore }) {
  return async ({ ctx }: { ctx: ToolExecutionContext }): Promise<FakePrepared> => {
    const { key, append } = ctx.input as { key: string; append: string };
    await Promise.resolve();
    return { key, append, pinned: store.read({ key }) };
  };
}

export function toolContext({ input, signal = new AbortController().signal }: { input: unknown; signal?: AbortSignal }): ToolExecutionContext {
  return { executionId: 'exec', run: { id: 'run' }, principal: { id: 'owner' }, input, signal };
}
