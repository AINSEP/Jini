/**
 * @module command-registry
 *
 * The generic dispatcher shape behind OD's `SUBCOMMAND_MAP` (see
 * `source-map.md`): look at the first non-flag `argv` token, dispatch to a
 * registered handler, or report that nothing matched so the caller can fall
 * back to root help. OD's actual map (33 product command names) was not
 * ported — only the registrar pattern, which is what `@injini/core`'s
 * `Pack['cli']` hook (`cli?: (reg: unknown, services: Services) => void`)
 * needs a concrete `reg` type for.
 */

export type CommandHandler = (args: readonly string[]) => void | Promise<void>;

interface RegisteredCommand {
  name: string;
  handler: CommandHandler;
  usage?: string;
}

export type CommandDispatchResult =
  | { kind: 'handled' }
  | { kind: 'not-found'; name: string }
  | { kind: 'empty' };

export interface AddCommandOptions {
  usage?: string;
  /**
   * Set to `true` to intentionally replace an existing registration for
   * `name`. Defaults to `false`, in which case re-registering an already-used
   * name throws instead of silently replacing it — per CR-004/SEC-RB-009
   * (`ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`,
   * `ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`),
   * a silent overwrite is how a later-loaded pack could replace a trusted
   * command by name with no way for the caller to detect it.
   */
  override?: boolean;
}

export interface CommandDispatchOptions {
  /**
   * Global `--flag` names (without the leading `--`) that consume the
   * following token as a value, so the command-name scan skips over it
   * instead of mistaking it for the subcommand. Pass the same set used to
   * parse global flags (see {@link parseFlags}'s `string` option in
   * `flags.ts`) — e.g. `new Set(['daemon-url'])` so
   * `--daemon-url http://127.0.0.1:4111 run` dispatches to `run`, not to the
   * URL. Defaults to an empty set (no global value-flags known), matching
   * this package's previous behavior for any flag not listed here.
   */
  valueFlags?: ReadonlySet<string>;
}

/**
 * A name → handler table for top-level CLI subcommands, with first-non-flag
 * dispatch matching OD's `cli.ts` root router (`argv.find(a =>
 * !a.startsWith('-'))`, then the remaining tokens minus that one name are
 * passed to the handler) — extended per CR-003
 * (`ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`)
 * to skip over a value-flag's value while scanning for the command name.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>();

  /**
   * Register a command. Throws if `name` is already registered — pass
   * `{ override: true }` to intentionally replace an existing registration.
   */
  add(name: string, handler: CommandHandler, opts: AddCommandOptions = {}): this {
    if (this.commands.has(name) && opts.override !== true) {
      throw new Error(
        `command "${name}" is already registered; pass { override: true } to replace it intentionally`,
      );
    }
    this.commands.set(name, { name, handler, ...(opts.usage !== undefined ? { usage: opts.usage } : {}) });
    return this;
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** The usage text registered alongside `name`, if any. */
  usageFor(name: string): string | undefined {
    return this.commands.get(name)?.usage;
  }

  /** Every registered command name, insertion order. */
  names(): string[] {
    return [...this.commands.keys()];
  }

  /**
   * Find the first non-`-`-prefixed token in `argv`, look up its handler,
   * and invoke it with every other token (flags before *and* after the
   * command name are preserved, matching OD's router). Returns `'empty'`
   * when `argv` has no positional token at all, `'not-found'` when one
   * exists but nothing is registered for it.
   *
   * Per CR-003, a naive `argv.find(t => !t.startsWith('-'))` scan
   * misidentifies a value-flag's own value as the command name (e.g.
   * `--daemon-url http://127.0.0.1:4111 run` would pick the URL). Pass
   * `options.valueFlags` — the set of global `--flag` names that consume the
   * next token as a value — so the scan skips over it instead.
   */
  async dispatch(argv: readonly string[], options: CommandDispatchOptions = {}): Promise<CommandDispatchResult> {
    const valueFlags = options.valueFlags ?? new Set<string>();

    let index = -1;
    for (let i = 0; i < argv.length; i++) {
      // Loop is bounded by argv.length, so this index is always in range —
      // noUncheckedIndexedAccess types it as possibly-undefined regardless.
      const token = argv[i]!;
      if (!token.startsWith('-')) {
        index = i;
        break;
      }
      if (token.startsWith('--')) {
        const eq = token.indexOf('=');
        if (eq < 0) {
          const key = token.slice(2);
          if (valueFlags.has(key)) i++; // skip this flag's value token
        }
      }
    }
    if (index === -1) return { kind: 'empty' };

    const name = argv[index]!;
    const command = this.commands.get(name);
    if (command === undefined) return { kind: 'not-found', name };

    const rest = [...argv.slice(0, index), ...argv.slice(index + 1)];
    await command.handler(rest);
    return { kind: 'handled' };
  }
}
