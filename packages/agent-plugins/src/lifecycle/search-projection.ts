/** Compact model-facing discovery; ranking and complete metadata remain with their existing owners. */
import type { AgentPluginSearchCandidate } from './search.js';

export interface AgentPluginDiscoveryMatch {
  readonly id: string;
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly maturity?: string;
  readonly description: string;
}
export interface AgentPluginDiscoveryPage {
  readonly matches: readonly AgentPluginDiscoveryMatch[];
  readonly totalInstalled: number;
  readonly totalMatches: number;
  readonly nextOffset: number | null;
}

/** Retain a short, valid UTF-8 description; encoding work is bounded even for huge source prose. */
function shortDescription({ text }: { text: string }, _options = {}): string {
  const bytes = Buffer.from(text.slice(0, 240));
  if (bytes.length <= 240) return text.slice(0, 240);
  let end = 240;
  while ((bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** Project one candidate without copying skills, keywords, credentials or host metadata. O(1). */
function discoveryMatch({ candidate }: { candidate: AgentPluginSearchCandidate & { readonly maturity?: string } }, _options = {}): AgentPluginDiscoveryMatch {
  return { id: candidate.id ?? candidate.pluginId, pluginId: candidate.pluginId, enabled: candidate.enabled,
    ...(candidate.maturity ? { maturity: candidate.maturity } : {}),
    description: shortDescription({ text: candidate.description ?? candidate.summary ?? '' }) };
}

/** Reject windows/budgets that could produce an invalid or non-advancing page. O(1). */
function assertPageBounds({ maxBytes, offset, limit }: { maxBytes: number; offset: number; limit: number }, _options = {}): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new RangeError('maxBytes must be a safe integer of at least 1024');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('offset must be a non-negative safe integer');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('limit must be an integer of 1..50');
}

/** Page an already ordered catalog, bounding the complete serialized result, including JSON escaping.
 * @param required Ranked/listed candidates, a validated count window and the installed catalog size.
 * @param options Optional byte budget (at least 1024); defaults to 8 KiB.
 * @returns Compact matches with a cursor into the original order; no candidate is skipped.
 * @throws RangeError for invalid bounds or an identity too large to fit a single-row page.
 * @complexity O(l²) serialization for l <= 50 rows; O(maxBytes) retained output. No I/O.
 * @example projectAgentPluginSearchPage({ candidates, offset: 0, limit: 10, totalInstalled: candidates.length });
 */
export function projectAgentPluginSearchPage(
  { candidates, offset, limit, totalInstalled }: { candidates: readonly (AgentPluginSearchCandidate & { readonly maturity?: string })[]; offset: number; limit: number; totalInstalled: number },
  { maxBytes = 8 * 1024 }: { maxBytes?: number } = {},
): AgentPluginDiscoveryPage {
  assertPageBounds({ maxBytes, offset, limit });
  const matches: AgentPluginDiscoveryMatch[] = [];
  // Lets a zero-`matches` response distinguish "nothing is installed at all" from "N plugins
  // are installed but none matched this query" — the model needs that distinction to decide
  // whether to suggest installing something new versus rephrasing the search.
  const page = (): AgentPluginDiscoveryPage => ({ matches, totalInstalled, totalMatches: candidates.length,
    nextOffset: offset + matches.length < candidates.length ? offset + matches.length : null });
  for (const candidate of candidates.slice(offset, offset + limit)) {
    matches.push(discoveryMatch({ candidate }));
    if (Buffer.byteLength(JSON.stringify(page())) <= maxBytes) continue;
    matches.pop();
    if (!matches.length) throw new RangeError('Plugin identity exceeds the discovery page byte budget');
    break;
  }
  return page();
}
