import { describe, expect, it, vi } from 'vitest';
import { PayloadTooLargeError, readBodyFromFlags, readPromptFromFlags } from '../prompt.js';

/**
 * A minimal, manually-triggerable `AbortSignal`-shaped fake: a real `AbortController` always
 * assigns a real (truthy) `DOMException` to `signal.reason` once aborted on this Node runtime, so
 * it cannot exercise the `reason ?? new Error(...)` fallback in `prompt.ts`'s default stdin
 * readers, nor let a test abort strictly *after* reading has already started (a real controller's
 * `abort()` is synchronous and immediate). This fake controls both independently.
 */
function makeFakeSignal(): { signal: AbortSignal; fire: (reason?: unknown) => void } {
  const listeners: Array<() => void> = [];
  const state = { aborted: false, reason: undefined as unknown };
  const signal = {
    get aborted() {
      return state.aborted;
    },
    get reason() {
      return state.reason;
    },
    addEventListener: (_type: string, cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_type: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
    throwIfAborted: () => {
      if (state.aborted) throw state.reason;
    },
  } as unknown as AbortSignal;
  return {
    signal,
    fire: (reason?: unknown) => {
      state.aborted = true;
      state.reason = reason;
      for (const cb of [...listeners]) cb();
    },
  };
}

describe('readPromptFromFlags', () => {
  it('returns --prompt verbatim when set', async () => {
    const result = await readPromptFromFlags({ flags: { prompt: 'hello' } });
    expect(result).toBe('hello');
  });

  it('returns null when neither --prompt nor --prompt-file is set', async () => {
    const result = await readPromptFromFlags({ flags: {} });
    expect(result).toBeNull();
  });

  it('returns null for an empty --prompt-file value', async () => {
    const result = await readPromptFromFlags({ flags: { 'prompt-file': '' } });
    expect(result).toBeNull();
  });

  it('reads from the injected readFile for a real path', async () => {
    const readFile = async ({ path }: { path: string }) => `contents of ${path}`;
    const result = await readPromptFromFlags({ flags: { 'prompt-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('contents of /tmp/x.md');
  });

  it('reads from the injected readStdin for "-"', async () => {
    const readStdin = async () => 'stdin contents';
    const result = await readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { readStdin });
    expect(result).toBe('stdin contents');
  });

  it('prefers --prompt over --prompt-file', async () => {
    const readFile = async () => 'should not be read';
    const result = await readPromptFromFlags({ flags: { prompt: 'p', 'prompt-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('p');
  });

  it('treats an empty --prompt as unset and falls back to --prompt-file', async () => {
    const readFile = async () => 'from file';
    const result = await readPromptFromFlags({ flags: { prompt: '', 'prompt-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('from file');
  });

  it('uses the real node:fs/promises readFile by default', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-prompt-'));
    const file = join(dir, 'prompt.txt');
    await writeFile(file, 'from real disk', 'utf8');
    try {
      const result = await readPromptFromFlags({ flags: { 'prompt-file': file } });
      expect(result).toBe('from real disk');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the real stdin reader by default when prompt-file is "-"', async () => {
    // Exercise the default readStdin factory without actually blocking on
    // stdin: stub process.stdin's event emitter to synchronously end.
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } });
      fakeStdin.emit('data', 'piped ');
      fakeStdin.emit('data', 'in');
      fakeStdin.emit('end');
      await expect(pending).resolves.toBe('piped in');
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects with PayloadTooLargeError when a --prompt-file exceeds maxBytes', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-prompt-cap-'));
    const file = join(dir, 'prompt.txt');
    await writeFile(file, 'this is way more than five bytes', 'utf8');
    try {
      await expect(readPromptFromFlags({ flags: { 'prompt-file': file } }, { maxBytes: 5 })).rejects.toThrow(
        PayloadTooLargeError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a --prompt-file read that is already aborted', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-prompt-abort-'));
    const file = join(dir, 'prompt.txt');
    await writeFile(file, 'some content', 'utf8');
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(readPromptFromFlags({ flags: { 'prompt-file': file } }, { signal: controller.signal })).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects the default stdin reader when process.stdin emits an error', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } });
      const streamError = new Error('EIO: real io error');
      fakeStdin.emit('error', streamError);
      await expect(pending).rejects.toBe(streamError);
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects the default stdin reader with a generic Error when a mid-read abort carries no reason', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    (fakeStdin as unknown as { pause: () => void }).pause = () => {};
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const { signal, fire } = makeFakeSignal();
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { signal });
      fakeStdin.emit('data', 'partial ');
      fire(undefined);
      await expect(pending).rejects.toThrow('stdin read aborted');
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects the default stdin reader once the byte cap is exceeded, mid-stream', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    (fakeStdin as unknown as { pause: () => void }).pause = () => {};
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { maxBytes: 5 });
      fakeStdin.emit('data', 'way more than five bytes');
      await expect(pending).rejects.toThrow(PayloadTooLargeError);
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('cancels the default stdin reader when the signal aborts mid-read', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    (fakeStdin as unknown as { pause: () => void }).pause = () => {};
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const controller = new AbortController();
      const pending = readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { signal: controller.signal });
      fakeStdin.emit('data', 'partial ');
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects the default stdin reader immediately for a signal already aborted before reading starts, never touching process.stdin', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {
      throw new Error('must not read from stdin when already aborted');
    };
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const controller = new AbortController();
      const abortError = new Error('aborted before start');
      controller.abort(abortError);
      await expect(readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { signal: controller.signal })).rejects.toBe(abortError);
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects the default stdin reader with a generic Error when aborted-before-start carries no reason', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter() as unknown as NodeJS.ReadStream;
    (fakeStdin as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {
      throw new Error('must not read from stdin when already aborted');
    };
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      // A real `AbortController#abort()` (with no explicit reason) still assigns a real
      // `DOMException` as `signal.reason` on this Node runtime, so the `?? new Error(...)`
      // fallback (`limits.signal.reason ?? ...`) can't be reached that way — it exists for any
      // `AbortSignal`-shaped object whose `reason` is genuinely `undefined` despite `aborted:
      // true`, which the real class never produces but the type itself doesn't forbid. A minimal
      // fake signal proves that fallback for real instead of leaving it untested.
      const fakeSignal = { aborted: true, reason: undefined } as unknown as AbortSignal;
      await expect(readPromptFromFlags({ flags: { 'prompt-file': '-' } }, { signal: fakeSignal })).rejects.toThrow(
        'stdin read aborted',
      );
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });
});

describe('readBodyFromFlags', () => {
  it('returns --body verbatim when set', async () => {
    const result = await readBodyFromFlags({ flags: { body: 'hello' } });
    expect(result).toBe('hello');
  });

  it('treats an empty --body as provided (unlike readPromptFromFlags), short-circuiting before --body-file', async () => {
    const readFile = async () => 'should not be read';
    const result = await readBodyFromFlags({ flags: { body: '', 'body-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('');
  });

  it('returns undefined when neither --body nor --body-file is set', async () => {
    const result = await readBodyFromFlags({ flags: {} });
    expect(result).toBeUndefined();
  });

  it('reads from the injected readFile for a real path', async () => {
    const readFile = async ({ path }: { path: string }) => `contents of ${path}`;
    const result = await readBodyFromFlags({ flags: { 'body-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('contents of /tmp/x.md');
  });

  it('reads an empty --body-file path via the injected readFile (no early return, unlike prompt)', async () => {
    const readFile = async ({ path }: { path: string }) => `contents of "${path}"`;
    const result = await readBodyFromFlags({ flags: { 'body-file': '' } }, { readFile });
    expect(result).toBe('contents of ""');
  });

  it('reads from the injected readStdin for "-"', async () => {
    const readStdin = async () => 'stdin contents';
    const result = await readBodyFromFlags({ flags: { 'body-file': '-' } }, { readStdin });
    expect(result).toBe('stdin contents');
  });

  it('prefers --body over --body-file', async () => {
    const readFile = async () => 'should not be read';
    const result = await readBodyFromFlags({ flags: { body: 'b', 'body-file': '/tmp/x.md' } }, { readFile });
    expect(result).toBe('b');
  });

  it('uses the real node:fs/promises readFile by default', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-body-'));
    const file = join(dir, 'body.txt');
    await writeFile(file, 'from real disk', 'utf8');
    try {
      const result = await readBodyFromFlags({ flags: { 'body-file': file } });
      expect(result).toBe('from real disk');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the real async-iterator stdin reader by default when body-file is "-"', async () => {
    // Exercise the default readStdin factory without touching real stdin: stub
    // process.stdin as a minimal async-iterable yielding two chunks.
    const fakeStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield 'piped ';
        yield 'in';
      },
    } as unknown as NodeJS.ReadStream;
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const result = await readBodyFromFlags({ flags: { 'body-file': '-' } });
      expect(result).toBe('piped in');
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('rejects with PayloadTooLargeError when a --body-file exceeds maxBytes', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'jini-cli-body-cap-'));
    const file = join(dir, 'body.txt');
    await writeFile(file, 'this is way more than five bytes', 'utf8');
    try {
      await expect(readBodyFromFlags({ flags: { 'body-file': file } }, { maxBytes: 5 })).rejects.toThrow(PayloadTooLargeError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects the default async-iterator stdin reader once the byte cap is exceeded', async () => {
    const fakeStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield 'way ';
        yield 'more than five bytes';
      },
      destroy: () => {},
    } as unknown as NodeJS.ReadStream;
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      await expect(readBodyFromFlags({ flags: { 'body-file': '-' } }, { maxBytes: 5 })).rejects.toThrow(PayloadTooLargeError);
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('cancels the default async-iterator stdin reader via an already-aborted signal', async () => {
    const fakeStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield 'piped ';
        yield 'in';
      },
      destroy: () => {},
    } as unknown as NodeJS.ReadStream;
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(readBodyFromFlags({ flags: { 'body-file': '-' } }, { signal: controller.signal })).rejects.toThrow();
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('registers a real abort listener on the default async-iterator stdin reader, fires and cleans it up on a mid-read abort', async () => {
    let resumeGen: (() => void) | undefined;
    const destroy = vi.fn();
    const fakeStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield 'first ';
        await new Promise<void>((resolve) => {
          resumeGen = resolve;
        });
        yield 'second';
      },
      destroy,
    } as unknown as NodeJS.ReadStream;
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const { signal, fire } = makeFakeSignal();
      const pending = readBodyFromFlags({ flags: { 'body-file': '-' } }, { signal });
      // Let the first chunk flow through the async iterator before the generator parks on the
      // controlled promise (proves the "not yet aborted" path ran for real, not just abort-before-start).
      await new Promise((r) => setTimeout(r, 0));
      fire(new Error('aborted mid-read'));
      expect(destroy).toHaveBeenCalledWith(expect.any(Error));
      resumeGen?.();
      await expect(pending).rejects.toThrow();
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });

  it('decodes a real Buffer chunk from the default async-iterator stdin reader (not just the string chunks every other fixture yields)', async () => {
    const fakeStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('buffered ', 'utf8');
        yield Buffer.from('bytes', 'utf8');
      },
    } as unknown as NodeJS.ReadStream;
    const original = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      const result = await readBodyFromFlags({ flags: { 'body-file': '-' } });
      expect(result).toBe('buffered bytes');
    } finally {
      Object.defineProperty(process, 'stdin', { value: original, configurable: true });
    }
  });
});
