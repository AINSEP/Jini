/**
 * @module usage
 *
 * The generic *shape* of every OD `print*Help` function, extracted from
 * `apps/daemon/src/cli.ts` (see `archived provenance ledger`): one or more usage
 * invocation lines, an optional prose description, and an optional flat
 * list of `--option` descriptions. OD's actual help text is 100% product
 * content and was not ported — only the rendering convention.
 */

export interface UsageOption {
  flag: string;
  description: string;
}

export interface UsageSpec {
  /** One or more `cmd sub <arg>` invocation lines. */
  usage: readonly string[];
}

export interface UsageOptions {
  /** Optional prose shown after the usage lines. */
  description?: string;
  /** Optional flat `--flag` reference list. */
  options?: readonly UsageOption[];
}

/** Render a {@link UsageSpec} into the "Usage:\n  ...\n\nOptions:\n  ..." text every OD help command used. */
export function renderUsage({ usage }: UsageSpec, options: UsageOptions = {}): string {
  const lines: string[] = ['Usage:', ...usage.map((line) => `  ${line}`)];

  if (options.description !== undefined && options.description.length > 0) {
    lines.push('', options.description);
  }

  if (options.options !== undefined && options.options.length > 0) {
    const longest = Math.max(...options.options.map((option) => option.flag.length));
    lines.push('', 'Options:');
    for (const option of options.options) {
      lines.push(`  ${option.flag.padEnd(longest)}  ${option.description}`);
    }
  }

  return lines.join('\n');
}
