// Table-driven argv parsing shared by the web-clone CLI scripts. Each script
// declares its flags as data instead of a long if/else chain, so the
// per-flag fallbacks ("--wait" with no value → the default) stay identical
// to the hand-written parsers they replace while keeping each script small.

/**
 * Parse `argv` against an option table.
 *
 * @param {{ argv: string[], defaults: object, options: Record<string, { key: string, flag?: boolean, parse?: (raw: string | undefined) => unknown }> }} required
 *   `argv` is the arguments after `node <script>`. `flag` options set `key` to
 *   true without consuming a value; value options consume the next argv entry
 *   (possibly `undefined`) and store `parse(raw)`.
 * @param {{ strict?: boolean }} [optional]
 *   `strict` (default true) throws on an unknown argument; non-strict
 *   silently skips it, matching scripts that historically ignored extras.
 * @returns {object} a fresh object: `defaults` overlaid with parsed values.
 * @throws {Error} `Unexpected argument: <arg>` in strict mode.
 */
export function parseCliArgs({ argv, defaults, options }, { strict = true } = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // Own-property lookup only: "constructor"/"__proto__" are not flags.
    const option = Object.hasOwn(options, arg) ? options[arg] : undefined;
    if (!option) {
      if (strict) throw new Error(`Unexpected argument: ${arg}`);
      continue;
    }
    if (option.flag) {
      out[option.key] = true;
      continue;
    }
    i += 1;
    out[option.key] = option.parse(argv[i]);
  }
  return out;
}

/** Value parser: the raw string, or `fallback` when missing/empty. */
export const text = (fallback) => (raw) => raw || fallback;

/** Value parser: `Number(raw || fallback)` (so "--wait" alone → the default). */
export const num = (fallback) => (raw) => Number(raw || fallback);

/** Value parser: `parseInt(raw || fallback, 10)`. */
export const int = (fallback) => (raw) => parseInt(raw || fallback, 10);

/** The `--help` / `-h` pair every script accepts. */
export const HELP_OPTIONS = {
  "--help": { key: "help", flag: true },
  "-h": { key: "help", flag: true },
};
