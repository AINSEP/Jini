import type { ConsentFieldProblem } from '@jini-ai/core/contracts/site/cookie-consent-react';

import type { ConsentDetectedItem } from './settings.hooks.js';

import { resolveActiveTabId } from '@jini-ai/core/text';
/** @file Pure decisions for the Cookie Consent page: tabs, problem routing, status copy, publish gate. */

export const CONSENT_TAB_IDS = ['overview', 'banner', 'look', 'rules'] as const;
export type ConsentTabId = typeof CONSENT_TAB_IDS[number];

/** An absent or unknown `?tab=` opens Overview, like every other tabbed admin screen. */
export function resolveConsentTabId({ tabId }: { tabId: string | null | undefined }, _optional = {}): ConsentTabId {
  return resolveActiveTabId({ tabId, validIds: CONSENT_TAB_IDS, defaultId: 'overview' });
}

/** How the host's request layer reads a failure. The host owns its error class, so it decides what a
 * conflict is and which message an operator may see. */
export interface ConsentErrors {
  /** A stale draft/published revision (HTTP 409): reload and review, never retry over it. */
  isConflict(required: { error: unknown }, optional?: Record<string, never>): boolean;
  /** The operator-facing message for a failed request, else `fallback`. */
  describe(required: { error: unknown; fallback: string }, optional?: Record<string, never>): string;
}

const FIELD_TABS: Readonly<Record<string, ConsentTabId>> = {
  title: 'banner', message: 'banner', acceptLabel: 'banner', rejectLabel: 'banner', preferencesLabel: 'banner',
  privacyPolicyUrl: 'banner', secondaryLinkLabel: 'banner', secondaryLinkUrl: 'banner',
  placement: 'look', appearance: 'look', customCss: 'look', regionMode: 'rules', policyVersion: 'rules',
};

/** The tab whose field a problem names, so Overview can link straight to the fix; null when the
 * fix is not a setting on this page (storage, rendering). */
export function consentProblemTab({ problem }: { problem: ConsentFieldProblem }, _optional = {}): ConsentTabId | null {
  return problem.field === undefined ? null : FIELD_TABS[problem.field] ?? null;
}

const CATEGORY_ORDER = ['necessary', 'functional', 'analytics', 'marketing'];

/** What waits for a visitor's choice, counted per category in the engine's order, then any others.
 * @complexity O(n log k), n <= 200 detected items, k categories. */
export function pausedByCategory({ detected }: { detected: readonly ConsentDetectedItem[] }, _optional = {}): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of detected) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const rank = ({ category }: { category: string }, _optional = {}) => { const index = CATEGORY_ORDER.indexOf(category); return index === -1 ? CATEGORY_ORDER.length : index; };
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => rank({ category: a.category }) - rank({ category: b.category }) || a.category.localeCompare(b.category));
}

export type ConsentSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/** The header's one-line status (an English key; the page translates it). */
export function consentStatusKey({ saveState, hasUnpublished, everPublished }: { saveState: ConsentSaveState; hasUnpublished: boolean; everPublished: boolean }, _optional = {}): string {
  if (saveState === 'conflict') return 'Someone else changed this. Reload to see it.';
  if (saveState === 'saving') return 'Saving…';
  if (saveState === 'error') return "Couldn't save. Your edits are still here.";
  if (hasUnpublished) return 'Draft saved. Not live yet.';
  return everPublished ? 'Live.' : 'Not published yet.';
}

/** Publish only a settled, problem-free draft that differs from what is live. The server re-checks. */
export function canPublishConsent(
  { saveState, settled, hasUnpublished, problems, publishing }: { saveState: ConsentSaveState; settled: boolean; hasUnpublished: boolean; problems: readonly ConsentFieldProblem[]; publishing: boolean },
  _optional = {},
): boolean {
  const draftSaved = saveState === 'saved' || saveState === 'idle';
  const readyDraft = settled && problems.length === 0 && draftSaved;
  return readyDraft && hasUnpublished && !publishing;
}

/** "Reset to default" is offered only while the field differs from the site's default banner style
 * (which the server pre-fills into an empty field and delivers when the field is empty). */
export function canResetConsentCss({ customCss, defaultCss }: { customCss: string | undefined; defaultCss: string | undefined }, _optional = {}): boolean {
  return Boolean(defaultCss) && (customCss ?? '') !== defaultCss;
}
