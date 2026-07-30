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
 * `@jini-ai/ui` has no package-wide custom-property design system to reuse (checked: its only two
 * stylesheets, `react/chat/styles/reference.css` and the Remix icon font, declare no custom
 * properties at all), so these are namespaced `--jini-mcpui-*` to stay out of the way of one if it
 * ever lands.
 */

/**
 * The base palette, radius scale, and font stack.
 *
 * Font stacks are system-only and always will be: a sandboxed iframe has no network, so an
 * `@import` or a `<link>` to a web font is a request that cannot be made, and the surface would
 * render in whatever the engine falls back to after a delay.
 */
export const SURFACE_TOKENS = {
  '--jini-mcpui-bg': '#faf9f7',
  '--jini-mcpui-panel': '#fdfcfa',
  '--jini-mcpui-border': '#e1e5eb',
  '--jini-mcpui-border-strong': '#c9d0da',
  '--jini-mcpui-text': '#1a1916',
  '--jini-mcpui-text-strong': '#0d0c0a',
  '--jini-mcpui-text-muted': '#74716b',
  '--jini-mcpui-text-soft': '#989590',
  '--jini-mcpui-text-faint': '#b3b0a8',
  '--jini-mcpui-accent': '#c96442',
  '--jini-mcpui-accent-strong': '#b45a3b',
  // Desaturated and earthy, in the same family as the accent rather than a saturated pure red — a
  // destructive action should read as serious, not as an alarm the eye learns to discount.
  '--jini-mcpui-danger': '#a8443a',
  '--jini-mcpui-radius-xs': '4px',
  '--jini-mcpui-radius-sm': '6px',
  '--jini-mcpui-radius-md': '8px',
  '--jini-mcpui-radius-lg': '10px',
  '--jini-mcpui-radius-xl': '12px',
  '--jini-mcpui-radius-pill': '999px',
  '--jini-mcpui-font':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  '--jini-mcpui-font-mono': "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/** The token names a caller may override. */
export type SurfaceTokenName = keyof typeof SURFACE_TOKENS;

/**
 * Tokens computed from the base set. Never overridable, by design — a caller that could override
 * `--jini-mcpui-danger-strong` independently could also desynchronize it from `--jini-mcpui-danger`,
 * which is the exact failure this indirection removes.
 */
const DERIVED_TOKENS: Readonly<Record<string, string>> = {
  '--jini-mcpui-accent-hover': 'color-mix(in srgb, var(--jini-mcpui-accent) 88%, #000)',
  '--jini-mcpui-accent-tint': 'color-mix(in srgb, var(--jini-mcpui-accent) 10%, transparent)',
  '--jini-mcpui-accent-ring': 'color-mix(in srgb, var(--jini-mcpui-accent) 35%, transparent)',
  '--jini-mcpui-danger-hover': 'color-mix(in srgb, var(--jini-mcpui-danger) 88%, #000)',
  '--jini-mcpui-danger-tint': 'color-mix(in srgb, var(--jini-mcpui-danger) 10%, transparent)',
  '--jini-mcpui-danger-ring': 'color-mix(in srgb, var(--jini-mcpui-danger) 35%, transparent)',
  '--jini-mcpui-surface-shadow': '0 1px 2px color-mix(in srgb, var(--jini-mcpui-text) 8%, transparent)',
};

/**
 * Renders the `:root` declaration block for a surface document.
 *
 * @param overrides - Base tokens to replace. Unknown names are a compile error, not a silent no-op,
 * because a mistyped token name would otherwise leave the real one at its default and produce a
 * surface that looks unstyled for no visible reason. Values are emitted verbatim — a caller passing
 * a token value is trusted the same way it is trusted with the surface's own body HTML.
 * @returns A `:root { … }` block, ready to paste into the first `<style>` tag.
 * @complexity O(n) in the number of tokens.
 */
export function renderTokenBlock(overrides: Partial<Record<SurfaceTokenName, string>> = {}): string {
  const declarations = [
    ...Object.entries({ ...SURFACE_TOKENS, ...overrides }),
    ...Object.entries(DERIVED_TOKENS),
  ]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `:root {\n${declarations}\n}`;
}
