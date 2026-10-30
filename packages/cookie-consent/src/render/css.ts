/** @file Owner CSS for the Jini banner: appearance tokens + custom CSS, compiled for the preview, live pages
 * and the static export alike. Any selector under the banner scope is allowed; a bad rule is dropped and
 * reported on its own (the rest of the customization stays); the 4.5:1 contrast check and the engine
 * Reject-parity block always apply. No DOM, no I/O. */
// MOVED-FROM: @jini-ai/cms consent/css.ts (value rules, contrast check, parity block). Changed: the selector
// gate is "anything under the scope" instead of a fixed surface list, and problems drop one rule instead
// of the whole customization. Follow-up (P4): delete the cms copy once the consumer reads this package.
import { ConsentCssSyntaxError, parseConsentCss, type ConsentCssDeclaration, type ConsentCssRule } from './css-parser.js';

export const CONSENT_CSS_SCOPE = '#jini-consent';
export const CONSENT_MAX_CSS_LENGTH = 16_384;

/** Bounded appearance tokens; colors are opaque hex and must meet 4.5:1 contrast. */
export interface ConsentAppearanceTokens {
  backgroundColor?: string; textColor?: string; borderColor?: string; borderRadius?: string;
  padding?: string; fontSize?: string; maxWidth?: string; fontFamily?: string;
}
export interface ConsentCssProblem {
  code: 'size' | 'syntax' | 'selector' | 'property' | 'value' | 'contrast';
  message: string;
  /** Zero-based customCss offset; token diagnostics use 0, aggregate diagnostics omit it. */
  offset?: number;
  selector?: string;
  property?: string;
}
export interface ConsentCssResult {
  /** The accepted rules followed by the engine parity block. */
  css: string;
  problems: ConsentCssProblem[];
}

const TOKEN_PROPERTIES: Record<keyof ConsentAppearanceTokens, string> = {
  backgroundColor: 'background-color', textColor: 'color', borderColor: 'border-color', borderRadius: 'border-radius',
  padding: 'padding', fontSize: 'font-size', maxWidth: 'max-width', fontFamily: 'font-family',
};
const DEFAULT_COLORS = { background: '#ffffff', text: '#222222' };
type Colors = typeof DEFAULT_COLORS;
const COLOR_PROPS: ReadonlySet<string> = new Set(['background-color', 'color']);

/** Opaque hex only: functions, variables, alpha and currentColor cannot hide notice text. @complexity O(1). */
function isColor(value: string): boolean { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value); }

