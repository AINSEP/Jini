const FORM_SUCCESS_CLASS = "jini-form-success";
const FORM_SLUG_ATTR = "data-form-slug";

/** The host-owned names the baseline CSS and range-readout script select on. The engine ships no
 *  product-branded class, attribute or custom-property name, so a host passes the ones its themes
 *  already style (every value is interpolated verbatim, so the generated CSS/JS carries exactly
 *  what the host supplies). */
export interface FormPresentationNames {
  /** Class a `<form>` element carries so the baseline styles it. */
  readonly formClass: string;
  /** Class of the per-form error slot. */
  readonly errorClass: string;
  /** Attribute HTML-mode forms carry (Builder forms never do), e.g. `data-…-form`. */
  readonly formAttr: string;
  /** Attribute marking an error slot in HTML-mode markup. */
  readonly errorAttr: string;
  /** Class of the `<output>` the range readout script appends after a range input. */
  readonly rangeValueClass: string;
  /** Idempotency attribute the range readout script stamps on each slider it wires. */
  readonly rangeMarkerAttr: string;
  /** Private custom property holding the mode-aware `--danger` fallback colour. */
  readonly dangerFallbackProp: string;
  /** Private custom property holding the mode-aware `--success` fallback colour. */
  readonly successFallbackProp: string;
}

/** Generic class name a success slot carries and the attribute every form slot carries — exported
 *  rather than as literal strings so a second form-rendering widget's own markup cannot drift from
 *  what the CSS actually selects. */
export { FORM_SUCCESS_CLASS, FORM_SLUG_ATTR };

type NamesArgs = { names: FormPresentationNames };
type NoOptions = Record<string, never>;

/** Private fallback-only custom properties for hazard 3 of {@link formBaselineStyle} — never referenced by a theme, only by
 *  the var(--danger, var(<dangerFallbackProp>)) chains below. Mirrors tokensToRootCss's own
 *  dark-default / :root[data-theme="light"]-override shape so these track the page's real color mode. */
function rootRules({ names }: NamesArgs, _optional: NoOptions = {}): string {
  return (
    `:root{${names.dangerFallbackProp}:#f87171;${names.successFallbackProp}:#4ade80;}` +
    `:root[data-theme="light"]{${names.dangerFallbackProp}:#b91c1c;${names.successFallbackProp}:#166534;}`
  );
}

