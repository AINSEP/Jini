import { defaultAdminTheme } from '../../../core/theme/default.js';

/**
 * @module features/mcp-ui/surfaces/tokens
 *
 * The design tokens every generated surface declares, and the reason they are declared *in the
 * document* rather than referenced from a stylesheet.
 *
 * A surface renders in a sandboxed, opaque-origin iframe with no network and no shared stylesheet.
 * An undeclared custom property there does not fall back to a host value — there is no host value
 * to fall back to — it resolves to nothing, and the declaration using it is dropped. So a token
 * referenced but not declared is not a degraded style, it is an invisible one: text with no color,
 * a button with no background. {@link renderTokenBlock} exists so every surface's first `<style>`
 * tag declares the complete set, always, and `var(--x, fallback)` is reserved for values that are
 * genuinely optional rather than used as insurance against this failure.
 *
 * The derived tokens below are `color-mix()` expressions over the base tokens rather than second
 * color literals. That is what makes the palette reskinnable: overriding `--jini-mcpui-accent`
 * alone moves the accent, its hover state, its focus ring, and its tinted background together,
 * because all four resolve through it.
 *
 * The sandbox cannot inherit the host's CSS. These names are a document adapter of
 * defaultAdminTheme; hosts forward their active values through the existing overrides port.
 *
 * ## Dark mode
 *
 * {@link SURFACE_TOKENS_DARK} is the same key set with dark values, applied by
 * {@link renderTokenBlock} inside a `@media (prefers-color-scheme: dark)` block that redeclares only
 * the base tokens — never {@link DERIVED_TOKENS}. A derived token's own declaration still says
 * `color-mix(in srgb, var(--jini-mcpui-accent) …)`; it does not need a dark-specific line because the
 * browser resolves that `var()` against whichever `--jini-mcpui-accent` cascades on the element at
 * used-value time, light or dark. Redeclaring a derived token per scheme would just be two ways to
 * get the same answer with an extra place for them to drift.
 *
 * Currently moot: {@link FORCE_LIGHT_SURFACE_THEME} suppresses the dark block entirely, because
 * `prefers-color-scheme` reads the OS/browser, not any real app theme — see that constant's own doc.
 */

/**
 * The base palette, radius scale, and font stack.
 *
 * Font stacks are system-only and always will be: a sandboxed iframe has no network, so an
 * `@import` or a `<link>` to a web font is a request that cannot be made, and the surface would
 * render in whatever the engine falls back to after a delay.
 */
export const SURFACE_TOKENS = {
  '--jini-mcpui-bg': defaultAdminTheme.light.bg,
  '--jini-mcpui-panel': defaultAdminTheme.light.surface,
  '--jini-mcpui-border': defaultAdminTheme.light.border,
  '--jini-mcpui-border-strong': defaultAdminTheme.light.border,
  '--jini-mcpui-text': defaultAdminTheme.light.text,
  '--jini-mcpui-text-strong': defaultAdminTheme.light.text,
  '--jini-mcpui-text-muted': defaultAdminTheme.light.muted,
  '--jini-mcpui-text-soft': defaultAdminTheme.light.muted,
  '--jini-mcpui-text-faint': defaultAdminTheme.light.muted,
  '--jini-mcpui-accent': defaultAdminTheme.light.primary,
  '--jini-mcpui-accent-strong': defaultAdminTheme.light.primary,
  // Desaturated and earthy, in the same family as the accent rather than a saturated pure red — a
  // destructive action should read as serious, not as an alarm the eye learns to discount.
  '--jini-mcpui-danger': defaultAdminTheme.light.danger,
  '--jini-mcpui-radius-xs': '4px',
  '--jini-mcpui-radius-sm': '6px',
  '--jini-mcpui-radius-md': '8px',
  '--jini-mcpui-radius-lg': '10px',
  '--jini-mcpui-radius-xl': '12px',
  '--jini-mcpui-radius-pill': '999px',
  '--jini-mcpui-font':
    defaultAdminTheme.fonts.body,
  '--jini-mcpui-font-mono': defaultAdminTheme.fonts.mono!,
} as const;

/** The token names a caller may override. */
export type SurfaceTokenName = keyof typeof SURFACE_TOKENS;

/**
 * The dark-scheme value for every token in {@link SURFACE_TOKENS}, keyed the same way and typed as
 * `Record<SurfaceTokenName, string>` rather than a partial — a token added to the light palette and
 * forgotten here would not fail to compile, so the full-parity type is what catches it instead.
 * Radius and font values are repeated verbatim: they do not change with scheme, but the record needs
 * every key regardless, and a value can only be omitted by weakening the type that guards this file
 * against exactly that omission.
 */