/** Absolute lengths keep bounds independent of the host's root font/viewport dimensions. @complexity O(value length). */
function pixels(value: string): number {
  if (value === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  return match ? Number(match[1]) : NaN;
}

function boundedLength(value: string, min: number, max: number): boolean {
  const size = pixels(value);
  return Number.isFinite(size) && size >= min && size <= max;
}

/** Bounded non-negative spacing cannot move required controls off screen. @complexity O(value length). */
function lengthList({ value, min = 0, max = 32, count = 4 }: { value: string; min?: number; max?: number; count?: number }): boolean {
  const parts = value.split(/\s+/);
  return parts.length <= count && parts.every(part => boundedLength(part, min, max));
}

/** Alpha is permitted only for shadows, never for text or control fills. @complexity O(value length). */
function shadowColor(value: string): boolean {
  if (isColor(value)) return true;
  const channel = String.raw`\s*(\d{1,3})\s*,`;
  const alpha = String.raw`\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+)\s*`;
  const match = new RegExp(String.raw`^rgba\(${channel}${channel}${channel}${alpha}\)$`).exec(value);
  return match !== null && match.slice(1, 4).every(channel => Number(channel) <= 255);
}

/** A bounded shadow cannot cover the page or disguise the banner with a huge spread. @complexity O(value length). */
function isShadow(value: string): boolean {
  if (value === 'none') return true;
  const colorStart = value.search(/#|rgba\(/i);
  const prefix = value.slice(0, colorStart);
  if (colorStart < 0 || !/\s$/.test(prefix)) return false;
  const lengths = prefix.trim().split(/\s+/);
  if (lengths.length < 3 || lengths.length > 4) return false;
  return lengths.every((part, index) => boundedLength(part, 0, [24, 24, 64, 8][index]!)) && shadowColor(value.slice(colorStart));
}

/** Font names and generic families only: no url(), no functions, bounded length. */
const isFontFamily = (value: string) => value.length <= 200 && /^[\w\s,"'-]+$/.test(value);

const VALUE_RULES: Record<string, (value: string) => boolean> = {
  'background-color': isColor, color: isColor, 'border-color': isColor,
  'border-radius': value => lengthList({ value }),
  'border-width': value => lengthList({ value, max: 4 }),
  'border-style': value => /^(?:solid|dashed|dotted|none)$/.test(value),
  padding: value => lengthList({ value }),
  margin: value => lengthList({ value }),
  'margin-top': value => boundedLength(value, 0, 32),
  'margin-left': value => boundedLength(value, 0, 32),
  gap: value => lengthList({ value, count: 2 }),
  'line-height': value => /^(?:1(?:\.\d+)?|2(?:\.0+)?)$/.test(value),
  'min-height': value => boundedLength(value, 24, 64),
  'font-size': value => boundedLength(value, 12, 24),
  'font-family': isFontFamily,
  'font-weight': value => /^(?:normal|bold|[1-9]00)$/.test(value),
  'letter-spacing': value => value === 'normal' || boundedLength(value, 0, 4),
  'text-align': value => /^(?:start|end|left|right|center)$/.test(value),
  'text-transform': value => /^(?:none|uppercase|lowercase|capitalize)$/.test(value),
  'max-width': value => value === '100%' || boundedLength(value, 256, 960),
  'box-shadow': isShadow,
};
const ROOT_ONLY: ReadonlySet<string> = new Set(['background-color', 'color', 'max-width', 'box-shadow']);

/** Decode an already validated opaque hex color to sRGB channels. @complexity O(1). */
function colorChannels(color: string): number[] {
  const hex = color.length === 4 ? color.slice(1).split('').map(char => char + char).join('') : color.slice(1);
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

/** WCAG relative luminance of normalized sRGB channels. @complexity O(1). */
function luminance(channels: number[]): number {
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

/** Fail closed on low-contrast banner and button fills, including declarations overriding tokens. @complexity O(1). */
function hasContrast({ background, text }: Colors): boolean {
  const bg = colorChannels(background); const fg = colorChannels(text);
  const b = luminance(fg);
  // Match the base CSS's sRGB mixes (button fill 7%, hover 13%) before linearizing for WCAG contrast.
  return [0, 0.07, 0.13].every(weight => {
    const a = luminance(bg.map((channel, index) => channel * (1 - weight) + fg[index]! * weight));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5;
  });
}

/** One compound: optional type, classes/ids, at most one interaction pseudo-class. No attribute selectors,
 * no structural pseudo-classes (:first-child, :not, :has...), no pseudo-elements, no sibling combinators:
 * those are the ways to style Accept differently from Reject, which the parity rule forbids. */
const COMPOUND = /^(?:[a-z][a-z0-9-]*|\*)?(?:[.#][a-z][\w-]*)*(?::(?:hover|focus|focus-visible|focus-within|active))?$/i;
const ROOTS = /^(?:#jini-consent|\.jini-consent|\.jini-consent-reopen)(?=$|[\s>:])/;

/** Normalized selector, or null when it leaves the banner scope or could break Reject parity. @complexity O(selector length). */
export function scopedSelector(selector: string): string | null {
  const normalized = selector.trim().split('>').map(part => part.trim()).join(' > ').replace(/\s+/g, ' ');
  if (!ROOTS.test(normalized)) return null;
  const compounds = normalized.split(' ').filter(part => part !== '>');
  return compounds.every(part => part && COMPOUND.test(part)) ? normalized.replace(/^\.jini-consent(?=$|[\s>:])/, CONSENT_CSS_SCOPE) : null;
}

/** One declaration policy shared by tokens and parsed CSS. @complexity O(value length). */
function declarationProblem({ declaration, selector, media }: { declaration: ConsentCssDeclaration; selector: string; media: string | undefined }): ConsentCssProblem | null {
  const { property, value, offset } = declaration;
  const at = { offset, selector, property };
  if (!Object.hasOwn(VALUE_RULES, property)) return { code: 'property', message: `The property "${property}" is not allowed.`, ...at };
  if (ROOT_ONLY.has(property) && selector !== CONSENT_CSS_SCOPE) return { code: 'property', message: `Set "${property}" on #jini-consent itself so every control inherits the same readable appearance.`, ...at };
  // Conditional palettes would need per-query contrast analysis; width queries customize geometry only.
  if (media && COLOR_PROPS.has(property)) return { code: 'property', message: 'Set text and background colors outside media queries so contrast is verified for every viewport.', ...at };
  if (property === 'padding' && selector === CONSENT_CSS_SCOPE && !lengthList({ value, min: 8 })) return { code: 'value', message: 'Banner padding must be between 8px and 32px on every side.', ...at };
  if (!VALUE_RULES[property]!(value)) return { code: 'value', message: `The value of "${property}" is outside the supported safe subset. Resources and !important are not allowed.`, ...at };
  return null;
}

/** All problems of one rule; any problem drops that rule only. @complexity O(rule size). */
function ruleProblems(rule: ConsentCssRule): ConsentCssProblem[] {
  const problems: ConsentCssProblem[] = [];
  for (const raw of rule.selector.split(',')) {
    const selector = scopedSelector(raw);
    if (!selector) { problems.push({ code: 'selector', message: `"${raw.trim()}" must start with #jini-consent and may not use attribute, structural or sibling selectors (Accept and Reject must look alike).`, offset: rule.offset, selector: raw.trim() }); continue; }
    for (const declaration of rule.declarations) {
      const problem = declarationProblem({ declaration, selector, media: rule.media });
      if (problem) problems.push(problem);
    }
  }
  return problems;
}

/** Convert host tokens to the same declaration AST instead of introducing another validator. @complexity O(tokens). */
function tokenRule(tokens: ConsentAppearanceTokens): ConsentCssRule {
  const declarations = Object.entries(tokens).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => ({
    property: Object.hasOwn(TOKEN_PROPERTIES, key) ? TOKEN_PROPERTIES[key as keyof ConsentAppearanceTokens] : key,
    value: typeof value === 'string' ? value : '', offset: 0,
  }));
  return { selector: CONSENT_CSS_SCOPE, declarations, offset: 0 };
}

const isRoot = (rule: ConsentCssRule) => rule.media === undefined && rule.selector.split(',').some(s => scopedSelector(s) === CONSENT_CSS_SCOPE);

/** Last root color declaration wins, matching the emitted cascade. Null = no customized color, so the theme
 * colors of the base styles stay in charge; one customized side is checked against the default other side.
 * @complexity O(declarations). */
function finalColors(rules: readonly ConsentCssRule[]): Colors | null {
  let colors: Colors | null = null;
  for (const { property, value } of rules.filter(isRoot).flatMap(rule => rule.declarations)) {
    if (property === 'background-color') colors = { ...(colors ?? DEFAULT_COLORS), background: value };
    if (property === 'color') colors = { ...(colors ?? DEFAULT_COLORS), text: value };
  }
  return colors;
}

/** Engine-owned lock after all customization: the banner stays visible and on top, Reject and Accept share
 * one fill and border, controls inherit the root's validated colors, and the region/GPC variants are
 * CSS-toggled from <html> attributes so the markup is the same for every visitor. Unknown region = strict:
 * the opt-in variant (with Reject) shows unless the client has positively set opt-out. @complexity O(1). */
export function parityCss({ colors }: { colors: Colors | null }): string {
  const root = CONSENT_CSS_SCOPE;
  // Derived text and button fills must use the same validated palette as the root.
  const rootColors = colors ? `--consent-bg:${colors.background}!important;--consent-fg:${colors.text}!important;background:${colors.background}!important;color:${colors.text}!important;` : '';
  return `\n/* ENGINE PARITY BLOCK */
${root}{position:fixed!important;z-index:2147483647!important;visibility:visible!important;opacity:1!important;transform:none!important;clip:auto!important;clip-path:none!important;filter:none!important;pointer-events:auto!important;isolation:isolate!important}
${root}:not([hidden]){display:block!important;${rootColors}background-image:none!important;min-width:0!important;max-height:85dvh!important;overflow:auto!important;box-sizing:border-box!important}
${root}[hidden]{display:none!important}
${root} :is(h2,p,label,legend,fieldset,details,.jini-consent-actions){background:transparent!important}
${root} :is(h2,p,label,legend,details,.jini-consent-actions){color:inherit!important}
${root} .jini-consent-actions{display:grid!important}
${root} :is(button,a,summary){visibility:visible!important;opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important;pointer-events:auto!important;color:inherit!important}
${root} :is(a,summary){background:transparent!important;border:0!important}
${root} .jini-consent-actions button{background:var(--consent-button-bg)!important;border:1px solid var(--consent-button-border)!important}
${root} .jini-consent-actions button:hover{background:var(--consent-button-hover-bg)!important}
${root} .jini-consent-link{background:transparent!important;border:0!important}
${root} button{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:0!important;max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important}
${root} a{display:inline!important;text-decoration:underline!important}
${root} :focus-visible{outline:3px solid currentColor!important;outline-offset:2px!important}
html[data-consent-region="opt-out"] ${root} [data-consent-only="opt-in"],html:not([data-consent-region="opt-out"]) ${root} [data-consent-only="opt-out"],html:not([data-consent-gpc]) ${root} [data-consent-gpc]{display:none!important}
@media(max-width:640px){${root}{inset:auto 0 0!important;width:100%!important;max-width:100%!important;margin:0!important}}
`;
}

/** Reject syntax that could change token boundaries or break out of the HTML style sink. @complexity O(n). */
function inputProblem(css: unknown): ConsentCssProblem | null {
  // Stored settings are JSON from the host; a wrong shape must not throw at render time.
  if (typeof css !== 'string') return { code: 'syntax', message: 'Custom CSS and appearance tokens must be text and an object of text values.' };
  if (css.length > CONSENT_MAX_CSS_LENGTH) return { code: 'size', message: `Custom CSS must be at most ${CONSENT_MAX_CSS_LENGTH} characters.` };
  // `>` stays parseable for child combinators; `<` alone can open `</style`.
  if (/[\\<\x00-\x08\x0b\x0e-\x1f\x7f]/.test(css)) return { code: 'syntax', message: 'CSS escapes, HTML delimiters and control characters are not allowed.' };
  return null;
}

/** Parsed owner rules, or the one whole-input problem that makes them unreadable. Tokens survive either way. */
function ownerRules(css: unknown): { rules: ConsentCssRule[]; problem?: ConsentCssProblem } {
  const problem = inputProblem(css);
  if (problem) return { rules: [], problem };
  try { return { rules: parseConsentCss({ css: css as string }) }; }
  catch (error) {
    if (!(error instanceof ConsentCssSyntaxError)) throw error;
    return { rules: [], problem: { code: 'syntax', message: error.message, offset: error.offset } };
  }
}

function tokenObject(tokens: unknown): { tokens: ConsentAppearanceTokens; problem?: ConsentCssProblem } {
  const ok = tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens) && JSON.stringify(tokens).length <= CONSENT_MAX_CSS_LENGTH;
  return ok ? { tokens: tokens as ConsentAppearanceTokens } : { tokens: {}, problem: { code: 'syntax', message: 'Appearance tokens must be an object of text values.' } };
}

/** Low contrast drops the root colors only, so the theme palette (and everything else) still applies. */
function withoutRootColors(rules: readonly ConsentCssRule[]): ConsentCssRule[] {
  return rules.map(rule => isRoot(rule) ? { ...rule, declarations: rule.declarations.filter(d => !COLOR_PROPS.has(d.property)) } : rule);
}

/** Emit only validated selectors/declarations, retaining their optional width condition. @complexity O(rule bytes). */
function emitRule(rule: ConsentCssRule): string {
  const selectors = rule.selector.split(',').map(s => scopedSelector(s)).join(',');
  const declarations = rule.declarations.map(({ property, value }) => `${property}:${value}`).join(';');
  const css = `${selectors}{${declarations}}`;
  return rule.media === undefined ? css : `@media ${rule.media}{${css}}`;
}

/** Validate/compile the banner appearance for both the admin preview and delivery. Tokens render first, then
 * owner CSS, then the engine parity block. Each bad rule is dropped and reported; the rest applies.
 * @example compileConsentCss({ css: '#jini-consent button{font-weight:700}', tokens: { backgroundColor: '#101820', textColor: '#ffffff' } })
 * @complexity O(n) time/space, with custom CSS and tokens each capped at 16 KiB. */
export function compileConsentCss({ css = '', tokens = {} }: { css?: string; tokens?: ConsentAppearanceTokens }, _optional = {}): ConsentCssResult {
  const owner = ownerRules(css);
  const token = tokenObject(tokens);
  const problems = [owner.problem, token.problem].filter((p): p is ConsentCssProblem => !!p);
  let kept: ConsentCssRule[] = [];
  for (const rule of [tokenRule(token.tokens), ...owner.rules]) {
    const found = ruleProblems(rule);
    problems.push(...found);
    if (!found.length && rule.declarations.length) kept.push(rule);
  }
  let colors = finalColors(kept);
  if (colors && !hasContrast(colors)) {
    problems.push({ code: 'contrast', message: 'Banner text must have at least 4.5:1 contrast against the background and button fills. Your colors were not applied.' });
    kept = withoutRootColors(kept).filter(rule => rule.declarations.length);
    colors = null;
  }
  const compiled = kept.map(emitRule).join('\n');
  return { css: `${compiled ? '\n' + compiled : ''}${parityCss({ colors })}`, problems };
}
