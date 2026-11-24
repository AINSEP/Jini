import { findCapabilityInputError, type CapabilityDef } from '@jini-ai/core/contracts/capabilities';
import { normalizeAgentLabel } from './guards.js';
import { findPublishedPageElement, pageActionPublishedForTarget, type PagePublication } from './page-publication.js';

/** A page-tool call is acceptable only as a plain object that passes the capability's own input
 * contract AND addresses an element the server published for that action class. Pure; used by a
 * host's untrusted-caller executor before anything runs.
 * @complexity O(e) in published elements plus the schema check. */
export function acceptsPublishedPageInput({ capability, input, publication }: { capability: CapabilityDef; input: unknown; publication: PagePublication }, _options = {}): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const args = input as Record<string, unknown>;
  if (findCapabilityInputError({ capability, input: args })) return false;
  return pageActionPublishedForTarget({ capabilityId: capability.id, element: findPublishedPageElement({ input: args, publication }) });
}

/** One page a host lists as an addressable navigation target. */
export interface PageTargetCandidate { readonly id: string; readonly label: string }

/** Bound discovery metadata without limiting direct navigation to an already-known public id: the
 * resolved navigation target (when any) leads, the rest follow, capped at `limit`, and every label
 * is normalized before it reaches a page that may hand it to a model.
 * @complexity O(p) in listed pages. */
export function summarizePageTargets({ pages }: { pages: readonly PageTargetCandidate[] },
  { navigation, limit = 128 }: { navigation?: PageTargetCandidate | undefined; limit?: number } = {}): readonly { id: string; label: string }[] {
  const candidates = navigation ? [navigation, ...pages.filter(page => page.id !== navigation.id)] : pages;
  return candidates.slice(0, limit).map(page => ({ id: page.id, label: normalizeAgentLabel({ raw: page.label }).text }));
}
