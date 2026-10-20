/**
 * Characterization pins for `main.ts`'s global-flag partitioning and dispatch boundary, written
 * against the pre-refactor code so splitting `partitionGlobalArgv`/`main` is proven
 * behaviour-preserving on odd argv shapes.
 */
import { describe, expect, it } from 'vitest';
import { main, type MainDeps } from '../main.js';

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

interface Recorded {
  readonly urls: string[];
  readonly out: string[];
  readonly err: string[];
  readonly exits: number[];
  readonly deps: MainDeps;
}

function record(env: NodeJS.ProcessEnv = {}): Recorded {
  const urls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ ok: true, version: '9.9.9' });
  };
  return {
    urls, out, err, exits,
    deps: {
      fetchImpl,
      env,
      write: ({ text }) => { out.push(text); },
      writeErr: ({ text }) => { err.push(text); },
      exit: ({ code }) => { exits.push(code); throw new ExitSentinel(code); },
    },
  };
}

function errorEnvelope(r: Recorded): { error: { code: string; message: string } } {
  return JSON.parse(r.err.join('').trim()) as { error: { code: string; message: string } };
}

describe('main pins: global flag partitioning', () => {
  it('lets the last of a repeated --daemon-url win', async () => {
    const r = record();
    await main({ argv: ['--daemon-url', 'http://127.0.0.1:1', 'run', 'get', 'r1', '--daemon-url', 'http://127.0.0.1:2'] }, r.deps);
    expect(r.urls).toEqual(['http://127.0.0.1:2/api/runs/r1']);
  });

  it('consumes the very next token as the value even when it looks like a flag', async () => {
    const r = record();
    await main({ argv: ['run', 'get', 'r1', '--daemon-url', '--data-dir'] }, r.deps);
    // `--data-dir` was swallowed as the daemon URL, so it is not treated as a discovery flag.
    expect(r.urls).toEqual(['--data-dir/api/runs/r1']);
  });

  it('accepts an empty --daemon-url= value and falls through to the env var', async () => {
    const r = record({ JINI_DAEMON_URL: 'http://127.0.0.1:3' });
    await main({ argv: ['run', 'get', 'r1', '--daemon-url='] }, r.deps);
    expect(r.urls).toEqual(['http://127.0.0.1:3/api/runs/r1']);
  });

  it('passes a non-global --flag=value token through to the subcommand untouched', async () => {
    const r = record();
    await main({ argv: ['--daemon-url=http://127.0.0.1:4', 'run', 'list', '--context-ref=a b'] }, r.deps);
    expect(r.urls).toEqual(['http://127.0.0.1:4/api/runs?contextRef=a%20b']);
  });

  it('passes a bare "--" token through to dispatch', async () => {
    const r = record();
    await main({ argv: ['--', '--daemon-url', 'http://127.0.0.1:5'] }, r.deps);
    expect(r.out.join('')).toContain('jini <command>');
    expect(r.urls).toEqual([]);
  });

  it('reports a missing --data-dir value as invalid-flag', async () => {
    const r = record();
    await expect(main({ argv: ['run', 'list', '--data-dir'] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(r.exits).toEqual([2]);
    expect(errorEnvelope(r).error).toEqual({ code: 'invalid-flag', message: 'flag --data-dir requires a value', data: {} });
  });

  it('reports a missing --registry-path value as invalid-flag', async () => {
    const r = record();
    await expect(main({ argv: ['--registry-path'] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(errorEnvelope(r).error.message).toBe('flag --registry-path requires a value');
  });
});

describe('main pins: first-token aliases', () => {
  it('does not treat -v as the version alias when it is not the first token', async () => {
    const r = record();
    await expect(main({ argv: ['--daemon-url', 'http://127.0.0.1:1', '-v'] }, r.deps)).resolves.toBeUndefined();
    expect(r.out.join('')).toContain('jini <command>');
    expect(r.urls).toEqual([]);
  });

  it('does not treat --help as root help when it is not the first token', async () => {
    const r = record();
    await main({ argv: ['run', '--help'] }, r.deps);
    expect(r.out.join('')).toContain('run <start|list|get|cancel|watch>');
  });

  it('a leading -h prints root usage even when an unknown command follows it', async () => {
    const r = record();
    await main({ argv: ['-h', 'bogus'] }, r.deps);
    expect(r.out.join('')).toContain('jini <command>');
    expect(r.exits).toEqual([]);
  });

  it('a leading --help prints root usage even when an unknown command follows it', async () => {
    const r = record();
    await main({ argv: ['--help', 'bogus'] }, r.deps);
    expect(r.out.join('')).toContain('jini <command>');
    expect(r.exits).toEqual([]);
  });

  it('keeps the tokens after a leading --version for the version command', async () => {
    const r = record();
    await main({ argv: ['--version', '--daemon-url', 'http://127.0.0.1:6'] }, r.deps);
    expect(r.urls).toHaveLength(1);
    expect(r.urls[0]?.startsWith('http://127.0.0.1:6/')).toBe(true);
  });

  it('names the unknown command in the not-found error', async () => {
    const r = record();
    await expect(main({ argv: ['bogus', '--daemon-url', 'http://x'] }, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(errorEnvelope(r).error.message).toBe('unknown command: "bogus". Run "jini --help" for usage.');
  });
});
