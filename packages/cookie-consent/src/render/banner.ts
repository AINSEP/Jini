/** @file Pure strings: no DOM, no Node. The same output feeds live pages, the static export and the admin
 * preview iframe, so preview and live cannot drift. The markup is identical for every visitor: region and GPC
 * variants are toggled by CSS from <html> attributes the client sets, so pages stay cacheable. */
import { BANNER_MODES, CONFIG_ID, type BannerMode, type Category, type ClientConfig, type Evidence, type RegionMode } from '../contract.js';
import { BASE_CSS } from './base-css.js';
import { compileConsentCss, type ConsentAppearanceTokens, type ConsentCssProblem } from './css.js';

export const CONSENT_PLACEMENTS = ['bottom-bar', 'bottom-left', 'bottom-right', 'top-bar'] as const;
export type ConsentPlacement = typeof CONSENT_PLACEMENTS[number];

/** Every visible string is owner copy; DEFAULT_COPY fills only what the host leaves out. */
export interface BannerCopy {
  title: string; message: string; acceptLabel: string; rejectLabel: string; preferencesLabel: string;
  saveLabel: string; doNotSellLabel: string; categoriesLegend: string; gpcNote: string; errorMessage: string;
  reopenLabel: string; privacyLabel: string; privacyPolicyUrl: string;
  secondaryLinkLabel?: string; secondaryLinkUrl?: string;
  categoryLabels: Record<Category, string>;
}
export const DEFAULT_COPY: Readonly<BannerCopy> = Object.freeze({
  title: 'Cookies', message: 'We use optional cookies for analytics and marketing only if you agree.',
  acceptLabel: 'Accept', rejectLabel: 'Reject', preferencesLabel: 'Preferences', saveLabel: 'Save preferences',
  doNotSellLabel: 'Do not sell or share my personal information', categoriesLegend: 'Cookie categories',
  gpcNote: 'Global Privacy Control is on, so analytics and marketing stay off.',
  errorMessage: 'Your choice could not be saved yet. Optional cookies stay off until it is.',
  reopenLabel: 'Privacy choices', privacyLabel: 'Privacy policy', privacyPolicyUrl: '',
  categoryLabels: { necessary: 'Necessary (always on)', functional: 'Functional', analytics: 'Analytics', marketing: 'Marketing' },
});

export type BannerCopyInput = Partial<Omit<BannerCopy, 'categoryLabels'>> & { categoryLabels?: Partial<Record<Category, string>> };
export interface RenderBannerConfig { mode: BannerMode; client: Omit<ClientConfig, 'banner'>; copy: BannerCopyInput }
export interface RenderBannerOptions {
  evidence?: Evidence; placement?: ConsentPlacement; reopen?: 'corner' | 'link';
  appearance?: ConsentAppearanceTokens; customCss?: string;
  /** URL of dist/client.min.js as the host serves it. Omitted in a preview. */
  clientSrc?: string; nonce?: string;
  /** Scriptless admin preview: the banner renders open for the given region; htmlAttrs go on the iframe's <html>. */
  preview?: { region: RegionMode; panel?: boolean };
}
export interface RenderedBanner { head: string; body: string; htmlAttrs: string; problems: ConsentCssProblem[] }

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => String(s).replace(/[&<>"']/g, ch => ESC[ch]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const EMPTY: RenderedBanner = Object.freeze({ head: '', body: '', htmlAttrs: '', problems: [] }) as RenderedBanner;

// MOVED-FROM: @jini-ai/cms consent/html/render.ts consentPolicyHref. TODO(P4): delete the cms copy.
/** Refuse executable/data/protocol-relative links; local pages are the common case. @complexity O(url length). */
export function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  if (/^\/(?!\/)/.test(url) && !/[\\\x00-\x20]/.test(url)) return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null; }
  catch { return null; }
}

/** Owner copy over the defaults; a non-string field falls back instead of rendering "undefined". */
export function resolveCopy(input: BannerCopyInput = {}): BannerCopy {
  const pick = <T extends object>(base: T, over: object | undefined): T =>
    Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof (over as Record<string, unknown> | undefined)?.[k] === 'string' ? (over as Record<string, string>)[k] : v])) as T;
  const { categoryLabels, ...rest } = DEFAULT_COPY;
  const merged = pick(rest, input) as BannerCopy;
  for (const key of ['secondaryLinkLabel', 'secondaryLinkUrl'] as const) if (typeof input[key] === 'string') merged[key] = input[key];
  merged.categoryLabels = pick(categoryLabels, input.categoryLabels);
  return merged;
}

