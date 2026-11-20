type ThemeTokens = Record<string, string>;

/**
 * @file Aliases for the design-token names a model (or a person) commonly GUESSES, pointed at the
 * names the active theme actually defines.
 *
 * Why this exists (demo video V1, 2026-10-05): an assistant-written HTML page styled its heading
 * `color: var(--text, #1f1f1f)`. No shipped theme defines `--text` — they say `--fg` (or `--ink`) — so
 * the literal fallback won, and a fallback is right in only one colour mode: dark-gray text on the dark
 * theme's near-black page. A host's page-writing contract should name the real tokens; this is the defensive half for content that guesses anyway, and for every page already
 * written with a guessed name. An alias is emitted only when the theme does NOT define that name
 * itself (a theme's own value always wins) and only when one of its targets exists (an alias to an
 * undefined token would just re-create the dangling reference it is meant to fix).
 *
 * Declared on the same `:root` rule as the theme's dark tokens: `var()` in a custom property resolves
 * on the element that declares it, and `:root[data-theme="light"]` overrides `--fg` on that SAME
 * element — so `--text: var(--fg)` follows the light/dark toggle without a second declaration.
 */

/** Guessed name -> the theme token names it may stand for, in preference order. */
const TOKEN_ALIASES: ReadonlyArray<readonly [alias: string, targets: readonly string[]]> = [
  ["--text", ["--fg", "--ink"]],
  ["--text-strong", ["--fg", "--ink"]],
  ["--text-color", ["--fg", "--ink"]],
  ["--color-text", ["--fg", "--ink"]],
  ["--foreground", ["--fg", "--ink"]],
  ["--heading-color", ["--fg", "--ink"]],
  ["--text-muted", ["--muted"]],
  ["--text-secondary", ["--muted"]],
  ["--surface-muted", ["--surface-2", "--surface"]],
  ["--font-heading", ["--font-display"]],
];

/**
 * The `[alias, "var(--target)"]` declarations to add to a theme's `:root` token block.
 *
 * @param required.tokens The theme's dark/default token set (`tokens.json`).
 * @param required.tokensLight The theme's light override set; a name defined only here still counts
 *   as the theme's own and is never aliased. Optional for tiers that emit no light block.
 * @returns Declarations in {@link TOKEN_ALIASES} order; empty when the theme defines no alias target.
 * @complexity O(a · t) over the fixed alias table — constant per call.
 */
export function themeTokenAliasDeclarations(required: { tokens: ThemeTokens; tokensLight?: ThemeTokens }): Array<[string, string]> {
  const defined = ({ name }: { name: string }, _optional = {}): boolean => name in required.tokens || (required.tokensLight !== undefined && name in required.tokensLight);
  const declarations: Array<[string, string]> = [];
  for (const [alias, targets] of TOKEN_ALIASES) {
    if (defined({ name: alias })) continue;
    const target = targets.find((candidate) => candidate in required.tokens);
    if (target !== undefined) declarations.push([alias, `var(${target})`]);
  }
  return declarations;
}
