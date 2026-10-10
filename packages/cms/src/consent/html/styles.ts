/** Scoped fallback styles use inherited theme typography and overridable jini tokens. */
export const CONSENT_CSS = `
.jini-consent{position:fixed;inset:auto 1rem 1rem;z-index:2147483000;margin:auto;max-width:46rem;max-height:85dvh;overflow:auto;padding:1.25rem;border:1px solid var(--jini-border,var(--border,#d4d4d4));border-radius:var(--jini-radius,12px);background:var(--jini-surface,var(--bg,#fff));color:var(--jini-text,var(--fg,#222));box-shadow:0 8px 32px #0002;font:inherit;line-height:1.5;text-align:start;box-sizing:border-box}
.jini-consent *, .jini-consent *::before, .jini-consent *::after{box-sizing:border-box}
.jini-consent h2{font:inherit;font-weight:650;margin:0 0 .5rem;color:inherit}
.jini-consent p{margin:.5rem 0;color:inherit}
.jini-consent-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem}
.jini-consent button,.jini-consent summary{font:inherit;cursor:pointer;min-height:44px}
.jini-consent button{padding:.55rem .85rem;border:1px solid currentColor;border-radius:var(--jini-radius,8px);background:transparent;color:inherit}
.jini-consent button:disabled{cursor:default;opacity:.65}
.jini-consent a{color:inherit;text-decoration:underline}
.jini-consent :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.jini-consent details{margin-top:.75rem}
.jini-consent summary{padding:.5rem 0}
.jini-consent-category{display:flex;align-items:center;gap:.6rem;padding:.35rem 0;min-height:44px}
.jini-consent-category input{width:1.15rem;height:1.15rem;accent-color:var(--jini-accent,#333)}
.jini-consent[data-has-record="true"]{position:static;box-shadow:none;margin:1rem auto;max-height:none}
.jini-consent[data-has-record="true"] .jini-consent-initial{display:none}
.jini-consent [hidden]{display:none!important}
@media(max-width:480px){.jini-consent{inset:auto .5rem .5rem;padding:1rem;max-height:80dvh}.jini-consent-actions button{flex:1 1 auto}.jini-consent[data-has-record="true"]{margin:1rem .5rem}}
`;