/** Builder-mode rules: the form shell, every `.widget-form-field` control and the submit button. */
function builderRules({ names }: NamesArgs, _optional: NoOptions = {}): string {
  const form = names.formClass;
  return (
    `:where(.${form}[hidden],[${FORM_SLUG_ATTR}][hidden]){display:none!important;}` +
    `:where(.${form}:not([hidden])){display:flex;flex-direction:column;gap:14px;max-width:480px;}` +
    ":where(.widget-form-field:not([hidden])){display:flex;flex-direction:column;gap:6px;}" +
    ":where(.widget-form-field label){font-weight:600;font-size:0.9rem;}" +
    // Boxed text-like controls only: a checkbox/radio/switch, a range slider or a file picker drawn as
    // a padded text box looks broken (their own rules follow).
    ":where(.widget-form-field input:not([type=checkbox],[type=radio],[type=range],[type=file])),:where(.widget-form-field textarea),:where(.widget-form-field select){font:inherit;padding:8px 10px;" +
    "border:1px solid var(--border,#d1d5db);border-radius:6px;background:var(--bg,#fff);color:inherit;}" +
    ":where(.widget-form-field textarea){min-height:100px;resize:vertical;}" +
    ":where(.widget-form-field select[multiple]){min-height:7em;}" +
    // Radio/checkbox groups render as `<fieldset><legend>` (registry `control: "group"`): drop the UA
    // box, set the legend like a field label, and put each option's box before its text on one line.
    ":where(fieldset.widget-form-field:not([hidden])){margin:0;padding:0;border:0;min-width:0;}" +
    ":where(fieldset.widget-form-field legend){padding:0 0 4px;font-weight:600;font-size:0.9rem;}" +
    ":where(fieldset.widget-form-field label:not([hidden])){display:flex;align-items:center;gap:8px;font-weight:400;}" +
    ":where(fieldset.widget-form-field input){margin:0;}" +
    ":where(.widget-form-field :is(input[type=checkbox],input[type=radio],input[type=range])){accent-color:var(--accent,#2563eb);}" +
    switchRules() +
    ":where(.widget-form-field input[type=range]){width:100%;margin:0;}" +
    // Filled in by the range readout script; absent (and harmless) without JS.
    `:where(.${names.rangeValueClass}){font-size:0.85rem;color:var(--muted,#6b7280);font-variant-numeric:tabular-nums;}` +
    ":where(.widget-form-field input[type=file]){font:inherit;font-size:0.9rem;color:var(--muted,#6b7280);}" +
    ":where(.widget-form-field input[type=file])::file-selector-button{font:inherit;font-weight:600;margin-right:10px;padding:6px 12px;" +
    "border:1px solid var(--border-strong,#9ca3af);border-radius:6px;background:var(--surface,#fff);color:var(--fg,#111827);cursor:pointer;}" +
    ":where(.widget-form-field-help){color:var(--muted,#6b7280);font-size:0.85rem;}" +
    // Builder checkbox: box first, on the label's line, glyph-sized (must follow the input rule above,
    // equal zero specificity); a revealed field error wraps onto its own line below.
    ":where(.widget-form-field-checkbox){flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;}" +
    ":where(.widget-form-field-checkbox input){order:-1;margin:0;padding:0;}" +
    ":where(.widget-form-field-checkbox label){font-weight:400;}" +
    ":where(.widget-form-field-checkbox .widget-form-field-error){flex-basis:100%;}" +
    `:where(.widget-form-field-error){color:var(--danger,var(${names.dangerFallbackProp}));font-size:0.85rem;font-weight:700;}` +
    // Submit = the site's primary-button colours (`--fg` fill, `--bg` text, the convention a host
    // theme's solid button uses), not `--accent`: an accent-filled Send clashed with every site CTA
    // beside it (owner, 2026-10-05). Fields sit on `--bg`, not `--surface`, so they stay distinct from a card.
    `:where(.${form} button[type=submit]){align-self:flex-start;padding:8px 16px;` +
    "border:1px solid transparent;border-radius:6px;background:var(--fg,#111827);" +
    "color:var(--bg,#fff);font-weight:600;cursor:pointer;}"
  );
}

/** Toggle rules: a checkbox with role=switch. */
function switchRules(_optional: NoOptions = {}): string {
  return (
    // Toggle = a checkbox with role=switch: a pill track (`--border-strong`, `--accent` when on) whose
    // knob is a background gradient rather than `::before`, which Firefox does not draw on inputs.
    ":where(.widget-form-field input[role=switch]){-webkit-appearance:none;appearance:none;flex-shrink:0;width:2.25rem;height:1.25rem;" +
    "border:0;border-radius:999px;cursor:pointer;background-color:var(--border-strong,#9ca3af);" +
    "background-image:radial-gradient(circle closest-side,var(--bg,#fff) 90%,transparent 100%);" +
    "background-size:1rem 1rem;background-repeat:no-repeat;background-position:2px center;transition:background-position .15s,background-color .15s;}" +
    ":where(.widget-form-field input[role=switch]:checked){background-color:var(--accent,#2563eb);" +
    "background-image:radial-gradient(circle closest-side,var(--accent-fg,#fff) 90%,transparent 100%);background-position:calc(100% - 2px) center;}" +
    ":where(.widget-form-field input[role=switch]:focus-visible){outline:2px solid var(--accent,#2563eb);outline-offset:2px;}" +
    "@media (prefers-reduced-motion:reduce){:where(.widget-form-field input[role=switch]){transition:none;}}"
  );
}

