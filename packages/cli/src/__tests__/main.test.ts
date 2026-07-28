import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeDaemonRegistryRecord } from '@jini-ai/sidecar';
import { DEFAULT_CLI_EXIT_CODES } from '../errors.js';
import { main, type MainDeps } from '../main.js';

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeDeps(overrides: Partial<MainDeps> = {}): MainDeps & { written: string[]; errWritten: string[] } {
  const written: string[] = [];
  const errWritten: string[] = [];
  return {
    write: (text: string) => { written.push(text); },
    writeErr: (text: string) => { errWritten.push(text); },
    written,
    errWritten,
    ...overrides,
  };
}

function exitingDeps(overrides: Partial<MainDeps> = {}) {
  const deps = makeDeps(overrides);
  const exit = vi.fn((code: number): never => { throw new ExitSentinel(code); });
  return { ...deps, exit };
}

const tempDirs: string[] = [];
async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jini-cli-main-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('main: no-command / help', () => {
  it('prints root usage for an empty argv', async () => {
    const deps = makeDeps();
    await main([], deps);
    expect(deps.written.join('')).toContain('Usage:');
    expect(deps.written.join('')).toContain('jini <command>');
  });

  it('prints root usage for --help', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await main(['--help'], { ...deps, fetchImpl });
    expect(deps.written.join('')).toContain('Usage:');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prints root usage for -h', async () => {
    const deps = makeDeps();
    await main(['-h'], deps);
    expect(deps.written.join('')).toContain('Usage:');
  });

  it('prints root usage when only global flags are given, with no command at all', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn();
    await main(['--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(deps.written.join('')).toContain('Usage:');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults write to process.stdout.write when nothing is injected', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await main([]);
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

describe('main: dispatching to registered commands', () => {
  it('dispatches "run list" and reaches @jini-ai/http\'s /api/runs route', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://d.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.written[0]).toBe(`${JSON.stringify({ runs: [] })}\n`);
  });

  it('dispatches "run get <runId>"', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://d.example/api/runs/run-1');
      return jsonResponse(200, { run: { id: 'run-1' } });
    });
    await main(['run', 'get', 'run-1', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches "daemon status"', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://d.example/api/daemon/status');
      return jsonResponse(200, { ok: true, version: '1.2.3' });
    });
    await main(['daemon', 'status', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches "version"', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '1.2.3' }));
    await main(['version', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(deps.written[0]).toBe('1.2.3\n');
  });

  it('treats a leading --version as an alias for "jini version"', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '9.9.9' }));
    await main(['--version', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(deps.written[0]).toBe('9.9.9\n');
  });

  it('treats a leading -v as an alias for "jini version"', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { version: '9.9.9' }));
    await main(['-v', '--daemon-url', 'http://d.example'], { ...deps, fetchImpl });
    expect(deps.written[0]).toBe('9.9.9\n');
  });

  it('exits with invalid-flag for an unrecognized top-level command', async () => {
    const deps = exitingDeps();
    await expect(main(['frobnicate'], deps)).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    expect(deps.errWritten.join('')).toContain('unknown command');
    expect(deps.errWritten.join('')).toContain('frobnicate');
  });
});

