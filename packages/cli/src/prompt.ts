/**
 * @module prompt
 *
 * Long-form text intake shared across CLI domains: two sibling conventions
 * for reading a large piece of text from an inline flag, a `--*-file <path>`
 * flag, or stdin (`-`).
 *
 * `readPromptFromFlags` is the `--prompt <text>` / `--prompt-file <path>` /
 * `--prompt-file -` convention, ported from OD's `apps/daemon/src/cli.ts`
 * `readPromptFromFlags` (see `archived provenance ledger`). This exact pattern recurred
 * verbatim across many of OD's product commands (`brand create`, `run
 * start`, `files version-create`, `automation source ingest`, …) with zero
 * product nouns in the reading logic itself, which is what makes it a
 * genuine reusable primitive rather than a one-off helper worth leaving in
 * each caller.
 *
 * `readBodyFromFlags` is the sibling `--body`/`--body-file` convention,
 * ported from the `cli-capability-barrels` branch's `cli/core/io.ts`
 * `readMemoryBodyFromFlags` (see `archived provenance ledger`'s "Barrel branch
 * reconciliation" section). Despite the origin name, it has no memory-domain
 * coupling — that module's own docblock confirms it is reused verbatim by
 * both the memory and automation domains — so it is ported here under a
 * de-branded name alongside its prompt sibling.
 *
 * Per CR-004/SEC-RB-009
 * (`ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`,
 * `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`),
 * the default file/stdin readers below cap how many bytes they will read
 * (rejecting past the cap rather than truncating silently or reading
 * unbounded input into memory) and accept an optional `AbortSignal` so a
 * caller can cancel an in-progress read. Both knobs only apply to the
 * default `readFile`/`readStdin` implementations — they have no effect if a
 * caller injects their own.
 */

/** Thrown by the default readers when a file or stdin stream exceeds its configured byte cap. */
export class PayloadTooLargeError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

/** Default cap for the default file/stdin readers: generous for a prompt/body payload, small enough to bound worst-case memory. */
const DEFAULT_MAX_READ_BYTES = 10 * 1024 * 1024;

export interface PromptFlags {
  prompt?: string;
  'prompt-file'?: string;
}

export interface ReadPromptFromFlagsOptions {
  /** Defaults to a bounded, cancellable `node:fs` stream read; inject for tests. */
  readFile?: (requiredArgs: { path: string }) => Promise<string>;
  /** Defaults to a bounded, cancellable read of `process.stdin` to EOF as utf8; inject for tests. */
  readStdin?: () => Promise<string>;
  /** Maximum bytes the default readFile/readStdin will read before rejecting. Defaults to 10 MiB. No effect on an injected reader. */
  maxBytes?: number;
  /** Cancels an in-progress default readFile/readStdin call. No effect on an injected reader. */
  signal?: AbortSignal;
}

/**
 * Resolve prompt text from `--prompt`, or `--prompt-file <path>` /
 * `--prompt-file -` (stdin). Returns `null` when neither flag is set so the
 * caller can fall back to its own default.
 */
export async function readPromptFromFlags(
  { flags }: { flags: PromptFlags },
  options: ReadPromptFromFlagsOptions = {},
): Promise<string | null> {
  if (typeof flags.prompt === 'string' && flags.prompt.length > 0) {
    return flags.prompt;
  }
  const promptFile = flags['prompt-file'];
  if (typeof promptFile !== 'string' || promptFile.length === 0) {
    return null;
  }
  const readLimits = { maxBytes: options.maxBytes ?? DEFAULT_MAX_READ_BYTES, ...(options.signal !== undefined ? { signal: options.signal } : {}) };
  if (promptFile === '-') {
    const readStdin = options.readStdin ?? ((): Promise<string> => defaultReadStdin(readLimits));
    return await readStdin();
  }
  const readFile = options.readFile ?? (({ path }: { path: string }): Promise<string> => defaultReadFile(path, readLimits));
  return await readFile({ path: promptFile });
}

interface ReadLimits {
  maxBytes: number;
  signal?: AbortSignal;
}