export const SURFACE_TOKENS_DARK: Record<SurfaceTokenName, string> = {
  '--jini-mcpui-bg': defaultAdminTheme.dark.bg,
  '--jini-mcpui-panel': defaultAdminTheme.dark.surface,
  '--jini-mcpui-border': defaultAdminTheme.dark.border,
  '--jini-mcpui-border-strong': defaultAdminTheme.dark.border,
  '--jini-mcpui-text': defaultAdminTheme.dark.text,
  '--jini-mcpui-text-strong': defaultAdminTheme.dark.text,
  '--jini-mcpui-text-muted': defaultAdminTheme.dark.muted,
  '--jini-mcpui-text-soft': defaultAdminTheme.dark.muted,
  '--jini-mcpui-text-faint': defaultAdminTheme.dark.muted,
  '--jini-mcpui-accent': defaultAdminTheme.dark.primary,
  '--jini-mcpui-accent-strong': defaultAdminTheme.dark.primary,
  '--jini-mcpui-danger': defaultAdminTheme.dark.danger,
  '--jini-mcpui-radius-xs': SURFACE_TOKENS['--jini-mcpui-radius-xs'],
  '--jini-mcpui-radius-sm': SURFACE_TOKENS['--jini-mcpui-radius-sm'],
  '--jini-mcpui-radius-md': SURFACE_TOKENS['--jini-mcpui-radius-md'],
  '--jini-mcpui-radius-lg': SURFACE_TOKENS['--jini-mcpui-radius-lg'],
  '--jini-mcpui-radius-xl': SURFACE_TOKENS['--jini-mcpui-radius-xl'],
  '--jini-mcpui-radius-pill': SURFACE_TOKENS['--jini-mcpui-radius-pill'],
  '--jini-mcpui-font': SURFACE_TOKENS['--jini-mcpui-font'],
  '--jini-mcpui-font-mono': SURFACE_TOKENS['--jini-mcpui-font-mono'],
};

/**
 * Tokens computed from the base set. Never overridable, by design — a caller that could override
 * `--jini-mcpui-danger-strong` independently could also desynchronize it from `--jini-mcpui-danger`,
 * which is the exact failure this indirection removes.
 */
const DERIVED_TOKENS: Readonly<Record<string, string>> = {
  '--jini-mcpui-accent-hover': 'color-mix(in srgb, var(--jini-mcpui-accent) 88%, var(--jini-mcpui-text))',
  '--jini-mcpui-accent-tint': 'color-mix(in srgb, var(--jini-mcpui-accent) 10%, transparent)',
  '--jini-mcpui-accent-ring': 'color-mix(in srgb, var(--jini-mcpui-accent) 35%, transparent)',
  '--jini-mcpui-danger-hover': 'color-mix(in srgb, var(--jini-mcpui-danger) 88%, var(--jini-mcpui-text))',
  '--jini-mcpui-danger-tint': 'color-mix(in srgb, var(--jini-mcpui-danger) 10%, transparent)',
  '--jini-mcpui-danger-ring': 'color-mix(in srgb, var(--jini-mcpui-danger) 35%, transparent)',
  '--jini-mcpui-surface-shadow': '0 1px 2px color-mix(in srgb, var(--jini-mcpui-text) 8%, transparent)',
};

/**
 * The dark-scheme override for `--jini-mcpui-surface-shadow`. Not folded into
 * {@link SURFACE_TOKENS_DARK}/{@link DERIVED_TOKENS}'s usual var()-cascades-automatically trick,
 * because that trick relies on the derived expression staying correct across schemes, and this one
 * does not: `color-mix(in srgb, var(--jini-mcpui-text) 8%, transparent)` reads as a near-invisible
 * dark tint in light mode but as a near-invisible *light* tint in dark mode, where `--jini-mcpui-text`
 * itself is light. A drop shadow should stay dark ink at low opacity in both schemes, so this is a
 * fixed value the dark media block below applies as a second, later declaration of the same property.
 */
const DARK_SURFACE_SHADOW = '0 1px 2px color-mix(in srgb, var(--jini-mcpui-bg) 32%, transparent)';

/**
 * Whether every generated surface is pinned to the light palette regardless of the embedding
 * browser/OS's `prefers-color-scheme`.
 *
 * True by default because without an explicit app-level theme signal, a
 * surface that honors the OS preference doesn't track any actual app theme — it tracks whatever the
 * operator's OS happens to be set to, which produces a dark card floating in an always-light admin
 * UI. Flip this to `false` once the host product has a real app-level theme signal to forward in;
 * nothing else about
 * {@link renderTokenBlock} needs to change.
 */
export const FORCE_LIGHT_SURFACE_THEME = true;

/**
 * Renders the `:root` declaration block for a surface document, plus — unless
 * {@link FORCE_LIGHT_SURFACE_THEME} is set — a `prefers-color-scheme: dark` variant of it.
 *
 * @param overrides - Base tokens to replace, applied in both schemes. Unknown names are a compile
 * error, not a silent no-op, because a mistyped token name would otherwise leave the real one at its
 * default and produce a surface that looks unstyled for no visible reason. Values are emitted
 * verbatim — a caller passing a token value is trusted the same way it is trusted with the surface's
 * own body HTML. A caller wanting scheme-specific values is not served by this parameter; it exists
 * for a host's brand tokens, which by design apply the same way regardless of scheme.
 * @returns A `:root { … }` block, followed by a `@media (prefers-color-scheme: dark) { :root { … } }`
 * block unless {@link FORCE_LIGHT_SURFACE_THEME} suppresses it, ready to paste into the first
 * `<style>` tag.
 * @complexity O(n) in the number of tokens.
 */
export function renderTokenBlock(overrides: Partial<Record<SurfaceTokenName, string>> = {}): string {
  const declare = (entries: readonly (readonly [string, string])[]): string =>
    entries.map(([name, value]) => `  ${name}: ${value};`).join('\n');

  const light = declare([
    ...Object.entries({ ...SURFACE_TOKENS, ...overrides }),
    ...Object.entries(DERIVED_TOKENS),
  ]);
  const lightBlock = `:root {\n${light}\n}`;
  if (FORCE_LIGHT_SURFACE_THEME) return lightBlock;

  const dark = declare([
    ...Object.entries({ ...SURFACE_TOKENS_DARK, ...overrides }),
    ['--jini-mcpui-surface-shadow', DARK_SURFACE_SHADOW],
  ]);

  return `${lightBlock}\n@media (prefers-color-scheme: dark) {\n  :root {\n${dark}\n  }\n}`;
}
