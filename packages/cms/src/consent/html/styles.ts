/** Compact defaults and scoped fallback styles share consent variables across the banner, native controls and saved panel. */
// Placement selectors apply before and after a choice so reopening cannot move the panel.
// MOVE: Auto-fit keeps actions equally sized in one row when they fit, without growing the text controls.
// Native disclosure/fragment state also covers JS-off pages; hiding avoids pushing tall chat panels offscreen.
export const CONSENT_CSS = `
:root:not(.jini-consent-has-choice):has(#jini-consent[data-has-record="false"]),:root:has(#jini-consent[data-reopen="link"]:target,#jini-consent>.jini-consent-manage[open]){--jini-floating-ui-display:none}
.jini-consent{--consent-bg:var(--jini-surface,var(--bg,Canvas));--consent-fg:var(--jini-text,var(--fg,CanvasText));--consent-border:var(--jini-border,var(--border,color-mix(in srgb,var(--consent-fg) 14%,var(--consent-bg))));--consent-accent:var(--jini-accent,var(--accent,var(--consent-fg)));--consent-radius:var(--jini-radius,14px);--consent-button-bg:color-mix(in srgb,var(--consent-fg) 7%,var(--consent-bg));--consent-button-hover-bg:color-mix(in srgb,var(--consent-fg) 13%,var(--consent-bg));--consent-button-border:color-mix(in srgb,var(--consent-fg) 26%,var(--consent-bg));--consent-shadow:0 1px 2px #0000000f,0 12px 32px #00000024;position:fixed;inset:auto 1rem 1rem;z-index:2147483647;margin:auto;max-width:380px;max-height:85dvh;overflow:auto;padding:14px 16px;border:1px solid var(--consent-border);border-radius:var(--consent-radius);background:var(--consent-bg);color:var(--consent-fg);box-shadow:var(--consent-shadow);font:inherit;font-size:13.5px;line-height:1.45;text-align:start;box-sizing:border-box}
.jini-consent *, .jini-consent *::before, .jini-consent *::after{box-sizing:border-box}
.jini-consent h2{font:inherit;font-size:15px;font-weight:650;margin:0 0 4px;color:inherit}
.jini-consent p{margin:0 0 6px;color:inherit}
.jini-consent>a,.jini-consent-panel>a{margin-right:8px;font-size:12.5px}
.jini-consent form{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:14px;margin:0}
.jini-consent form>*{flex:1 1 100%}
.jini-consent form>[data-jini-do-not-sell-button],.jini-consent form>details:not([open]){flex:0 1 auto}
.jini-consent-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:8px;margin-top:10px}
.jini-consent button,.jini-consent summary{font:inherit;cursor:pointer}
.jini-consent button{min-height:34px;padding:4px 12px;border:1px solid var(--consent-button-border);border-radius:8px;background:var(--consent-button-bg);color:inherit;font-weight:600;transition:background-color .15s ease,border-color .15s ease}
.jini-consent button:hover{background:var(--consent-button-hover-bg)}
.jini-consent button:disabled{cursor:default;opacity:.65}
.jini-consent [data-jini-do-not-sell-button]{margin-top:10px;padding:0;min-height:0;border:0;background:transparent;font-size:12.5px;font-weight:400;text-decoration:underline;text-underline-offset:.2em}
.jini-consent a{color:inherit;text-decoration:underline;text-underline-offset:.2em;text-decoration-thickness:1px}
.jini-consent :focus-visible{outline:3px solid currentColor;outline-offset:2px;border-radius:8px}
.jini-consent details{margin-top:10px}
.jini-consent summary{display:inline-flex;align-items:center;list-style:none;padding:0;min-height:0;border:0;font-size:12.5px;font-weight:400;text-decoration:underline;text-underline-offset:.2em}
.jini-consent summary::-webkit-details-marker{display:none}
.jini-consent fieldset{margin:.25rem 0 0;padding:.25rem .875rem;border:1px solid var(--consent-border);border-radius:12px}
.jini-consent legend{padding:0 .35rem;font-size:.8125rem;font-weight:600;color:inherit}
.jini-consent-category{display:flex;align-items:center;gap:.6rem;padding:.35rem 0;min-height:32px}
.jini-consent-category input{width:1.15rem;height:1.15rem;margin:0;accent-color:var(--consent-accent)}
#jini-consent:where([data-placement="bottom-bar"]){inset:auto 1rem 1rem;max-width:380px}
#jini-consent:where([data-placement="bottom-left"]){inset:auto auto 1rem 1rem;max-width:380px}
#jini-consent:where([data-placement="bottom-right"]){inset:auto 1rem 1rem auto;max-width:380px}
#jini-consent:where([data-placement="top-bar"]){inset:1rem 1rem auto;max-width:380px}
.jini-consent[data-has-record="true"]{max-height:none;overflow:visible;padding:0;border:0;background:none;box-shadow:none}
.jini-consent[data-has-record="true"] .jini-consent-initial,.jini-consent[data-has-record="true"] #jini-consent-preferences>summary{display:none}
#jini-consent[data-has-record="true"][data-reopen="link"]:not(:target){display:none!important}
.jini-consent .jini-consent-manage{margin:0}
.jini-consent .jini-consent-pill{display:inline-flex;align-items:center;list-style:none;padding:.5rem 1rem;border:1px solid var(--consent-border);border-radius:999px;background:var(--consent-bg);box-shadow:var(--consent-shadow);text-decoration:none}
.jini-consent .jini-consent-pill::-webkit-details-marker{display:none}
.jini-consent-panel{margin-top:.5rem;max-height:70dvh;overflow:auto;padding:14px 16px;border:1px solid var(--consent-border);border-radius:var(--consent-radius);background:var(--consent-bg);box-shadow:var(--consent-shadow)}
.jini-consent [hidden]{display:none!important}
@media(max-width:640px){.jini-consent{inset:auto 0 0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-radius:var(--consent-radius) var(--consent-radius) 0 0}#jini-consent{max-width:100%}.jini-consent-panel{padding:1rem}}
@media(prefers-reduced-motion:reduce){.jini-consent,.jini-consent *{transition:none!important;animation:none!important}}
`;
