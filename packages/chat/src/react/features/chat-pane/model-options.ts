import type { I18nAdapter } from '../../slots.js';
import type { ChatPaneAgent, ChatPaneAgentOption } from './types.js';

// Model names and timestamps are metadata; only surrounding picker copy is translated.
const passthrough: I18nAdapter['t'] = key => key;

export function isConcretePickerModel(id: string): boolean {
  const token = id.slice(id.lastIndexOf('/') + 1);
  return !/^(?:opus|sonnet|haiku|fable|best|latest|claude|gemini|gpt|codex|swe)(?:\[.*\])?$/i.test(token) && !/^(default|auto|adaptive|smart|deep|rush|ultimate|premium|balanced|fast|grok-build|vercel-ai-gateway)$/i.test(token) && !/(?:^|[-/])(gateway|latest)$/i.test(id);
}
/** Aliases are selectable only as their evidence-backed concrete ID. Never render a Default row.
 * @complexity O(n) time and space in catalog rows, with set-based deduplication.
 */
export function pickerModelOptions(agent: ChatPaneAgent): ChatPaneAgentOption[] {
  if (agent.supportsConcreteModelSelection === false) return [];
  const seen = new Set<string>();
  const options = (agent.models || []).flatMap((row) => {
    const id = row.resolvedId || (row.identityKind === 'routing-mode' || row.identityKind === 'alias' ? undefined : row.id);
    if (!id || !isConcretePickerModel(id) || seen.has(id)) return [];
    seen.add(id);
    // Older cached inventories can attach a default-policy label to a resolved concrete ID.
    const label = row.id === 'default' || /^default\b/i.test(row.label) ? id : row.label;
    return [{ ...row, id, label, identityKind: 'concrete' as const }];
  });
  const resolution = agent.defaultModelResolution;
  // A host may publish a resolved default outside its visible catalog. Preserve its concrete ID.
  if (resolution?.status === 'resolved' && isConcretePickerModel(resolution.id) && !seen.has(resolution.id)) options.unshift({ id: resolution.id, label: resolution.id, identityKind: 'concrete' });
  return options;
}
export function configuredPickerModel(agent: ChatPaneAgent): string | undefined {
  if (agent.supportsConcreteModelSelection === false) return undefined;
  const resolution = agent.defaultModelResolution;
  return resolution?.status === 'resolved' && isConcretePickerModel(resolution.id) ? resolution.id : undefined;
}
export function pickerModelLabel(agent: ChatPaneAgent | undefined, requested?: string, t: I18nAdapter['t'] = passthrough): string {
  if (!agent) return t('Choose model');
  const id = !requested || requested === 'default' ? configuredPickerModel(agent) : requested;
  if (!id || !isConcretePickerModel(id)) return t('Choose model');
  return pickerModelOptions(agent).find((row) => row.id === id)?.label || id;
}
export function pickerModelValue(agent: ChatPaneAgent, requested?: string): string {
  const id = requested && requested !== 'default' ? requested : configuredPickerModel(agent);
  return id && pickerModelOptions(agent).some((row) => row.id === id) ? id : '';
}
export function pickerCatalogNote(agent: ChatPaneAgent, t: I18nAdapter['t'] = passthrough): string | undefined {
  const catalog = agent.modelCatalog;
  if (catalog?.freshness === 'stale') return `${t('Cached')} · ${catalog.fetchedAt}`;
  if (catalog?.freshness === 'offline-fallback' || !catalog && agent.models) return t('Offline fallback');
  return undefined;
}
