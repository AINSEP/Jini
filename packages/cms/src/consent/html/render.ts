import { escapeHtml } from '@jini-ai/core/text';
import { DENIED_CHOICES, type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { googleConsentSignals, resolveConsentChoices } from '../policy.js';
import { CONSENT_CLIENT } from './client.js';
import { CONSENT_CSS } from './styles.js';

/** Refuse executable/data/protocol-relative privacy links; local pages are the common case.
 * @complexity O(url length). */
export function consentPolicyHref({ url }: { url: string }, _options = {}): string | null {
  if (/^\/(?!\/)/.test(url) && !/[\\\x00-\x20]/.test(url)) return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null; }
  catch { return null; }
}

/** Render one accessible progressive form. Config text is always text, never trusted HTML.
 * Necessary cookies/default rejection work without JS. @complexity O(config text length). */
export function renderConsentUi({ config, record, regionMode, gpc, endpoint }: { config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, _options = {}): string {
  const e = (text: string) => escapeHtml({ text });
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const href = consentPolicyHref({ url: config.privacyPolicyUrl });
  const categories = (['necessary', 'functional', 'analytics', 'marketing'] as const).map(category => {
    const locked = category === 'necessary' || (gpc && (category === 'analytics' || category === 'marketing'));
    return `<label class="jini-consent-category"><input type="checkbox" name="${category}"${choices[category] ? ' checked' : ''}${locked ? ' disabled' : ''}>${category[0]!.toUpperCase() + category.slice(1)}${category === 'necessary' ? ' (always on)' : ''}</label>`;
  }).join('');
  return `<section id="jini-consent" class="jini-consent" data-has-record="${record !== null}" aria-label="Cookie preferences">
<div class="jini-consent-initial"><h2>${e(config.title)}</h2><p>${e(config.message)}</p>
<p>${regionMode === 'opt-out' ? 'You may opt out of optional cookies at any time.' : 'Optional cookies and scripts stay paused until you agree.'}</p></div>
${href ? `<a href="${e(href)}">Privacy policy</a> · ` : ''}<a href="#jini-consent-preferences" data-jini-do-not-sell>Do Not Sell or Share</a>
<p data-jini-gpc-note${gpc ? '' : ' hidden'}>Global Privacy Control is on. Analytics and marketing are disabled.</p>
<form method="post" action="${e(endpoint)}"><input type="hidden" name="policyVersion" value="${e(config.policyVersion)}"><input type="hidden" name="gpc" value="${gpc ? '1' : '0'}">
<p role="alert" data-jini-consent-error hidden></p>
<div class="jini-consent-actions jini-consent-initial"><button name="action" value="reject">${e(config.rejectLabel)}</button><button name="action" value="accept">${e(config.acceptLabel)}</button></div>
<button id="jini-consent-do-not-sell" name="action" value="do-not-sell" data-jini-do-not-sell-button>Do Not Sell or Share</button>
<details id="jini-consent-preferences"><summary>${e(config.preferencesLabel)}</summary><fieldset><legend>Cookie categories</legend>${categories}</fieldset>
<div class="jini-consent-actions"><button name="action" value="save">Save preferences</button><button name="action" value="reject">${e(config.rejectLabel)}</button></div></details></form></section>`;
}

/** Bootstrap must be inserted before every site script; JSON cannot terminate its script element.
 * @complexity O(config text length). */
export function renderConsentHead({ record, gpc, regionMode = 'opt-in' }: { record: ConsentRecord | null; gpc: boolean; regionMode?: ConsentRegionMode }, { nonce, runtimeToken, resourceOrigins = [] }: { nonce?: string; runtimeToken?: string; resourceOrigins?: readonly string[] } = {}): string {
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const gpcChoices = resolveConsentChoices({ choices: record?.choices, gpc: true, regionMode });
  // Origins are a host contract, never extracted from authored resource URLs.
  const origins = resourceOrigins.map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('Consent resource origins must be HTTP(S) origins.');
    return url.origin;
  });
  const sources = ["'self'", ...origins].join(' ');
  const preConsentPolicy = `style-src ${sources} 'unsafe-inline'; font-src ${sources} data:; img-src ${sources} data: blob:; media-src ${sources}; frame-src ${sources}; connect-src ${sources}`;
  const state = JSON.stringify({ resourcePolicy: preConsentPolicy, choices, gpcChoices, signals: googleConsentSignals({ choices }), gpcSignals: googleConsentSignals({ choices: gpcChoices }), deniedSignals: googleConsentSignals({ choices: DENIED_CHOICES }), hasRecord: record !== null, optOut: regionMode === 'opt-out', gpc }).replace(/</g, '\\u003c');
  // A local stylesheet can import remote CSS/fonts that HTML traversal cannot see.
  // Each choice reloads, so restrictive policy can be removed only after a saved grant.
  const resourcePolicy = choices.marketing ? '' : `<meta http-equiv="Content-Security-Policy" content="${escapeHtml({ text: preConsentPolicy })}">`;
  const nonceAttr = nonce === undefined ? '' : ` nonce="${escapeHtml({ text: nonce })}"`;
  return `${resourcePolicy}<style data-jini-consent-style${nonceAttr}>${CONSENT_CSS}</style><script type="application/json" id="jini-consent-config"${nonceAttr}>${state}</script><script data-jini-consent-runtime="${escapeHtml({ text: runtimeToken ?? '' })}"${nonceAttr}>${CONSENT_CLIENT}</script>`;
}
