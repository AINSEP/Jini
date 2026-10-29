import type { SurfaceTokenName } from './tokens.js';

/**
 * @module features/mcp-ui/surfaces/host-theme
 *
 * Makes a surface follow the embedding host's LIVE theme. A surface is a sandboxed document that
 * cannot inherit the host's CSS (see `tokens.ts`), so without this every card wore Jini's neutral
 * default palette — a near-black accent on grey — whatever the host's brand (owner, 2026-10-13:
 * "every chat card should follow the theme color. It shouldn't be that ugly gray").
 *
 * The host side reads Jini's standard theme variables (`variables.css`'s `--jini-*`, which a host
 * brands through `--jini-theme-*` inputs) where the card is mounted, and {@link applyHostSurfaceTokens}
 * writes them into the document as a second `:root` rule right after the surface's token block. It
 * rewrites the document at render time rather than asking the View to apply a value it was sent,
 * so a card saved in an old chat — whose stored HTML predates this module — follows the theme too.
 */

/**
 * Which host variable each surface token follows. Radius and fonts are absent on purpose: a sandboxed
 * frame has no network, so a host's web font cannot load there, and the surface's radius scale is
 * its own. Text on an accent fill follows the host's primary ink, so a card's primary button
 * reads exactly as legibly as the host's own.
 */
const HOST_THEME_SOURCES: Readonly<Partial<Record<SurfaceTokenName, string>>> = {
  '--jini-mcpui-bg': '--jini-bg',
  '--jini-mcpui-panel': '--jini-surface',
  '--jini-mcpui-border': '--jini-border',
  '--jini-mcpui-border-strong': '--jini-border',
  '--jini-mcpui-text': '--jini-text',
  '--jini-mcpui-text-strong': '--jini-text',
  '--jini-mcpui-text-muted': '--jini-muted',
  '--jini-mcpui-text-soft': '--jini-muted',
  '--jini-mcpui-text-faint': '--jini-muted',
  '--jini-mcpui-accent': '--jini-primary',
  '--jini-mcpui-accent-strong': '--jini-primary',
  '--jini-mcpui-accent-ink': '--jini-primary-ink',
  '--jini-mcpui-danger': '--jini-danger',
};

/** The one slice of `CSSStyleDeclaration` this module reads — a test passes a plain object. */
export interface HostThemeStyle {
  getPropertyValue(name: string): string;
}

export type HostSurfaceTokens = Readonly<Partial<Record<SurfaceTokenName, string>>>;

/**
 * A value that could close the `<style>` it is written into, or end its declaration early, is
 * dropped rather than escaped. Custom-property values accept almost any token, and the accent is an
 * operator-typed setting, so `</style><script>` is a value the CSS parser would keep.
 */
const UNSAFE_VALUE = /[<>{};\\]/;

/**
 * Reads the host's resolved theme at one element.
 *
 * @param style - The element's computed style (`getComputedStyle(el)`), where `--jini-*` resolve
 * through every `var()` the host's theme inputs pass through.
 * @returns The surface tokens to override. A variable the host leaves undeclared (or declares with
 * an unsafe value) is omitted, so the surface keeps its own default for it.
 */
export function readHostSurfaceTokens(style: HostThemeStyle): HostSurfaceTokens {
  const tokens: Partial<Record<SurfaceTokenName, string>> = {};
  for (const [token, source] of Object.entries(HOST_THEME_SOURCES) as [SurfaceTokenName, string][]) {
    const value = style.getPropertyValue(source).trim();
    if (value !== '' && !UNSAFE_VALUE.test(value)) tokens[token] = value;
  }
  return tokens;
}

/** Marks the rule {@link applyHostSurfaceTokens} writes. */
const HOST_THEME_STYLE_ATTRIBUTE = 'data-jini-host-theme';

/**
 * Writes host tokens into a surface document.
 *
 * The rule is plain `:root` placed after the document's first `<style>`, so it beats the token
 * block's defaults by source order; a builder's own `tokens` override is emitted as `:root:root`
 * (`renderTokenBlock`), so a card that set its own colors keeps them. Documents carrying no
 * `--jini-mcpui-` token at all are returned unchanged: a third-party View declares none of these
 * names, and its HTML is not this module's to edit.
 *
 * @param html - The surface document.
 * @param tokens - From {@link readHostSurfaceTokens}.
 * @returns The document with the host rule inserted, or `html` itself when there is nothing to do.
 */
export function applyHostSurfaceTokens(html: string, tokens: HostSurfaceTokens): string {
  const entries = Object.entries(tokens);
  if (entries.length === 0 || !html.includes('--jini-mcpui-')) return html;
  const close = html.indexOf('</style>');
  if (close === -1) return html;
  const at = close + '</style>'.length;
  const declarations = entries.map(([name, value]) => `  ${name}: ${value};`).join('\n');
  const rule = `\n<style ${HOST_THEME_STYLE_ATTRIBUTE}>\n:root {\n${declarations}\n}\n</style>`;
  return `${html.slice(0, at)}${rule}${html.slice(at)}`;
}
