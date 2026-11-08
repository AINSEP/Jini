import { parsePluginCredentialCards } from '../lifecycle/credential-card-metadata.js';
import type { PluginContributionDefinition } from '../lifecycle/contribution-loader.js';
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";

// Declaration parsing stays here; the host binds trusted contributions and mail-card precedence.
export { parsePluginCredentialCards, parseCredentialCardUsedFor } from '../lifecycle/credential-card-metadata.js';

/** Reuse Jini's active, trusted-package gate and contained manifest read. */
export const credentialCardsContribution: PluginContributionDefinition<PluginCredentialCard, PluginCredentialCard> = {
  filename: 'plugin.json', contribution: 'credential cards', kind: 'data',
  parse: input => parsePluginCredentialCards(input), load: ({ descriptor, plugin }) => ({ ...descriptor, pluginId: plugin.pluginId }),
};

/** Preserve mail objects and ordering; duplicate targets retain mail priority, while conflicting
 * API label owners are all refused. O(cards) time and space; no persistent ownership registry.
 */
export function mergePluginCredentialCards({ mailCards, manifestCards }: { mailCards: readonly PluginCredentialCard[]; manifestCards: readonly PluginCredentialCard[] }, options: { onRefusal?: (message: string) => void } = {}): readonly PluginCredentialCard[] {
  const cards = [...mailCards, ...manifestCards];
  const conflictingLabels = conflictingApiLabels({ cards });
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.providerId, (counts.get(card.providerId) ?? 0) + 1);
  const accepted = manifestCards.filter(card => {
    if (counts.get(card.providerId) === 1) return true;
    (options.onRefusal ?? console.warn)(`duplicate plugin credential card target '${card.providerId}' was refused`);
    return false;
  });
  return [...mailCards, ...accepted].filter(card => {
    if (!isApiCard({ value: card }) || !conflictingLabels.has(card.label)) return true;
    (options.onRefusal ?? console.warn)(`duplicate API credential label '${card.label}' from '${card.pluginId ?? card.providerId}' was refused`);
    return false;
  });
}

/** Compare effective API labels, including descriptor-backed mail cards, before discarding targets.
 * Distinct cards of one plugin may share its row; two plugins cannot. O(cards) time and space.
 */
function conflictingApiLabels({ cards }: { cards: readonly PluginCredentialCard[] }, _options = {}): ReadonlySet<string> {
  const owners = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const card of cards) {
    if (!isApiCard({ value: card })) continue;
    const owner = card.pluginId ?? card.providerId;
    if (owners.has(card.label) && owners.get(card.label) !== owner) conflicts.add(card.label);
    owners.set(card.label, owner);
  }
  return conflicts;
}

/** Missing saveKind retains the original API-card contract. */
function isApiCard({ value }: { value: { saveKind?: unknown } }, _options = {}): boolean { return value.saveKind === undefined || value.saveKind === "api"; }