/** HTML-mode control rules (`html-render.ts`, keyed by the host's `formAttr`, which Builder forms never carry). */
function htmlModeRules({ names }: NamesArgs, _optional: NoOptions = {}): string {
  const attr = names.formAttr;
  return (
    // HTML-mode forms (`html-render.ts`, keyed by `formAttr`, which Builder forms never carry):
    // author markup wraps controls in `<label>`s and has no `.widget-form-field`, so the same look is
    // restated over plain descendants. Builder output is untouched by these rules.
    `:where([${attr}] label:not([hidden])){display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:0.9rem;}` +
    `:where([${attr}] label:has(> input[type=checkbox],> input[type=radio])){flex-direction:row;align-items:center;gap:8px;font-weight:400;}` +
    `:where([${attr}] :is(input:not([type=checkbox],[type=radio],[type=hidden],[type=submit],[type=button],[type=reset],[type=range],[type=file]),textarea,select))` +
    "{font:inherit;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;background:var(--bg,#fff);color:inherit;}" +
    `:where([${attr}] textarea){min-height:100px;resize:vertical;}` +
    `:where([${attr}] :is(input[type=checkbox],input[type=radio],input[type=range])){accent-color:var(--accent,#2563eb);}` +
    `:where([${attr}] input[type=range]){width:100%;margin:0;}`
  );
}

/** Single-line select chevron, Builder and HTML mode. */
function selectRules({ names }: NamesArgs, _optional: NoOptions = {}): string {
  const form = names.formClass;
  return (
    // Single-line select, Builder and HTML mode (2026-10-25, owner: the native caret sat jammed against
    // the right border next to the rounded inputs). Own chevron, two currentColor gradient strokes so it
    // follows the theme's text colour in light and dark with no per-theme SVG, plus end padding so the
    // text never runs under it. The ONE deliberate exception to the zero-specificity rule above: these
    // are `select:where(...)`, (0,0,1), and this `<style>` comes after the theme's `<link>`, so they beat
    // a theme field rule of the same weight (a host theme's `background:` shorthand would otherwise reset
    // the chevron and leave `appearance:none` with no caret at all) while a theme's class-level select
    // rule still wins. Only longhands, so the theme keeps its colour, border, radius and focus ring.
    // Mirrored for RTL; forced-colors gets the native control back, which the OS draws legibly.
    `select:where(.${form} select:not([multiple],[size])){-webkit-appearance:none;appearance:none;padding-inline-end:40px;cursor:pointer;` +
    "background-image:linear-gradient(45deg,transparent calc(50% - .75px),currentColor calc(50% - .75px),currentColor calc(50% + .75px),transparent calc(50% + .75px))," +
    "linear-gradient(135deg,transparent calc(50% - .75px),currentColor calc(50% - .75px),currentColor calc(50% + .75px),transparent calc(50% + .75px));" +
    "background-size:6px 6px;background-repeat:no-repeat;background-position:calc(100% - 21px) 50%,calc(100% - 15px) 50%;}" +
    `select:where(.${form} select:not([multiple],[size]):dir(rtl)){background-position:15px 50%,21px 50%;}` +
    `select:where(.${form} select:disabled){cursor:not-allowed;opacity:.6;}` +
    `@media (forced-colors:active){select:where(.${form} select:not([multiple],[size])){-webkit-appearance:auto;appearance:auto;background-image:none;}}`
  );
}

/** HTML-mode submit button plus the success and error slot rules. */
function feedbackRules({ names }: NamesArgs, _optional: NoOptions = {}): string {
  return (
    `:where([${names.formAttr}] button:not([type=button],[type=reset])){align-self:flex-start;padding:8px 16px;` +
    "border:1px solid transparent;border-radius:6px;background:var(--fg,#111827);" +
    "color:var(--bg,#fff);font-weight:600;cursor:pointer;}" +
    `:where(.${FORM_SUCCESS_CLASS},[data-jini-form-success]){padding:12px 14px;border-radius:6px;` +
    "background:var(--surface,#fff);border:1px solid var(--border,#d1d5db);" +
    `border-left:4px solid var(--success,var(${names.successFallbackProp}));color:var(--success,var(${names.successFallbackProp}));}` +
    `:where(.${names.errorClass},[${names.errorAttr}]){padding:10px 12px;border-radius:6px;` +
    "background:var(--surface-2,#f3f4f6);border:1px solid var(--border-strong,#9ca3af);" +
    `border-left:4px solid var(--danger,var(${names.dangerFallbackProp}));color:var(--danger,var(${names.dangerFallbackProp}));font-size:0.9rem;font-weight:600;}`
  );
}

