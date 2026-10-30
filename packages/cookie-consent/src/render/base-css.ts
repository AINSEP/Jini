// MOVED-FROM: @jini-ai/cms consent/html/styles.ts (CONSENT_CSS). Changed: scoped to the new visitor-independent
// markup (no data-has-record states, no form). Follow-up (P4): delete the cms copy once the consumer reads this package.
/** Compact defaults for the Jini banner. Theme tokens (--jini-surface, --jini-text, ...) are honoured when the
 * host page defines them; owner tokens/CSS from compileConsentCss() follow, then the engine parity block. */
// Auto-fit keeps actions equally sized in one row when they fit, without growing the text controls.
// Placement selectors use :where() so owner CSS can still move the banner without fighting specificity.
export const BASE_CSS = `
.jini-consent{--consent-bg:var(--jini-surface,var(--bg,Canvas));--consent-fg:var(--jini-text,var(--fg,CanvasText));--consent-border:var(--jini-border,var(--border,color-mix(in srgb,var(--consent-fg) 14%,var(--consent-bg))));--consent-accent:var(--jini-accent,var(--accent,var(--consent-fg)));--consent-radius:var(--jini-radius,14px);--consent-button-bg:color-mix(in srgb,var(--consent-fg) 7%,var(--consent-bg));--consent-button-hover-bg:color-mix(in srgb,var(--consent-fg) 13%,var(--consent-bg));--consent-button-border:color-mix(in srgb,var(--consent-fg) 26%,var(--consent-bg));--consent-shadow:0 1px 2px #0000000f,0 12px 32px #00000024;position:fixed;inset:auto 1rem 1rem;z-index:2147483647;margin:auto;max-width:380px;max-height:85dvh;overflow:auto;padding:14px 16px;border:1px solid var(--consent-border);border-radius:var(--consent-radius);background:var(--consent-bg);color:var(--consent-fg);box-shadow:var(--consent-shadow);font:inherit;font-size:13.5px;line-height:1.45;text-align:start;box-sizing:border-box}
.jini-consent *,.jini-consent *::before,.jini-consent *::after{box-sizing:border-box}
.jini-consent h2{font:inherit;font-size:15px;font-weight:650;margin:0 0 4px;color:inherit}
.jini-consent p{margin:0 0 6px;color:inherit}
.jini-consent-links{font-size:12.5px}
.jini-consent-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:8px;margin-top:10px}
.jini-consent button,.jini-consent summary,.jini-consent-reopen{font:inherit;cursor:pointer}
.jini-consent button{min-height:34px;padding:4px 12px;border:1px solid var(--consent-button-border);border-radius:8px;background:var(--consent-button-bg);color:inherit;font-weight:600;transition:background-color .15s ease,border-color .15s ease}
.jini-consent button:hover{background:var(--consent-button-hover-bg)}
.jini-consent .jini-consent-link{margin-top:10px;padding:0;min-height:0;border:0;background:transparent;font-size:12.5px;font-weight:400;text-decoration:underline;text-underline-offset:.2em}
.jini-consent a{color:inherit;text-decoration:underline;text-underline-offset:.2em;text-decoration-thickness:1px}
.jini-consent :focus-visible{outline:3px solid currentColor;outline-offset:2px;border-radius:8px}
.jini-consent details{margin-top:10px}
.jini-consent summary{display:inline-flex;align-items:center;list-style:none;font-size:12.5px;text-decoration:underline;text-underline-offset:.2em}
.jini-consent summary::-webkit-details-marker{display:none}
.jini-consent fieldset{margin:.25rem 0 0;padding:.25rem .875rem;border:1px solid var(--consent-border);border-radius:12px}
.jini-consent legend{padding:0 .35rem;font-size:.8125rem;font-weight:600;color:inherit}
.jini-consent label{display:flex;align-items:center;gap:.6rem;padding:.35rem 0;min-height:32px}
.jini-consent input{width:1.15rem;height:1.15rem;margin:0;accent-color:var(--consent-accent)}
#jini-consent:where([data-placement="bottom-left"]){inset:auto auto 1rem 1rem}
#jini-consent:where([data-placement="bottom-right"]){inset:auto 1rem 1rem auto}
#jini-consent:where([data-placement="top-bar"]){inset:1rem 1rem auto}
.jini-consent-reopen{display:none;position:fixed;left:1rem;bottom:1rem;z-index:2147483646;padding:.5rem 1rem;border:1px solid var(--jini-border,#0002);border-radius:999px;background:var(--jini-surface,Canvas);color:var(--jini-text,CanvasText);font-size:12.5px;box-shadow:0 1px 2px #0000000f,0 8px 20px #0000001f}
html[data-consent="set"]:not([data-consent-open]) .jini-consent-reopen{display:inline-flex}
@media(max-width:640px){.jini-consent{inset:auto 0 0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-radius:var(--consent-radius) var(--consent-radius) 0 0}}
@media(prefers-reduced-motion:reduce){.jini-consent,.jini-consent *{transition:none!important;animation:none!important}}
`;
