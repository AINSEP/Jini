import type { ConsentAppearanceTokens } from './types.js';
import { ConsentCssSyntaxError, parseConsentCss, type ConsentCssDeclaration, type ConsentCssRule } from './css-parser.js';

export const CONSENT_CSS_SCOPE = '#jini-consent[data-has-record="false"]';
export const CONSENT_MAX_CSS_LENGTH = 16_384;
/** Exact surfaces only: controls can be styled together, never by action or DOM order. */
export const CONSENT_CSS_SELECTORS = Object.freeze([
  CONSENT_CSS_SCOPE, `${CONSENT_CSS_SCOPE} h2`, `${CONSENT_CSS_SCOPE} p`,
  `${CONSENT_CSS_SCOPE} button`, `${CONSENT_CSS_SCOPE} a`,
  `${CONSENT_CSS_SCOPE} .jini-consent-initial`, `${CONSENT_CSS_SCOPE} .jini-consent-actions`,
]);

export interface ConsentCssProblem {
  code: 'size' | 'syntax' | 'selector' | 'property' | 'value' | 'contrast';
  message: string;
  /** Zero-based customCss offset; token diagnostics use 0, aggregate diagnostics omit it. */
  offset?: number;
  selector?: string;
  property?: string;
}
export interface ConsentCssResult {
  /** Validated customization followed by the engine parity block; safe defaults on any problem. */
  css: string;
  problems: ConsentCssProblem[];
}

const TOKEN_PROPERTIES: Record<keyof ConsentAppearanceTokens, string> = {
  backgroundColor: 'background-color', textColor: 'color', borderColor: 'border-color',
  borderRadius: 'border-radius', padding: 'padding', fontSize: 'font-size', maxWidth: 'max-width',
};
const DEFAULT_COLORS = { background: '#ffffff', text: '#222222' };
type Colors = typeof DEFAULT_COLORS;

/** Opaque hex only: functions, variables, alpha and currentColor cannot hide notice text.
 * @complexity O(1); accepted color length is fixed. */
function isColor(value: string): boolean { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value); }

/** Absolute lengths keep bounds independent of the host's root font/viewport dimensions.
 * @complexity O(value length). */