/**
 * Baseline CSS every form-rendering widget carries with it wherever it renders (lifted from
 * `contact-form`'s own 2026-08-31 fix — see the git history on this file's predecessor block in
 * `render.ts` for the original bug reports). No theme in `content/themes/` has ever styled these
 * hooks (verified by grep across every theme's `css/` directory), so the widget ships usable
 * out of the box rather than requiring theme-author work.
 *
 * HTML-mode forms carry it too (2026-10-05, owner: HTML mode is the theme's form look plus author
 * refinements, not "no styling"); their rules key on the host's `formAttr`, see the inline note below.
 * A theme that styles the form class itself (a host theme's own "forms" section) wins over all of
 * this, so this block is the fallback for themes with no form rules, not the source of truth.
 *
 * Every selector is wrapped in `:where(...)`, which contributes ZERO specificity, so a theme's own
 * (non-`:where`) rule targeting the SAME class always wins regardless of cascade order — this is
 * also why the CSS below only ever needs the GENERIC class names: a widget that also renders a
 * legacy class (via {@link FormSlotOptions}'s `extraClasses`) gets the exact same styling for free,
 * since CSS class selectors match an element carrying EITHER class in its `class` attribute, not
 * just one exclusively.
 *
 * Three hazards already fixed once and preserved here (do not regress any of them):
 * 1. **`display` vs `[hidden]`.** A same-specificity author rule that sets `display` on an element
 *    beats the user-agent `[hidden]{display:none}` stylesheet — `:where()` zeroes *specificity*, not
 *    rule origin. Every rule below that sets `display` on a class an instance can carry `hidden` on
 *    is scoped with `:not([hidden])`. The success/error slot classes need no such guard
 *    because neither ever sets `display`; any NEW rule added here that touches `display` on either
 *    must carry the same guard. A THEME's own rule is the other half (2026-10-19, BYHO's
 *    `.oh-form form{display:grid}` kept a sent form on screen after the forms receiver's script hid it):
 *    the `[hidden]{display:none!important}` rule below forces it on any hidden form, success slot
 *    or error slot — every one carries `data-form-slug`, in both Builder and HTML mode — and
 *    `!important` is what lets a zero-specificity rule beat a theme's non-important one.
 * 2. **Undefined tokens.** Every `var(--...)` below must name a token that exists in EVERY theme's
 *    `tokens.json`/`tokens.light.json` — themes are copied, not inherited, so a token added to one
 *    theme is still missing from the other seven. The set actually shared by every theme: `--bg
 *    --surface --surface-2 --fg --muted --border --border-strong --accent --accent-fg --font-display
 *    --font-body --container`. Do not reference anything outside that set — with the ONE deliberate
 *    exception in hazard 3 below, where the fallback chain itself guarantees a real value.
 * 3. **No theme defines `--danger`/`--success` (2026-08-31, "error states have no color" fix).**
 *    Validation errors and the success message rendered with no semantic color at all. Fixed with the
 *    standard CSS custom-property fallback form, `var(--danger, <fallback>)`: a theme that ever
 *    defines `--danger`/`--success` in its own `tokens.json` wins automatically — `var()`'s fallback
 *    only applies when the property is unset ANYWHERE in the inherited chain, which is a cascade rule,
 *    not a source-order one, so it doesn't matter that this `<style>` block is emitted deep in the
 *    page body while a theme's token `:root{}` block sits in `<head>` (`static-render.ts`'s
 *    `tokensToRootCss`). The fallback itself can't be one hardcoded hex either: a single color cannot
 *    hit WCAG AA 4.5:1 against both this repo's near-black dark-mode surfaces (`--bg`/`--surface`/
 *    `--surface-2` all sit at oklch L 9–15%) and its near-white light-mode ones (L ~90–96%) —
 *    verified by converting the actual OKLCH/hex token values to WCAG relative luminance; the
 *    luminance a color needs to clear 4.5:1 against near-black (≥0.22) and against near-white
 *    (≤0.16) are disjoint ranges. So the fallback is itself mode-aware, via two PRIVATE custom
 *    properties (`dangerFallbackProp`/`successFallbackProp` — names no theme will
 *    ever collide with) set by `:root`/`:root[data-theme="light"]`, mirroring `tokensToRootCss`'s own
 *    dark-default/light-override convention. Measured contrast (darkest/lightest real surface each
 *    color sits on): dark-mode red `#f87171` vs `--surface-2` (oklch 15%) = 7.12:1; light-mode red
 *    `#b91c1c` vs `--surface-2` (`#e8ece9`, the least-light of the three light surfaces) = 5.42:1;
 *    dark-mode green `#4ade80` vs `--surface-2` = 11.31:1; light-mode green `#166534` vs `--surface-2`
 *    = 5.98:1. All four clear 4.5:1 with margin against every surface these classes actually render
 *    on (`--bg`, `--surface`, `--surface-2`), in both modes. (Tailwind red-600/green-700, the more
 *    "expected" light-mode shades, were tried first and REJECTED — 4.05:1 and 4.20:1 against
 *    `--surface-2`, both under 4.5:1.) Every element that gets one of these colors already carries a
 *    real text message (the field's own reason, the error summary, or `successMessage`), so color is
 *    never the only signal — satisfies "don't rely on color alone" (WCAG SC 1.4.1) without adding an
 *    icon glyph this baseline has no icon system to draw from.
 */
