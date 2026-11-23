import { describe, expect, it } from 'vitest';
import {
  createCliOutcomeMapper,
  createParserClassifier,
  formatStderrLine,
  PARSER_SUCCESS_CODES,
  PARSER_VALIDATION_CODES,
  type CliOutcomeClassifier,
} from '../cli-outcome.js';

const EXIT_CODES = { VALIDATION: 2, INTERNAL: 1, PORT_IN_USE: 1, BUSY: 9 } as const;

class ParserError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
class BusyError extends Error {}
class OtherDomainError extends Error {}

const isParserError = (err: unknown): err is ParserError => err instanceof ParserError;
const parser = createParserClassifier({ binName: 'demo', exitCodes: EXIT_CODES, isParserError });

function mapper(classifiers: readonly CliOutcomeClassifier[] = [parser]) {
  return createCliOutcomeMapper({
    binName: 'demo',
    exitCodes: EXIT_CODES,
    classifiers,
    codedErrors: [{ type: BusyError, code: 'BUSY' }],
  });
}

describe('formatStderrLine', () => {
  it('prefixes the bin name and code', () => {
    expect(formatStderrLine({ binName: 'demo', code: 'VALIDATION', message: 'bad' })).toBe('demo: VALIDATION: bad');
  });
});

describe('createCliOutcomeMapper', () => {
  it('parser help/version codes map to exit 0 with no stderr line', () => {
    expect([...PARSER_SUCCESS_CODES].sort()).toEqual(['commander.help', 'commander.helpDisplayed', 'commander.version']);
    for (const code of PARSER_SUCCESS_CODES) {
      expect(mapper()({ err: new ParserError(code, '(outputHelp)') })).toEqual({ exitCode: 0 });
    }
  });

  it('each of the seven parser usage codes maps to VALIDATION exit with "<bin>: VALIDATION: <msg>" and the leading "error: " stripped', () => {
    expect(PARSER_VALIDATION_CODES.size).toBe(7);
    for (const code of PARSER_VALIDATION_CODES) {
      const outcome = mapper()({ err: new ParserError(code, "error: unknown option '--nope'") });
      expect(outcome.exitCode).toBe(2);
      expect(outcome.stderrLine).toBe("demo: VALIDATION: unknown option '--nope'");
    }
  });

  it('strips only a leading "error:" prefix, keeping later occurrences', () => {
    const outcome = mapper()({ err: new ParserError('commander.invalidArgument', 'error:   value error: x') });
    expect(outcome.stderrLine).toBe('demo: VALIDATION: value error: x');
  });

  it('only unknownCommand sets printUsage', () => {
    for (const code of PARSER_VALIDATION_CODES) {
      const outcome = mapper()({ err: new ParserError(code, 'error: x') });
      expect(outcome.printUsage).toBe(code === 'commander.unknownCommand');
    }
  });

  it('an unrecognised parser code still maps to VALIDATION without usage', () => {
    expect(mapper()({ err: new ParserError('commander.somethingNew', 'error: odd') })).toEqual({
      exitCode: 2,
      stderrLine: 'demo: VALIDATION: odd',
    });
  });

  it('classifiers run before coded rules (first match wins)', () => {
    const claimsBusy: CliOutcomeClassifier = ({ err }) => (err instanceof BusyError ? { exitCode: 42 } : undefined);
    expect(mapper([claimsBusy])({ err: new BusyError('b') })).toEqual({ exitCode: 42 });
  });

  it('Parser classification wins over a matching later classifier', () => {
    const catchAll: CliOutcomeClassifier = () => ({ exitCode: 77, stderrLine: 'demo: OTHER: claimed' });
    const outcome = mapper([parser, catchAll])({ err: new ParserError('commander.unknownOption', 'error: x') });
    expect(outcome).toEqual({ exitCode: 2, stderrLine: 'demo: VALIDATION: x', printUsage: false });
  });

  it('coded rules match by instanceof, never by .name', () => {
    expect(mapper()({ err: new BusyError('held') })).toEqual({ exitCode: 9, stderrLine: 'demo: BUSY: held' });
    const impostor = Object.assign(new OtherDomainError('looks busy'), { name: 'BusyError' });
    expect(mapper()({ err: impostor })).toEqual({ exitCode: 1, stderrLine: 'demo: INTERNAL: looks busy' });
    expect(mapper()({ err: { name: 'BusyError', message: 'plain' } })).toEqual({
      exitCode: 1,
      stderrLine: 'demo: INTERNAL: [object Object]',
    });
  });

  it('non-Error throwables map to INTERNAL with String(err)', () => {
    expect(mapper()({ err: 'boom' })).toEqual({ exitCode: 1, stderrLine: 'demo: INTERNAL: boom' });
    expect(mapper()({ err: undefined })).toEqual({ exitCode: 1, stderrLine: 'demo: INTERNAL: undefined' });
  });

  it('construction without VALIDATION or INTERNAL exit codes throws', () => {
    expect(() => createCliOutcomeMapper({ binName: 'demo', exitCodes: { VALIDATION: 2 }, classifiers: [], codedErrors: [] }))
      .toThrow(/INTERNAL/);
    expect(() => createParserClassifier({ binName: 'demo', exitCodes: { INTERNAL: 1 }, isParserError }))
      .toThrow(/VALIDATION/);
  });

  it('construction with a coded rule whose code has no exit code throws', () => {
    expect(() => createCliOutcomeMapper({
      binName: 'demo',
      exitCodes: { VALIDATION: 2, INTERNAL: 1 },
      classifiers: [],
      codedErrors: [{ type: BusyError, code: 'BUSY' }],
    })).toThrow(/BUSY/);
  });
});
