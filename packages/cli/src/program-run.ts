/**
 * @module program-run
 *
 * The whole body of a host bin over any parser program exposing `helpInformation()` and
 * `parseAsync()` (commander's `Command` satisfies it structurally — no parser import here).
 * Every process effect (stdout, stderr, exit) is injected by the host's entry file.
 */
import type { CliOutcome } from './cli-outcome.js';

/** Structural parser program port. */
export interface RunnableProgram {
  helpInformation(): string;
  parseAsync(argv: string[], options: { from: 'user' }): Promise<unknown>;
}

/** A writable text stream (e.g. `process.stdout`). Called as a method so a real stream keeps its `this`. */
export interface CliTextSink {
  write(text: string): unknown;
}

/** Exit port (e.g. `(code) => process.exit(code)`); a test double may return. */
export type CliExit = (code: number) => void;

/**
 * Bare invocation: usage to stdout, exit 0.
 * Parsers commonly write usage to STDERR and exit 1 for a subcommand-style program with zero args;
 * the bin contract here is stdout + exit 0, matching `--help`, so the bin bypasses parsing entirely.
 * @complexity O(1).
 */
export function printBareUsage(
  { program, stdout, exit }: { program: RunnableProgram; stdout: CliTextSink; exit: CliExit },
  _optional: Record<string, never> = {},
): void {
  stdout.write(program.helpInformation());
  exit(0);
}

/**
 * Usage text to stderr — follows an unknown command's one-line error.
 * @complexity O(1).
 */
export function printUsage(
  { program, stderr }: { program: RunnableProgram; stderr: CliTextSink },
  _optional: Record<string, never> = {},
): void {
  stderr.write(program.helpInformation());
}

/**
 * Run a bin: bare argv prints usage; otherwise parse, and on any rejection write the mapped
 * stderr line (plus usage when asked) and exit with the mapped code. Never maps errors itself.
 * @param required.createProgram - builds the host's parser program.
 * @param required.mapError - the host's `createCliOutcomeMapper` result.
 * @param required.argv - user arguments (no node/script entries).
 * @complexity O(1) besides the host command itself.
 */
export async function runCliProgram(
  { createProgram, mapError, argv, stdout, stderr, exit }: {
    createProgram: () => RunnableProgram;
    mapError: (required: { err: unknown }) => CliOutcome;
    argv: string[];
    stdout: CliTextSink;
    stderr: CliTextSink;
    exit: CliExit;
  },
  _optional: Record<string, never> = {},
): Promise<void> {
  const program = createProgram();
  if (argv.length === 0) {
    printBareUsage({ program, stdout, exit });
    return;
  }
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    const outcome = mapError({ err });
    if (outcome.stderrLine) stderr.write(`${outcome.stderrLine}\n`);
    if (outcome.printUsage) printUsage({ program, stderr });
    exit(outcome.exitCode);
  }
}
