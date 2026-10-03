/**
 * @module flags
 *
 * Generic `argv` → flags parsing, ported from OD's `apps/daemon/src/cli.ts`
 * `parseFlags`/`positionalArgs`/`collectCliPositionals` (see `archived provenance ledger`).
 * Zero product nouns: callers declare which `--flag` names take a string
 * value vs. are booleans, and get back a flat map plus the leftover
 * positional tokens.
 */

/** A flag's value: `true` for a bare boolean flag, otherwise its string value. */
export type FlagValue = string | boolean;

/** The parsed `--flag`/`--flag=value` map produced by {@link parseFlags}. */
export type ParsedFlags = Record<string, FlagValue>;

export interface ParseFlagsOptions {
  /** Flag names (without leading `--`) that always consume the next token as a string value. */
  string?: ReadonlySet<string>;
  /** Flag names (without leading `--`) that never consume a value — presence alone means `true`. */
  boolean?: ReadonlySet<string>;
}

/**
 * Parse `--flag value`, `--flag=value`, and bare boolean `--flag` tokens out
 * of `argv`. Non-`--`-prefixed tokens (positionals) are silently skipped —
 * use {@link positionalArgs} to collect those.
 *
 * When either `string` or `boolean` is non-empty, an unrecognized `--flag`
 * throws (fail-fast: a hallucinated flag from an LLM-driven caller should
 * error immediately rather than silently no-op). When both are empty, every
 * `--flag` is accepted and a heuristic decides string-vs-boolean: if the
 * next token doesn't itself look like a flag, it's consumed as the value.
 */
export function parseFlags({ argv }: { argv: readonly string[] }, opts: ParseFlagsOptions = {}): ParsedFlags {
  const stringFlags = opts.string ?? new Set<string>();
  const booleanFlags = opts.boolean ?? new Set<string>();
  const knownFlags = new Set<string>([...stringFlags, ...booleanFlags]);
  const out: ParsedFlags = {};

  for (let i = 0; i < argv.length; i++) {
    // Loop is bounded by argv.length, so this index is always in range —
    // noUncheckedIndexedAccess types it as possibly-undefined regardless.
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;

    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (knownFlags.size > 0 && !knownFlags.has(key)) {
      throw new Error(`unknown flag: --${key}. Run with --help for the list of accepted flags.`);
    }

    if (eq >= 0) {
      out[key] = a.slice(eq + 1);
      continue;
    }
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    if (stringFlags.has(key)) {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`flag --${key} requires a value`);
      }
      out[key] = next;
      i++;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export interface PositionalArgsOptions {
  /** String-valued flag names whose value token must be skipped, not collected as a positional. */
  string?: ReadonlySet<string>;
  /**
   * When `true`, a bare `--` token stops flag-skipping and every remaining
   * token (including ones that look like `--flags`) is collected verbatim.
   * Mirrors the shell `--` convention (`collectCliPositionals` in the OD
   * source). Defaults to `false`.
   */
  stopAtDoubleDash?: boolean;
}

/**
 * Collect every non-flag token from `argv`, skipping the value token that
 * follows a known string flag (so `od run start --project p1 foo` yields
 * `['foo']`, not `['p1', 'foo']`).
 */
export function positionalArgs({ argv }: { argv: readonly string[] }, opts: PositionalArgsOptions = {}): string[] {
  const stringFlags = opts.string ?? new Set<string>();
  const out: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    // Loop is bounded by argv.length, so this index is always in range —
    // noUncheckedIndexedAccess types it as possibly-undefined regardless.
    const a = argv[i]!;
    if (opts.stopAtDoubleDash === true && a === '--') {
      out.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (eq < 0 && stringFlags.has(key)) i++;
  }
  return out;
}

/** The native type {@link coerceCliValue} can produce from a raw string flag value. */
export type CoercedCliValue = boolean | number | string;

const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Coerce a raw `--flag <value>` string into its likely native type:
 * `'true'`/`'false'` become booleans, a numeric-looking string becomes a
 * `number`, and anything else passes through unchanged. Ported from OD's
 * `cli.ts` `coerceCliValue` (see `archived provenance ledger`) — used wherever a CLI
 * accepts an untyped string flag value that application code should receive
 * as its natural type (e.g. a config `set` command, or a plugin's dynamic
 * `--input` flags forwarded as a JSON-typed payload).
 */
export function coerceCliValue({ raw }: { raw: string }): CoercedCliValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (NUMERIC_LITERAL_RE.test(raw)) return Number(raw);
  return raw;
}
