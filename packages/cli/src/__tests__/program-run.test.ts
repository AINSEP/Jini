import { describe, expect, it, vi } from 'vitest';
import type { CliOutcome } from '../cli-outcome.js';
import { printBareUsage, printUsage, runCliProgram, type RunnableProgram } from '../program-run.js';

function fakeProgram(parse: () => Promise<unknown> = async () => undefined): RunnableProgram & { parseAsync: ReturnType<typeof vi.fn> } {
  return { helpInformation: () => 'Usage: demo [command]\n', parseAsync: vi.fn(parse) };
}

function effects() {
  const out: string[] = [];
  const err: string[] = [];
  const exits: number[] = [];
  return {
    out, err, exits,
    stdout: { write: (text: string) => { out.push(text); } },
    stderr: { write: (text: string) => { err.push(text); } },
    exit: (code: number) => { exits.push(code); },
  };
}

describe('runCliProgram', () => {
  it('bare argv writes help to stdout and exits 0 without calling parseAsync', async () => {
    const program = fakeProgram();
    const io = effects();
    await runCliProgram({ createProgram: () => program, mapError: () => ({ exitCode: 1 }), argv: [], ...io });
    expect(io.out).toEqual(['Usage: demo [command]\n']);
    expect(io.err).toEqual([]);
    expect(io.exits).toEqual([0]);
    expect(program.parseAsync).not.toHaveBeenCalled();
  });

  it('passes argv to parseAsync as user arguments', async () => {
    const program = fakeProgram();
    const io = effects();
    await runCliProgram({ createProgram: () => program, mapError: () => ({ exitCode: 1 }), argv: ['serve', '--port', '1'], ...io });
    expect(program.parseAsync).toHaveBeenCalledWith(['serve', '--port', '1'], { from: 'user' });
    expect(io.exits).toEqual([]);
  });

  it('a rejected parseAsync writes exactly one stderr line then exits with the mapped code', async () => {
    const failure = new Error('nope');
    const mapError = vi.fn((_args: { err: unknown }): CliOutcome => ({ exitCode: 5, stderrLine: 'demo: SITE_CORRUPT: nope' }));
    const io = effects();
    await runCliProgram({ createProgram: () => fakeProgram(async () => { throw failure; }), mapError, argv: ['x'], ...io });
    expect(mapError).toHaveBeenCalledWith({ err: failure });
    expect(io.err).toEqual(['demo: SITE_CORRUPT: nope\n']);
    expect(io.exits).toEqual([5]);
  });

  it('printUsage outcome appends help to stderr', async () => {
    const io = effects();
    await runCliProgram({
      createProgram: () => fakeProgram(async () => { throw new Error('unknown'); }),
      mapError: () => ({ exitCode: 2, stderrLine: "demo: VALIDATION: unknown command 'x'", printUsage: true }),
      argv: ['x'],
      ...io,
    });
    expect(io.err).toEqual(["demo: VALIDATION: unknown command 'x'\n", 'Usage: demo [command]\n']);
    expect(io.out).toEqual([]);
    expect(io.exits).toEqual([2]);
  });

  it('success outcome writes nothing to stderr', async () => {
    const io = effects();
    await runCliProgram({
      createProgram: () => fakeProgram(async () => { throw new Error('(outputHelp)'); }),
      mapError: () => ({ exitCode: 0 }),
      argv: ['--help'],
      ...io,
    });
    expect(io.err).toEqual([]);
    expect(io.exits).toEqual([0]);
  });
});

describe('usage printers', () => {
  it('printBareUsage writes to stdout and exits 0', () => {
    const io = effects();
    printBareUsage({ program: fakeProgram(), stdout: io.stdout, exit: io.exit });
    expect(io.out).toEqual(['Usage: demo [command]\n']);
    expect(io.exits).toEqual([0]);
  });

  it('printUsage writes to stderr only', () => {
    const io = effects();
    printUsage({ program: fakeProgram(), stderr: io.stderr });
    expect(io.err).toEqual(['Usage: demo [command]\n']);
    expect(io.out).toEqual([]);
  });
});