export function formBaselineStyle({ names }: NamesArgs, _optional: NoOptions = {}): string {
  return (
    "<style>" +
    rootRules({ names }) +
    builderRules({ names }) +
    htmlModeRules({ names }) +
    selectRules({ names }) +
    feedbackRules({ names }) +
    "</style>"
  );
}

/**
 * Body of the range-slider value readout: a slider alone never shows the number it is set to. Puts
 * an `<output class="{rangeValueClass}">` after each form range input and keeps it in step.
 * Progressive enhancement over the no-JS POST form (the public page CSP allows inline scripts):
 * without it the slider still submits. Idempotent via `rangeMarkerAttr`, so a page with several
 * forms (one copy of this per form) wires each slider once. `aria-hidden` because the slider itself
 * already announces its value; a live readout would repeat it on every step. Exported separately
 * from the `<script>` wrapper so a test can run it against a fake `document`.
 */
export function formRangeReadoutJs({ names }: NamesArgs, _optional: NoOptions = {}): string {
  const marker = names.rangeMarkerAttr;
  return (
    `(function(d){d.querySelectorAll('.${names.formClass} input[type=range]:not([${marker}]),[${names.formAttr}] input[type=range]:not([${marker}])').forEach(function(r){` +
    `r.setAttribute('${marker}','');var o=d.createElement('output');o.className='${names.rangeValueClass}';o.setAttribute('aria-hidden','true');` +
    "if(r.id)o.setAttribute('for',r.id);o.textContent=r.value;r.insertAdjacentElement('afterend',o);" +
    "r.addEventListener('input',function(){o.textContent=r.value;});});})(document);"
  );
}

/** {@link formRangeReadoutJs} as the inline `<script>` a rendered form appends after itself. */
export function formRangeReadoutScript({ names }: NamesArgs, _optional: NoOptions = {}): string {
  return `<script>${formRangeReadoutJs({ names })}</script>`;
}
