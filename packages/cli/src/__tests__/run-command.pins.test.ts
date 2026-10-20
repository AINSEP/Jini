/**
 * Characterization pins for `run-command.ts`'s `watchRunEvents` (resume header, failure
 * mapping, terminal-event stop) and the shared help short-circuit, written against the
 * pre-refactor code so splitting `watchRunEvents` and deduplicating the help check are proven
 * behaviour-preserving.
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../command-registry.js';
import { registerRunCommands, runCancelCommand, runGetCommand, runListCommand, runStartCommand, runWatchCommand, watchRunEvents, type RunCommandDeps } from '../run-command.js';

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

interface Rec {
  readonly out: string[];
  readonly err: string[];
  readonly exits: number[];
  readonly headers: Record<string, string>[];
  readonly deps: Omit<RunCommandDeps, 'resolveBaseUrl'>;
}

function rec(respond: () => Response): Rec {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    headers.push({ ...(init?.headers as Record<string, string> | undefined) });
    return respond();
  };
  return {
    out, err, exits, headers,
    deps: {
      fetchImpl,
      write: ({ text }) => { out.push(text); },
      writeErr: ({ text }) => { err.push(text); },
      exit: ({ code }) => { exits.push(code); throw new ExitSentinel(code); },
    },
  };
}

function sse(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }));
}

function errorEnvelope(r: Rec): { error: { code: string; message: string } } {
  return JSON.parse(r.err.join('').trim()) as { error: { code: string; message: string } };
}

describe('run-command pins: watchRunEvents', () => {
  it('omits last-event-id for an empty --after-cursor', async () => {
    const r = rec(() => sse(''));
    await watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: ['--after-cursor='] }, r.deps);
    expect(r.headers).toEqual([{}]);
  });

  it('sends last-event-id for a non-empty --after-cursor', async () => {
    const r = rec(() => sse(''));
    await watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: ['--after-cursor', 'c1'] }, r.deps);
    expect(r.headers).toEqual([{ 'last-event-id': 'c1' }]);
  });

  it('maps an ok response with a null body to the daemon-not-running fallback', async () => {
    const r = rec(() => new Response(null, { status: 200 }));
    await expect(watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: [] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(r.exits).toEqual([64]);
    expect(errorEnvelope(r).error).toMatchObject({ code: 'daemon-not-running', message: 'HTTP 200' });
  });

  it('maps a non-ok response through structuredHttpFailure', async () => {
    const r = rec(() => Response.json({ error: { code: 'missing-input', message: 'no run' } }, { status: 404 }));
    await expect(watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: [] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(r.exits).toEqual([67]);
    expect(errorEnvelope(r).error).toMatchObject({ code: 'missing-input', message: 'no run' });
  });

  it('stops at the terminal end event, skipping data-less frames and stripping control sequences', async () => {
    const r = rec(() => sse('event: ping\n\ndata: {"kind":"x","t":"\u001b[31mred"}\n\ndata: {"kind":"end"}\n\ndata: {"kind":"after"}\n\n'));
    await watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: [] }, r.deps);
    expect(r.out).toEqual(['{"kind":"x","t":"red"}\n', '{"kind":"end"}\n']);
  });

  it('writes non-JSON frames and returns when the stream closes without an end event', async () => {
    const r = rec(() => sse('data: not json\n\n'));
    await watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: [] }, r.deps);
    expect(r.out).toEqual(['not json\n']);
  });

  it('maps a non-Error stream failure to daemon-not-running with its String() form', async () => {
    const r = rec(() => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error('stream broke'); } })));
    await expect(watchRunEvents({ baseUrl: 'http://d', runId: 'r', args: [] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(errorEnvelope(r).error).toMatchObject({ code: 'daemon-not-running', message: 'stream broke' });
  });
});

describe('run-command pins: help short-circuit and base URL port', () => {
  const commands = { start: runStartCommand, list: runListCommand, get: runGetCommand, cancel: runCancelCommand, watch: runWatchCommand };
  for (const [name, command] of Object.entries(commands)) {
    for (const flag of ['--help', '-h']) {
      it(`run ${name} ${flag} prints its usage without resolving the base URL`, async () => {
        const r = rec(() => Response.json({}));
        let resolved = 0;
        await command({ args: ['x', flag], resolveBaseUrl: () => { resolved++; return 'http://d'; } }, r.deps);
        expect(r.out.join('')).toContain(`run ${name}`);
        expect(resolved).toBe(0);
      });
    }
  }

  it('accepts a synchronous resolveBaseUrl port', async () => {
    const r = rec(() => Response.json({ id: 'r1' }));
    await runGetCommand({ args: ['r1'], resolveBaseUrl: () => 'http://d' }, r.deps);
    expect(r.out).toEqual(['{"id":"r1"}\n']);
  });

  it('accepts an asynchronous resolveBaseUrl port', async () => {
    const r = rec(() => Response.json({ id: 'r2' }));
    await runGetCommand({ args: ['r2'], resolveBaseUrl: async () => 'http://d' }, r.deps);
    expect(r.out).toEqual(['{"id":"r2"}\n']);
  });

  it('reports an unknown run subcommand as invalid-flag', async () => {
    const r = rec(() => Response.json({}));
    const registry = new CommandRegistry({});
    registerRunCommands({ registry, resolveBaseUrl: () => 'http://d' }, r.deps);
    await expect(registry.dispatch({ argv: ['run', 'bogus'] })).rejects.toBeInstanceOf(ExitSentinel);
    expect(errorEnvelope(r).error).toMatchObject({ code: 'invalid-flag', message: 'unknown "run" subcommand: bogus' });
  });
});