async function defaultReadFile(path: string, limits: ReadLimits): Promise<string> {
  const { createReadStream } = await import('node:fs');
  return await new Promise<string>((resolve, reject) => {
    const stream = createReadStream(path, limits.signal !== undefined ? { signal: limits.signal } : {});
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    // `settled`-guarded: defensive against Node's own documented Readable
    // contract ever being violated (a stream is only ever supposed to emit
    // one of 'end'/'error', never both, and `stream.destroy()` with no
    // error argument — the only way this module calls it — is documented to
    // suppress any further 'error' from the destroy path itself). Kept as
    // real protection against a future/third-party stream implementation
    // bug, not something this module's own real `createReadStream` usage
    // can trigger — see `archived provenance ledger`'s dated entry for the full
    // re-verification record (a single terminal event is all this file's
    // own usage can ever produce).
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    // `@types/node` types a Readable's 'data' listener as `(chunk: string |
    // Buffer) => void` unconditionally (accommodating a stream some other
    // caller configured with an `encoding`), but this stream never sets one
    // (`limits` has no such field — see `ReadLimits`), so `chunk` is always
    // really a `Buffer` here — a plain assertion, not a runtime `typeof`
    // branch (a prior `typeof chunk === 'string' ? ... : ...` ternary here
    // was dead code given this file's only call site; removed rather than
    // left uncovered).
    stream.on('data', (rawChunk: string | Buffer) => {
      const chunk = rawChunk as Buffer;
      total += chunk.length;
      if (total > limits.maxBytes) {
        stream.destroy();
        finish(() => reject(new PayloadTooLargeError({ message: `file exceeded the ${limits.maxBytes}-byte limit: ${path}` })));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (err) => finish(() => reject(err)));
    stream.on('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))));
  });
}

async function defaultReadStdin(limits: ReadLimits): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    if (limits.signal?.aborted === true) {
      reject(limits.signal.reason ?? new Error('stdin read aborted'));
      return;
    }
    let buffer = '';
    let total = 0;
    process.stdin.setEncoding('utf8');
    const cleanup = (): void => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      limits.signal?.removeEventListener('abort', onAbort);
    };
    const pauseStdin = (): void => {
      (process.stdin as unknown as { pause?: () => void }).pause?.();
    };
    const onData = (chunk: string): void => {
      total += Buffer.byteLength(chunk, 'utf8');
      if (total > limits.maxBytes) {
        cleanup();
        pauseStdin();
        reject(new PayloadTooLargeError({ message: `stdin exceeded the ${limits.maxBytes}-byte limit` }));
        return;
      }
      buffer += chunk;
    };
    const onEnd = (): void => { cleanup(); resolve(buffer); };
    const onError = (err: unknown): void => { cleanup(); reject(err); };
    const onAbort = (): void => {
      cleanup();
      pauseStdin();
      reject(limits.signal?.reason ?? new Error('stdin read aborted'));
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    limits.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface BodyFlags {
  body?: string;
  'body-file'?: string;
}

export interface ReadBodyFromFlagsOptions {
  /** Defaults to a bounded, cancellable `node:fs` stream read; inject for tests. */
  readFile?: (requiredArgs: { path: string }) => Promise<string>;
  /** Defaults to a bounded, cancellable drain of `process.stdin`'s async iterator as utf8; inject for tests. */
  readStdin?: () => Promise<string>;
  /** Maximum bytes the default readFile/readStdin will read before rejecting. Defaults to 10 MiB. No effect on an injected reader. */
  maxBytes?: number;
  /** Cancels an in-progress default readFile/readStdin call. No effect on an injected reader. */
  signal?: AbortSignal;
}

/**
 * Resolve long-form body text from `--body` (inline — an empty string counts
 * as provided) or `--body-file <path>` / `--body-file -` (stdin). Returns
 * `undefined` when neither flag is present, so callers can distinguish "not
 * provided" from an intentionally empty body — unlike {@link
 * readPromptFromFlags}, which treats an empty `--prompt` as unset, this
 * primitive's origin caller (`od memory tree edit`) needs to allow clearing
 * a body to an empty string.
 */
export async function readBodyFromFlags(
  { flags }: { flags: BodyFlags },
  options: ReadBodyFromFlagsOptions = {},
): Promise<string | undefined> {
  if (typeof flags.body === 'string') return flags.body;
  const bodyFile = flags['body-file'];
  if (typeof bodyFile !== 'string') return undefined;
  const readLimits = { maxBytes: options.maxBytes ?? DEFAULT_MAX_READ_BYTES, ...(options.signal !== undefined ? { signal: options.signal } : {}) };
  if (bodyFile === '-') {
    const readStdin = options.readStdin ?? ((): Promise<string> => defaultReadBodyStdin(readLimits));
    return await readStdin();
  }
  const readFile = options.readFile ?? (({ path }: { path: string }): Promise<string> => defaultReadFile(path, readLimits));
  return await readFile({ path: bodyFile });
}

async function defaultReadBodyStdin(limits: ReadLimits): Promise<string> {
  limits.signal?.throwIfAborted();
  const stdin = process.stdin as unknown as AsyncIterable<string | Buffer> & { destroy?: (err?: Error) => void };
  const onAbort = (): void => { stdin.destroy?.(new Error('stdin read aborted')); };
  limits.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let body = '';
    let total = 0;
    for await (const chunk of stdin) {
      limits.signal?.throwIfAborted();
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      total += Buffer.byteLength(text, 'utf8');
      if (total > limits.maxBytes) {
        stdin.destroy?.();
        throw new PayloadTooLargeError({ message: `stdin exceeded the ${limits.maxBytes}-byte limit` });
      }
      body += text;
    }
    return body;
  } finally {
    limits.signal?.removeEventListener('abort', onAbort);
  }
}