function pixels(value: string): number {
  if (value === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  return match ? Number(match[1]) : NaN;
}

/** @complexity O(value length); no negative, percentage, viewport or calculated dimensions. */
function boundedLength(value: string, min: number, max: number): boolean {
  const size = pixels(value);
  return Number.isFinite(size) && size >= min && size <= max;
}

/** A small shadow cannot cover the page or disguise the banner with a huge spread.
 * @complexity O(value length). */
function isShadow(value: string): boolean {
  if (value === 'none') return true;
  const parts = value.split(/\s+/);
  return parts.length === 4 && parts.slice(0, 3).every(part => boundedLength(part, 0, 24)) && isColor(parts[3]!);
}

const VALUE_RULES: Record<string, (value: string) => boolean> = {
  'background-color': isColor, color: isColor, 'border-color': isColor,
  'border-radius': value => boundedLength(value, 0, 32),
  padding: value => boundedLength(value, 8, 32),
  'font-size': value => boundedLength(value, 16, 24),
  'max-width': value => boundedLength(value, 256, 960),
  'box-shadow': isShadow,
};
const ROOT_ONLY = new Set(['background-color', 'color', 'padding', 'font-size', 'max-width']);

/** Relative luminance of an already validated opaque sRGB color. @complexity O(1). */
function luminance(color: string): number {
  const hex = color.length === 4 ? color.slice(1).split('').map(char => char + char).join('') : color.slice(1);
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

/** Fail closed on low-contrast final colors, including repeated declarations overriding tokens.
 * @complexity O(1). */
function hasContrast({ background, text }: Colors): boolean {
  const a = luminance(background); const b = luminance(text);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5;
}

/** Normalize only the two public root spellings and whitespace; no general selector rewriting.
 * @complexity O(selector length). */
function scopedSelector(selector: string): string {
  const normalized = selector.trim().replace(/\s+/g, ' ');
  if (normalized === CONSENT_CSS_SCOPE || normalized.startsWith(`${CONSENT_CSS_SCOPE} `)) return normalized;
  return normalized.replace(/^(?:#jini-consent|\.jini-consent)(?= |$)/, CONSENT_CSS_SCOPE);
}

/** One declaration policy shared by tokens and parsed CSS; functions/escapes never reach output.
 * @complexity O(value length). */
function declarationProblem({ declaration, selector }: { declaration: ConsentCssDeclaration; selector: string }): ConsentCssProblem | null {
  const { property, value, offset } = declaration;
  const validate = Object.hasOwn(VALUE_RULES, property) ? VALUE_RULES[property] : undefined;
  if (!validate) return { code: 'property', message: `The property "${property}" is not allowed.`, offset, selector, property };
  if (ROOT_ONLY.has(property) && selector !== CONSENT_CSS_SCOPE) return { code: 'property', message: `Set "${property}" on the banner root so all controls inherit the same readable appearance.`, offset, selector, property };
  if (!validate(value)) return { code: 'value', message: `The value of "${property}" is outside the supported safe subset. Functions, resources and !important are not allowed.`, offset, selector, property };
  return null;
}

/** Validate all rules before emitting any user CSS; one bad member rejects the entire batch.
 * @complexity O(n) time/space for bounded CSS bytes; selector list and property table are fixed. */
function validateRules({ rules }: { rules: ConsentCssRule[] }): ConsentCssProblem[] {
  return rules.flatMap(rule => [...new Set(rule.selector.split(',').map(scopedSelector))]
    .flatMap(selector => surfaceProblems({ rule, selector })));
}

/** Deduplicated valid selectors have a fixed maximum of seven, bounding declaration checks.
 * @complexity O(declarations) for a known surface, O(1) otherwise. */
function surfaceProblems({ rule, selector }: { rule: ConsentCssRule; selector: string }): ConsentCssProblem[] {
  if (!CONSENT_CSS_SELECTORS.includes(selector)) return [{ code: 'selector', message: 'Use an allowlisted banner surface selector; action-specific selectors and pseudo-elements are not allowed.', offset: rule.offset, selector }];
  return rule.declarations.map(declaration => declarationProblem({ declaration, selector })).filter((problem): problem is ConsentCssProblem => problem !== null);
}

/** Convert host tokens to the same declaration AST instead of introducing another validator.
 * @complexity O(token count), bounded by the CSS size check in the compiler. */
function tokenRule(tokens: ConsentAppearanceTokens): ConsentCssRule {
  const declarations = Object.entries(tokens).map(([key, value]) => ({
    property: Object.hasOwn(TOKEN_PROPERTIES, key) ? TOKEN_PROPERTIES[key as keyof ConsentAppearanceTokens] : key,
    value: Object.hasOwn(TOKEN_PROPERTIES, key) && typeof value === 'string' ? value : '', offset: 0,
  }));
  return { selector: CONSENT_CSS_SCOPE, declarations, offset: 0 };
}

/** Last root color declaration wins across tokens and user rules, matching emitted cascade.
 * Null means no color was customized, so the theme-token colors of the base styles stay in charge;
 * one customized side is checked against the engine default of the other.
 * @complexity O(n) for declarations; never mutates caller input. */
function finalColors(rules: ConsentCssRule[]): Colors | null {
  let colors: Colors | null = null;
  const declarations = rules.filter(rule => rule.selector.split(',').some(selector => scopedSelector(selector) === CONSENT_CSS_SCOPE)).flatMap(rule => rule.declarations);
  for (const { property, value } of declarations) {
    if (property === 'background-color') colors = { ...(colors ?? DEFAULT_COLORS), background: value };
    if (property === 'color') colors = { ...(colors ?? DEFAULT_COLORS), text: value };
  }
  return colors;
}

/** Engine-owned lock follows all customization. Native details/hidden semantics remain intact;
 * initial placement rules never reposition the saved-choice disclosure/pill. Controls inherit the
 * root's colors, so an uncustomized banner keeps its theme-token colors and typography.
 * @complexity O(1). */
function parityCss(colors: Colors | null): string {
  const root = CONSENT_CSS_SCOPE;
  const rootColors = colors ? `background:${colors.background}!important;color:${colors.text}!important;` : '';
  return `\n/* ENGINE PARITY BLOCK */
#jini-consent{position:fixed!important;z-index:2147483000!important;visibility:visible!important;opacity:1!important;transform:none!important;clip:auto!important;clip-path:none!important;filter:none!important;pointer-events:auto!important;isolation:isolate!important}
${root}{display:block!important;${rootColors}background-image:none!important;min-width:0!important;min-height:0!important;max-height:85dvh!important;overflow:auto!important;box-sizing:border-box!important;line-height:1.5!important}
${root} :is(h2,p,label,legend,fieldset,details,form,.jini-consent-initial,.jini-consent-actions){color:inherit!important;background:transparent!important}
${root} .jini-consent-actions{display:flex!important;flex-wrap:wrap!important;gap:.5rem!important}
${root} :is(button,a,summary){visibility:visible!important;opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important;pointer-events:auto!important;min-height:44px!important;font-size:inherit!important;color:inherit!important;background:transparent!important;border:1px solid currentColor!important;line-height:1.5!important}
${root} button{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:1 1 0!important;min-width:0!important;max-width:100%!important;padding:.55rem .85rem!important;white-space:normal!important;overflow-wrap:anywhere!important}
${root} a{display:inline-flex!important;align-items:center!important;max-width:100%!important;overflow-wrap:anywhere!important;text-decoration:underline!important}
#jini-consent :focus-visible{outline:3px solid currentColor!important;outline-offset:3px!important}
@media(max-width:640px){${root}{inset:auto 0 0!important;width:100%!important;max-width:100%!important;margin:0!important;border-radius:0!important}}
`;
}

/** Reject syntax that could change token boundaries or break out of the HTML style sink.
 * CSS resource functions, at-rules and unsupported selectors are rejected by AST policy too.
 * @complexity O(n). */
function inputProblem(css: unknown): ConsentCssProblem | null {
  // Stored settings are JSON from the host; a wrong shape must not turn every page inert.
  if (typeof css !== 'string') return { code: 'syntax', message: 'Custom CSS and appearance tokens must be text and an object of text values.' };
  if (css.length > CONSENT_MAX_CSS_LENGTH) return { code: 'size', message: `Custom CSS must be at most ${CONSENT_MAX_CSS_LENGTH} characters.` };
  // `>` stays parseable so a child combinator gets a selector diagnostic; `<` alone can open `</style`.
  if (/[\\<\x00-\x08\x0b\x0e-\x1f\x7f]/.test(css)) return { code: 'syntax', message: 'CSS escapes, HTML delimiters and control characters are not allowed.' };
  return null;
}

/** Tokens are bounded by their serialized size; a non-object shape is reported, never thrown.
 * @complexity O(token bytes). */
function tokenText(tokens: unknown): string | null {
  return tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens) ? JSON.stringify(tokens) : null;
}

/** Emit the validated AST, or discard the complete appearance on a policy/contrast problem.
 * @complexity O(n) time/space; all emitted values have passed the shared declaration policy. */
function compileRules(rules: ConsentCssRule[]): ConsentCssResult {
  const problems = validateRules({ rules });
  const colors = problems.length ? null : finalColors(rules);
  if (colors && !hasContrast(colors)) problems.push({ code: 'contrast', message: 'Banner text and background must have at least 4.5:1 contrast.' });
  if (problems.length) return { css: parityCss(null), problems };
  const compiled = rules.filter(rule => rule.declarations.length).map(rule => `${rule.selector.split(',').map(scopedSelector).join(',')}{${rule.declarations.map(({ property, value }) => `${property}:${value}`).join(';')}}`).join('\n');
  return { css: `${compiled ? '\n' + compiled : ''}${parityCss(colors)}`, problems: [] };
}

/** Validate/compile first-visit appearance for both admin preview and delivery. No DOM or I/O.
 * Presets render first, then tokens, then parsed allowlisted CSS, then engine visibility/parity.
 * Any problem discards the complete customization and returns safe engine defaults plus diagnostics.
 * @complexity O(n) time/space, with custom CSS and tokens each capped at 16 KiB. */
export function compileConsentCss({ css = '', tokens = {} }: { css?: string; tokens?: ConsentAppearanceTokens }, _options = {}): ConsentCssResult {
  const problem = inputProblem(css) ?? inputProblem(tokenText(tokens));
  if (problem) return { css: parityCss(null), problems: [problem] };
  let rules: ConsentCssRule[];
  try { rules = [tokenRule(tokens), ...parseConsentCss({ css })]; }
  catch (error) {
    if (!(error instanceof ConsentCssSyntaxError)) throw error;
    return { css: parityCss(null), problems: [{ code: 'syntax', message: error.message, offset: error.offset }] };
  }
  return compileRules(rules);
}