/** @example renderBanner({ mode: 'jini', client: { contract: 1, policy: '2026-10-26', regionMode: 'auto' }, copy: {} }, { clientSrc: '/consent/client.min.js', evidence: { mode: 'local' } })
 * @complexity O(copy + CSS length). */
export function renderBanner({ mode, client, copy }: RenderBannerConfig, options: RenderBannerOptions = {}): RenderedBanner {
  if (!BANNER_MODES.includes(mode) || mode === 'off') return EMPTY;
  const evidence = options.evidence ?? { mode: 'local' };
  const n = options.nonce ? ` nonce="${esc(options.nonce)}"` : '';
  const head = `<script type="application/json" id="${CONFIG_ID}">${json({ ...client, banner: mode, evidence })}</script>${clientScript(options, n)}`;
  const htmlAttrs = previewAttrs(options.preview);
  if (mode === 'headless') return { head, body: '', htmlAttrs, problems: [] };
  const compiled = compileConsentCss({ css: options.customCss ?? '', tokens: options.appearance ?? {} });
  const style = `<style data-jini-consent-style${n}>${BASE_CSS}${compiled.css}</style>`;
  return { head: style + head, body: markup({ copy: resolveCopy(copy), options, evidence }), htmlAttrs, problems: compiled.problems };
}

/** A preview is scriptless: the admin iframe shows the markup, never runs the client. */
function clientScript({ preview, clientSrc }: RenderBannerOptions, nonceAttr: string): string {
  return preview || !clientSrc ? '' : `<script src="${esc(clientSrc)}" defer${nonceAttr}></script>`;
}

/** Attributes for the preview iframe's <html>, standing in for what the client sets on a live page. */
function previewAttrs(preview: RenderBannerOptions['preview']): string {
  if (!preview) return '';
  return `data-consent="pending" data-consent-region="${preview.region === 'opt-out' ? 'opt-out' : 'opt-in'}" data-consent-open`;
}

function links(copy: BannerCopy): string {
  const privacy = safeHref(copy.privacyPolicyUrl);
  const second = safeHref(copy.secondaryLinkUrl);
  const items = [privacy ? `<a href="${esc(privacy)}">${esc(copy.privacyLabel)}</a>` : '',
    second && copy.secondaryLinkLabel ? `<a href="${esc(second)}">${esc(copy.secondaryLinkLabel)}</a>` : ''].filter(Boolean);
  return items.length ? `<p class="jini-consent-links">${items.join(' · ')}</p>` : '';
}

function categories(copy: BannerCopy): string {
  const box = (name: Category, attrs: string) => `<label><input type="checkbox" name="${name}"${attrs}>${esc(copy.categoryLabels[name])}</label>`;
  return box('necessary', ' checked disabled') + box('functional', '') + box('analytics', '') + box('marketing', '');
}

function markup({ copy, options, evidence }: { copy: BannerCopy; options: RenderBannerOptions; evidence: Evidence }): string {
  const b = (action: string, label: string, extra = '') => `<button type="button" data-consent-action="${action}"${extra}>${esc(label)}</button>`;
  const placement = CONSENT_PLACEMENTS.includes(options.placement!) ? options.placement! : 'bottom-bar';
  const reopen = options.reopen === 'link' ? '' : `<button type="button" class="jini-consent-reopen" data-consent-open>${esc(copy.reopenLabel)}</button>`;
  return `<section id="jini-consent" class="jini-consent" role="dialog" aria-modal="false" aria-labelledby="jini-consent-title" data-placement="${placement}" data-evidence="${evidence.mode}"${options.preview ? ' data-preview' : ' hidden'}>
<h2 id="jini-consent-title">${esc(copy.title)}</h2><p>${esc(copy.message)}</p>${links(copy)}
<p data-consent-gpc>${esc(copy.gpcNote)}</p><p role="alert" data-consent-error hidden>${esc(copy.errorMessage)}</p>
<div class="jini-consent-actions">${b('reject', copy.rejectLabel, ' data-consent-only="opt-in"')}${b('accept', copy.acceptLabel)}</div>
${b('do-not-sell', copy.doNotSellLabel, ' class="jini-consent-link" data-consent-only="opt-out"')}
<details${options.preview?.panel ? ' open' : ''}><summary>${esc(copy.preferencesLabel)}</summary><fieldset><legend>${esc(copy.categoriesLegend)}</legend>${categories(copy)}</fieldset>
<div class="jini-consent-actions">${b('save', copy.saveLabel)}${b('reject', copy.rejectLabel)}</div></details>
</section>${options.preview ? '' : reopen}`;
}
