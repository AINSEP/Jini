import { escapeHtml } from '@jini-ai/core/text';
import { DENIED_CHOICES, type ConsentChoices, type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { GOOGLE_CONSENT_SIGNAL_CATEGORIES, resolveConsentChoices } from '../policy.js';
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
 * Necessary cookies/default rejection work without JS. After a choice the form sits inside a
 * closed disclosure whose summary is a small corner control, so withdrawal stays one click away
 * (also without JS) without a box at the top of every page. @complexity O(config text length). */
export function renderConsentUi({ config, record, regionMode, gpc, endpoint }: { config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, _options = {}): string {
  const e = (text: string) => escapeHtml({ text });
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const href = consentPolicyHref({ url: config.privacyPolicyUrl });
  const categories = (['necessary', 'functional', 'analytics', 'marketing'] as const).map(category => {
    const locked = category === 'necessary' || (gpc && (category === 'analytics' || category === 'marketing'));
    return `<label class="jini-consent-category"><input type="checkbox" name="${category}"${choices[category] ? ' checked' : ''}${locked ? ' disabled' : ''}>${category[0]!.toUpperCase() + category.slice(1)}${category === 'necessary' ? ' (always on)' : ''}</label>`;
  }).join('');
  const manage = record === null ? ['', ''] : [`<details class="jini-consent-manage"><summary class="jini-consent-pill">${e(config.preferencesLabel)}</summary><div class="jini-consent-panel">`, '</div></details>'];
  return `<section id="jini-consent" class="jini-consent" data-has-record="${record !== null}" aria-label="Cookie preferences">
${manage[0]}<div class="jini-consent-initial"><h2>${e(config.title)}</h2><p>${e(config.message)}</p>
<p>${regionMode === 'opt-out' ? 'You may opt out of optional cookies at any time.' : 'Optional cookies and scripts stay paused until you agree.'}</p></div>
${href ? `<a href="${e(href)}">Privacy policy</a> · ` : ''}<a href="#jini-consent-preferences" data-jini-do-not-sell>Do Not Sell or Share</a>
<p data-jini-gpc-note${gpc ? '' : ' hidden'}>Global Privacy Control is on. Analytics and marketing are disabled.</p>
<form method="post" action="${e(endpoint)}"><input type="hidden" name="policyVersion" value="${e(config.policyVersion)}"><input type="hidden" name="gpc" value="${gpc ? '1' : '0'}">
<p role="alert" data-jini-consent-error hidden></p>
<div class="jini-consent-actions jini-consent-initial"><button name="action" value="reject">${e(config.rejectLabel)}</button><button name="action" value="accept">${e(config.acceptLabel)}</button></div>
<button id="jini-consent-do-not-sell" name="action" value="do-not-sell" data-jini-do-not-sell-button>Do Not Sell or Share</button>
<details id="jini-consent-preferences"${record === null ? '' : ' open'}><summary>${e(config.preferencesLabel)}</summary><fieldset><legend>Cookie categories</legend>${categories}</fieldset>
<div class="jini-consent-actions"><button name="action" value="save">Save preferences</button><button name="action" value="reject">${e(config.rejectLabel)}</button></div></details></form>${manage[1]}</section>`;
}

/** Host-reviewed origins of resources a granted category may reach (an analytics collector,
 * a chat service). Marketing needs none: a marketing grant removes the resource policy. */
export type ConsentCategoryOrigins = Partial<Record<'functional' | 'analytics', readonly string[]>>;
type ResourceOrigins = { resourceOrigins: readonly string[]; categoryOrigins: Required<ConsentCategoryOrigins> };

/** Origins are a host contract, never extracted from authored resource URLs.
 * @throws Error naming the invalid origin and the expected shape. @complexity O(origins). */
function exactOrigins({ values }: { values: readonly string[] }): string[] {
  return values.map(value => {
    let url: URL | null = null;
    try { url = new URL(value); } catch { /* reported below with the expected shape */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.hostname.includes('*')) throw new Error(`Consent resource origin "${value}" must be an exact HTTP(S) origin such as https://cdn.example (no path or trailing slash).`);
    return url.origin;
  });
}

/** @throws Error naming the first invalid origin. @complexity O(origins). */
function validatedOrigins({ resourceOrigins = [], categoryOrigins = {} }: { resourceOrigins?: readonly string[] | undefined; categoryOrigins?: ConsentCategoryOrigins | undefined }): ResourceOrigins {
  return { resourceOrigins: exactOrigins({ values: resourceOrigins }), categoryOrigins: { functional: exactOrigins({ values: categoryOrigins.functional ?? [] }), analytics: exactOrigins({ values: categoryOrigins.analytics ?? [] }) } };
}

/** Pre-consent resource policy for one choice set: theme origins plus each granted category's
 * origins, so an analytics grant reaches its collector without granting marketing. @complexity O(origins). */
function resourcePolicy({ choices, origins }: { choices: ConsentChoices; origins: ResourceOrigins }): string {
  const granted = (['functional', 'analytics'] as const).flatMap(category => choices[category] ? origins.categoryOrigins[category] : []);
  const sources = ["'self'", ...new Set([...origins.resourceOrigins, ...granted])].join(' ');
  return `style-src ${sources} 'unsafe-inline'; font-src ${sources} data:; img-src ${sources} data: blob:; media-src ${sources}; frame-src ${sources}; connect-src ${sources}`;
}

/** The browser runtime can only reduce choices (navigator GPC, an unsaved withdrawal), so it looks
 * policies up by functional/analytics bits instead of rebuilding them. @complexity O(origins). */
function resourcePolicies({ origins }: { origins: ResourceOrigins }): Record<string, string> {
  const policies: Record<string, string> = {};
  for (const functional of [false, true]) for (const analytics of [false, true]) {
    policies[`${Number(functional)}${Number(analytics)}`] = resourcePolicy({ choices: { ...DENIED_CHOICES, functional, analytics }, origins });
  }
  return policies;
}

/** Bootstrap must be inserted before every site script; JSON cannot terminate its script element.
 * @throws Error when a resource or category origin is not an exact HTTP(S) origin.
 * @complexity O(config text length + origins). */
export function renderConsentHead({ record, gpc, regionMode = 'opt-in' }: { record: ConsentRecord | null; gpc: boolean; regionMode?: ConsentRegionMode }, { nonce, runtimeToken, resourceOrigins, categoryOrigins }: { nonce?: string; runtimeToken?: string; resourceOrigins?: readonly string[]; categoryOrigins?: ConsentCategoryOrigins } = {}): string {
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const gpcChoices = resolveConsentChoices({ choices: record?.choices, gpc: true, regionMode });
  const origins = validatedOrigins({ resourceOrigins, categoryOrigins });
  const state = JSON.stringify({ resourcePolicies: resourcePolicies({ origins }), choices, gpcChoices, signalCategories: GOOGLE_CONSENT_SIGNAL_CATEGORIES, hasRecord: record !== null, optOut: regionMode === 'opt-out', gpc }).replace(/</g, '\\u003c');
  // A local stylesheet can import remote CSS/fonts that HTML traversal cannot see.
  // Each choice reloads, so restrictive policy can be removed only after a saved grant.
  const resourcePolicyMeta = choices.marketing ? '' : `<meta http-equiv="Content-Security-Policy" content="${escapeHtml({ text: resourcePolicy({ choices, origins }) })}">`;
  const nonceAttr = nonce === undefined ? '' : ` nonce="${escapeHtml({ text: nonce })}"`;
  return `${resourcePolicyMeta}<style data-jini-consent-style${nonceAttr}>${CONSENT_CSS}</style><script type="application/json" id="jini-consent-config"${nonceAttr}>${state}</script><script data-jini-consent-runtime="${escapeHtml({ text: runtimeToken ?? '' })}"${nonceAttr}>${CONSENT_CLIENT}</script>`;
}