describe('main: daemon-url resolution', () => {
  it('accepts --daemon-url before the command name without corrupting subcommand dispatch', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://custom.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['--daemon-url', 'http://custom.example', 'run', 'list'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts --daemon-url after the subcommand', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://custom.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--daemon-url', 'http://custom.example'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts --daemon-url interleaved between the top-level command and its own subcommand token, without breaking the nested [sub, ...rest] dispatch', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://custom.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', '--daemon-url', 'http://custom.example', 'list'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts --daemon-url=value equals form', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://custom.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--daemon-url=http://custom.example'], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to a caller-provided env var name (JINI_DAEMON_URL) when no --daemon-url flag is given', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://env.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list'], { ...deps, fetchImpl, env: { JINI_DAEMON_URL: 'http://env.example' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('an explicit --daemon-url flag still wins over JINI_DAEMON_URL', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://flag.example/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--daemon-url', 'http://flag.example'], {
      ...deps,
      fetchImpl,
      env: { JINI_DAEMON_URL: 'http://env.example' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves a locally running daemon via --data-dir, backed by a real on-disk registry record', async () => {
    const dataDir = await makeTempDataDir();
    const { resolveDaemonRegistryPath } = await import('@jini-ai/sidecar');
    await writeDaemonRegistryRecord(resolveDaemonRegistryPath(dataDir), {
      url: 'http://127.0.0.1:54213',
      host: '127.0.0.1',
      port: 54213,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://127.0.0.1:54213/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--data-dir', dataDir], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves via an explicit --registry-path, taking precedence over --data-dir', async () => {
    const dataDir = await makeTempDataDir();
    const customDir = await makeTempDataDir();
    const registryPath = join(customDir, 'custom.json');
    await writeDaemonRegistryRecord(registryPath, {
      url: 'http://127.0.0.1:9999',
      host: '127.0.0.1',
      port: 9999,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    const deps = makeDeps();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://127.0.0.1:9999/api/runs');
      return jsonResponse(200, { runs: [] });
    });
    await main(['run', 'list', '--data-dir', dataDir, '--registry-path', registryPath], { ...deps, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly with no daemon URL resolved when nothing is configured at all', async () => {
    const deps = exitingDeps({ env: {} });
    await expect(main(['daemon', 'status'], deps)).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    expect(deps.errWritten.join('')).toContain('no daemon URL resolved');
  });

  it('warns (via writeErr) when the resolved daemon URL is neither loopback nor HTTPS', async () => {
    const deps = makeDeps();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { runs: [] }));
    await main(['run', 'list', '--daemon-url', 'http://example.com'], { ...deps, fetchImpl });
    expect(deps.errWritten.join('')).toContain('neither loopback nor HTTPS');
  });

  it('exits with invalid-flag when --daemon-url is the last token with no value', async () => {
    const deps = exitingDeps();
    await expect(main(['run', 'list', '--daemon-url'], deps)).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    expect(deps.errWritten.join('')).toContain('flag --daemon-url requires a value');
  });
});

describe('main: error boundary', () => {
  it('converts a raw error from a nested command\'s own flag parsing into a clean structured error, not a raw throw', async () => {
    const deps = exitingDeps();
    await expect(main(['run', 'start', '--bogus-flag', '--daemon-url', 'http://d.example'], deps)).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    expect(deps.errWritten.join('')).toContain('unknown flag: --bogus-flag');
  });

  it('propagates a nested command\'s own structured-error exit untouched, without re-wrapping it', async () => {
    const deps = exitingDeps();
    await expect(main(['run', 'start', '--daemon-url', 'http://d.example'], deps)).rejects.toThrow(ExitSentinel);
    // missing --context-ref => run-command.ts's own "missing-input" exit, not this file's generic "invalid-flag" wrap.
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['missing-input']);
    expect(deps.errWritten.join('')).toContain('--context-ref is required');
  });

  it('stringifies a non-Error thrown value before reformatting it into a structured error', async () => {
    const deps = exitingDeps();
    // A plain, non-Error throw reaching main()'s boundary before any exit call — simulated via
    // an `env` whose property access itself throws a bare string, triggered from inside
    // resolveDaemonUrl's env-var lookup (which main()'s own resolveBaseUrl closure calls from
    // deep inside the "run list" command handler, i.e. still within the try block).
    const throwingEnv = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'JINI_DAEMON_URL') throw 'raw string failure';
          return undefined;
        },
      },
    ) as NodeJS.ProcessEnv;
    const fetchImpl = vi.fn();
    await expect(main(['run', 'list'], { ...deps, env: throwingEnv, fetchImpl })).rejects.toThrow(ExitSentinel);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    expect(deps.errWritten.join('')).toContain('raw string failure');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults writeErr/exit to process.stderr/process.exit when nothing is injected', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new ExitSentinel(code ?? 0);
    }) as never);
    try {
      await expect(main(['frobnicate'])).rejects.toThrow(ExitSentinel);
      expect(stderrSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(DEFAULT_CLI_EXIT_CODES['invalid-flag']);
    } finally {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('module top-level entrypoint guard', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('runs main() for real when process.argv[1] matches this module\'s own resolved path', async () => {
    const modulePath = fileURLToPath(new URL('../main.ts', import.meta.url));
    process.argv = ['node', modulePath];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();
    try {
      await import('../main.js');
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('does not run main() for real when process.argv[1] does not match (e.g. imported under a test runner)', async () => {
    process.argv = ['node', '/some/unrelated/path/not-main.js'];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();
    try {
      await import('../main.js');
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('does not run main() for real when process.argv[1] is undefined', async () => {
    process.argv = ['node'];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.resetModules();
    try {
      await import('../main.js');
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
