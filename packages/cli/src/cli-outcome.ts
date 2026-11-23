/**
 * @module cli-outcome
 *
 * Generic "thrown value → process outcome" mapping for a host bin. The host owns its exit-code
 * table, its error classes and the ORDER its classifiers run in; this module owns the mechanism:
 * ordered classifiers, parser (argv) error recognition, `instanceof` coded rules, then `INTERNAL`.
 *
 * Parser codes are kept as plain strings (commander's code names) so Jini never imports a parser
 * library; the host says which thrown values are parser errors through `isParserError`.
 */

/** What a bin does after a command throws: exit code, the one stderr line, and whether usage follows. */
export interface CliOutcome {
  exitCode: number;
  /** The single `<bin>: <CODE>: <message>` stderr line — omitted for a pure success outcome (`--help`). */
  stderrLine?: string;
  /** An unknown command must also print usage, beyond the one-line error contract. */
  printUsage?: boolean;
}

/** One host classifier: returns an outcome when it recognises `err`, otherwise `undefined`. */
export type CliOutcomeClassifier = (required: { err: unknown }) => CliOutcome | undefined;

/** An error class that carries its own stable code; matched by `instanceof`, never by `.name`. */
export interface CodedErrorRule {
  type: abstract new (...args: never[]) => Error;
  code: string;
}

/** Structural shape of an argv-parser error (commander's `CommanderError` satisfies it). */
export interface ParserErrorLike {
  code: string;
  message: string;
}

/** Host exit-code table; must contain `VALIDATION` and `INTERNAL`. */
export type CliExitCodeTable = Readonly<Record<string, number>>;

/** Parser error codes that are usage-class failures — the host's `VALIDATION` exit. */
export const PARSER_VALIDATION_CODES: ReadonlySet<string> = new Set([
  'commander.missingArgument',
  'commander.invalidArgument',
  'commander.excessArguments',
  'commander.unknownOption',
  'commander.unknownCommand',
  'commander.missingMandatoryOptionValue',
  'commander.optionMissingArgument',
]);

/** Parser error codes that represent a SUCCESSFUL outcome (help/version already printed by the parser itself). */
export const PARSER_SUCCESS_CODES: ReadonlySet<string> = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
]);

/**
 * Format the one stderr line a failed command prints.
 * @returns `<binName>: <code>: <message>`.
 * @complexity O(1).
 */
export function formatStderrLine(
  { binName, code, message }: { binName: string; code: string; message: string },
  _optional: Record<string, never> = {},
): string {
  return `${binName}: ${code}: ${message}`;
}

function requireExitCode({ exitCodes, code }: { exitCodes: CliExitCodeTable; code: string }): number {
  const exitCode = exitCodes[code];
  // Fail at construction, not on the first failing command in production.
  if (typeof exitCode !== 'number') throw new Error(`cli-outcome: exitCodes has no entry for "${code}"`);
  return exitCode;
}

/**
 * Map a recognised parser error to its outcome.
 * @param required.err - a value the host already identified as a parser error.
 * @returns exit 0 with no line for help/version; otherwise `VALIDATION` with the parser's
 *   leading `error: ` stripped, and `printUsage` only for an unknown command.
 * @complexity O(1).
 */
export function mapParserError(
  { err, binName, exitCodes }: { err: ParserErrorLike; binName: string; exitCodes: CliExitCodeTable },
  _optional: Record<string, never> = {},
): CliOutcome {
  if (PARSER_SUCCESS_CODES.has(err.code)) return { exitCode: 0 };
  const outcome = {
    exitCode: requireExitCode({ exitCodes, code: 'VALIDATION' }),
    stderrLine: formatStderrLine({ binName, code: 'VALIDATION', message: err.message.replace(/^error:\s*/, '') }),
  };
  if (PARSER_VALIDATION_CODES.has(err.code)) {
    return { ...outcome, printUsage: err.code === 'commander.unknownCommand' };
  }
  // Any other parser-internal error is still an argv-shape/usage problem — a parser configured to
  // throw instead of exiting only ever throws for parsing/dispatch issues.
  return outcome;
}

/**
 * Build the parser classifier a host places in its ordered classifier list.
 * @param required.isParserError - host predicate (e.g. `err instanceof CommanderError`).
 * @throws when `exitCodes` lacks `VALIDATION`.
 * @complexity O(1) per call.
 */
export function createParserClassifier(
  { binName, exitCodes, isParserError }: {
    binName: string;
    exitCodes: CliExitCodeTable;
    isParserError: (err: unknown) => err is ParserErrorLike;
  },
  _optional: Record<string, never> = {},
): CliOutcomeClassifier {
  requireExitCode({ exitCodes, code: 'VALIDATION' });
  return ({ err }) => (isParserError(err) ? mapParserError({ err, binName, exitCodes }) : undefined);
}

/**
 * Match `err` against coded rules in order, by `instanceof` only.
 * @returns the first matching rule's outcome, or `undefined`.
 * @complexity O(r) for r rules.
 */
export function mapCodedError(
  { err, rules, binName, exitCodes }: {
    err: unknown;
    rules: readonly CodedErrorRule[];
    binName: string;
    exitCodes: CliExitCodeTable;
  },
  _optional: Record<string, never> = {},
): CliOutcome | undefined {
  for (const { type, code } of rules) {
    if (err instanceof type) {
      return { exitCode: requireExitCode({ exitCodes, code }), stderrLine: formatStderrLine({ binName, code, message: err.message }) };
    }
  }
  return undefined;
}

/**
 * Build the host's whole error → outcome mapper.
 * Order: `classifiers` in the host's order (the parser classifier is one of them, so the host
 * decides what may pre-empt it), then `codedErrors`, then `INTERNAL` for anything else.
 * @throws at construction when `exitCodes` lacks `VALIDATION`/`INTERNAL` or a coded rule's code.
 * @complexity O(c + r) per call for c classifiers and r rules.
 */
export function createCliOutcomeMapper(
  { binName, exitCodes, classifiers, codedErrors }: {
    binName: string;
    exitCodes: CliExitCodeTable;
    classifiers: readonly CliOutcomeClassifier[];
    codedErrors: readonly CodedErrorRule[];
  },
  _optional: Record<string, never> = {},
): (required: { err: unknown }, _optional?: Record<string, never>) => CliOutcome {
  requireExitCode({ exitCodes, code: 'VALIDATION' });
  const internalExit = requireExitCode({ exitCodes, code: 'INTERNAL' });
  for (const { code } of codedErrors) requireExitCode({ exitCodes, code });
  return ({ err }) => {
    for (const classify of classifiers) {
      const outcome = classify({ err });
      if (outcome) return outcome;
    }
    const coded = mapCodedError({ err, rules: codedErrors, binName, exitCodes });
    if (coded) return coded;
    // "INTERNAL | any uncaught error": a non-Error throwable still gets a readable line.
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: internalExit, stderrLine: formatStderrLine({ binName, code: 'INTERNAL', message }) };
  };
}
