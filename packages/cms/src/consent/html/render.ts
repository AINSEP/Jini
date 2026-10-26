import { escapeHtml } from '@jini-ai/core/text';
import { CONSENT_PLACEMENTS, DENIED_CHOICES, type ConsentChoices, type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { compileConsentCss } from '../css.js';
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

/** Optional host links share the same URL validator and attribute/text encoding boundary.
 * @complexity O(link text length); no authored markup reaches the output. */
function policyLinks({ config }: { config: ConsentConfig }): string {
  const e = (text: string) => escapeHtml({ text });
  const href = consentPolicyHref({ url: config.privacyPolicyUrl });
  const secondaryHref = consentPolicyHref({ url: config.secondaryLinkUrl ?? '' });
  const privacy = href ? `<a href="${e(href)}">Privacy policy</a>` : '';
  const secondary = secondaryHref && config.secondaryLinkLabel ? `<a href="${e(secondaryHref)}">${e(config.secondaryLinkLabel)}</a>` : '';
  return [privacy, secondary].filter(Boolean).join(' · ');
}

/** Saved link mode keeps a native fragment target, so withdrawal also works without JS.
 * @complexity O(label length). */
function consentManage({ config, record, reopen }: { config: ConsentConfig; record: ConsentRecord | null; reopen: 'corner' | 'link' }, _options = {}): [string, string] {
  if (record === null) return ['', ''];
  if (reopen === 'link') return ['<div class="jini-consent-panel"><a href="#">Close preferences</a>', '</div>'];
  return [`<details class="jini-consent-manage"><summary class="jini-consent-pill">${escapeHtml({ text: config.preferencesLabel })}</summary><div class="jini-consent-panel">`, '</div></details>'];
}

/** Render one accessible progressive form. Config text is always text, never trusted HTML.
 * Necessary cookies/default rejection work without JS. After a choice the form sits inside a
 * closed disclosure or a host-linked fragment panel, so withdrawal stays one click away
 * (also without JS) without a box at the top of every page. @complexity O(config text length). */
export function renderConsentUi({ config, record, regionMode, gpc, endpoint }: { config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, _options = {}): string {
  const e = (text: string) => escapeHtml({ text });
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const placement = CONSENT_PLACEMENTS.includes(config.placement!) ? config.placement! : 'bottom-bar';
  const categories = (['necessary', 'functional', 'analytics', 'marketing'] as const).map(category => {
    const locked = category === 'necessary' || (gpc && (category === 'analytics' || category === 'marketing'));
    return `<label class="jini-consent-category"><input type="checkbox" name="${category}"${choices[category] ? ' checked' : ''}${locked ? ' disabled' : ''}>${category[0]!.toUpperCase() + category.slice(1)}${category === 'necessary' ? ' (always on)' : ''}</label>`;
  }).join('');
  const reopen = config.reopen === 'link' ? 'link' : 'corner';
  const manage = consentManage({ config, record, reopen });
  // MOVE: The sole no-sale control is the native POST button, so opting out also works without JS.
  // Only a resolved opt-out mode removes first-layer rejection; unknown modes keep the safe opt-in UI.
  return `<section id="jini-consent" class="jini-consent" data-has-record="${record !== null}" data-placement="${placement}" data-reopen="${reopen}" aria-label="Cookie preferences">
${manage[0]}<div class="jini-consent-initial"><h2>${e(config.title)}</h2><p>${e(config.message)}</p>
<p>${regionMode === 'opt-out' ? 'You may opt out of optional cookies at any time.' : 'Optional cookies and scripts stay paused until you agree.'}</p></div>
${policyLinks({ config })}
<p data-jini-gpc-note${gpc ? '' : ' hidden'}>Global Privacy Control is on. Analytics and marketing are disabled.</p>
<form method="post" action="${e(endpoint)}"><input type="hidden" name="policyVersion" value="${e(config.policyVersion)}"><input type="hidden" name="gpc" value="${gpc ? '1' : '0'}">
<p role="alert" data-jini-consent-error hidden></p>
<div class="jini-consent-actions jini-consent-initial">${regionMode === 'opt-out' ? '' : `<button name="action" value="reject">${e(config.rejectLabel)}</button>`}<button name="action" value="accept">${e(config.acceptLabel)}</button></div>
<button id="jini-consent-do-not-sell" name="action" value="do-not-sell" data-jini-do-not-sell-button>${regionMode === 'opt-out' ? 'Do not sell or share my info' : 'Do Not Sell or Share'}</button>
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
function resourcePolicy({ choices, origins, allowUnsafeEval }: { choices: ConsentChoices; origins: ResourceOrigins; allowUnsafeEval: boolean }, _options = {}): string {
  const granted = (['functional', 'analytics'] as const).flatMap(category => choices[category] ? origins.categoryOrigins[category] : []);
  const sources = ["'self'", ...new Set([...origins.resourceOrigins, ...granted])].join(' ');
  return `script-src ${sources} 'unsafe-inline'${allowUnsafeEval ? " 'unsafe-eval'" : ''}; object-src 'none'; style-src ${sources} 'unsafe-inline'; font-src ${sources} data:; img-src ${sources} data: blob:; media-src ${sources}; frame-src ${sources}; connect-src ${sources}`;
}

/** The browser runtime can only reduce choices (navigator GPC, an unsaved withdrawal), so it looks
 * policies up by functional/analytics bits instead of rebuilding them. @complexity O(origins). */
function resourcePolicies({ origins, allowUnsafeEval }: { origins: ResourceOrigins; allowUnsafeEval: boolean }, _options = {}): Record<string, string> {
  const policies: Record<string, string> = {};
  for (const functional of [false, true]) for (const analytics of [false, true]) {
    policies[`${Number(functional)}${Number(analytics)}`] = resourcePolicy({ choices: { ...DENIED_CHOICES, functional, analytics }, origins, allowUnsafeEval });
  }
  return policies;
}

/** Validate at the style sink even when a host bypasses admin preview validation.
 * @complexity O(bounded appearance bytes); raw CSS is never interpolated into HTML. */
function consentStyle({ config, nonceAttr }: { config: ConsentConfig | undefined; nonceAttr: string }): string {
  const appearance = compileConsentCss({ css: config?.customCss ?? '', tokens: config?.appearance ?? {} });
  return `<style data-jini-consent-style${nonceAttr}>${CONSENT_CSS}${appearance.css}</style>`;
}

/** Bootstrap must be inserted before every site script; JSON cannot terminate its script element.
 * @throws Error when a resource or category origin is not an exact HTTP(S) origin.
 * @complexity O(config text length + origins). */
export function renderConsentHead({ record, gpc, regionMode = 'opt-in', config }: { record: ConsentRecord | null; gpc: boolean; regionMode?: ConsentRegionMode; config?: ConsentConfig }, { nonce, runtimeToken, resourceOrigins, categoryOrigins }: { nonce?: string; runtimeToken?: string; resourceOrigins?: readonly string[]; categoryOrigins?: ConsentCategoryOrigins } = {}): string {
  const choices = resolveConsentChoices({ choices: record?.choices, gpc, regionMode });
  const gpcChoices = resolveConsentChoices({ choices: record?.choices, gpc: true, regionMode });
  const origins = validatedOrigins({ resourceOrigins, categoryOrigins });
  // Stored settings can bypass TypeScript: truthy values must never weaken the policy.
  const allowUnsafeEval = config?.allowUnsafeEval === true;
  const state = JSON.stringify({ resourcePolicies: resourcePolicies({ origins, allowUnsafeEval }), choices, gpcChoices, signalCategories: GOOGLE_CONSENT_SIGNAL_CATEGORIES, hasRecord: record !== null, optOut: regionMode === 'opt-out', gpc }).replace(/</g, '\\u003c');
  // First-party code can inject remote scripts, and a local stylesheet can import remote
  // CSS/fonts that HTML traversal cannot see. Enforce the same grants in the browser.
  // Each choice reloads, so restrictive policy can be removed only after a saved grant.
  const resourcePolicyMeta = choices.marketing ? '' : `<meta http-equiv="Content-Security-Policy" content="${escapeHtml({ text: resourcePolicy({ choices, origins, allowUnsafeEval }) })}">`;
  const nonceAttr = nonce === undefined ? '' : ` nonce="${escapeHtml({ text: nonce })}"`;
  return `${resourcePolicyMeta}${consentStyle({ config, nonceAttr })}<script type="application/json" id="jini-consent-config"${nonceAttr}>${state}</script><script data-jini-consent-runtime="${escapeHtml({ text: runtimeToken ?? '' })}"${nonceAttr}>${CONSENT_CLIENT}</script>`;
}
