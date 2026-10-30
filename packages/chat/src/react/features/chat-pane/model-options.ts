import { concreteModelOptions, modelIdentityKind } from '@jini-ai/agent-runtime/model-selection';
import type { I18nAdapter } from '../../slots.js';
import type { ChatPaneAgent, ChatPaneAgentOption } from './types.js';

// Model names and timestamps are metadata; only surrounding picker copy is translated.
const passthrough: I18nAdapter['t'] = key => key;

export function isConcretePickerModel(id: string): boolean {
  return modelIdentityKind(id) === 'concrete';
}
/** Aliases are selectable only as their evidence-backed concrete ID. Never render a Default row.
 * Keeps the first position per concrete ID, upgrading raw-ID labels from later human labels.
 * Legacy Default labels are rewritten to the ID before deduplication, never used as human labels.
 * @returns Distinct concrete picker rows without changing the source catalog. No side effects or errors.
 * @complexity O(n) time and space in catalog rows, using insertion-ordered Map keys.
 */
export function pickerModelOptions(agent: ChatPaneAgent): ChatPaneAgentOption[] {
  return concreteModelOptions(agent);
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

// The vendor word each CLI's own icon already shows beside the bar label (owner 2026-10-18).
// Agents not listed keep every word: a Cursor icon says nothing about whether a model is GPT.
const BAR_VENDOR_WORDS: Readonly<Record<string, readonly string[]>> = {
  claude: ['claude', 'anthropic'],
  codex: ['gpt', 'openai'],
  antigravity: ['gemini', 'google'],
};
// A bare catalog id ("claude-opus-5-5", "gpt-6-astra[1m]", "anthropic/claude-sonnet-5") rather than a display name.
const RAW_MODEL_ID = /^(?:[a-z0-9._-]+\/)*[a-z0-9][a-z0-9._-]*(?:\[[^\]]*\])?$/;
const BRAND_CASING: Readonly<Record<string, string>> = { gpt: 'GPT' };

function prettifyRawModelId(id: string): string[] {
  // A routing prefix ("anthropic/") is the full name's job; the bar names only the model.
  // The caller proved RAW_MODEL_ID, so the first '[' can only start its trailing context suffix.
  const tokens = id.slice(id.lastIndexOf('/') + 1).split('[', 1)[0]!.split(/[-_]+/).filter((token) => token && !/^\d{8}$/.test(token));
  const words: string[] = [];
  for (const token of tokens) {
    const previous = words[words.length - 1];
    // Dash-separated version digits read as one dotted version: "5-5" → "5.5".
    if (/^\d+$/.test(token) && previous && /^\d+(?:\.\d+)*$/.test(previous)) words[words.length - 1] = `${previous}.${token}`;
    else words.push(BRAND_CASING[token] ?? token.charAt(0).toUpperCase() + token.slice(1));
  }
  return words;
}

/**
 * The composer bar's compact model name: the catalog label (or a prettified raw id when the catalog
 * has no label), minus the leading vendor word the agent's icon already conveys, capped with "…".
 * The full label stays in the drop-up list and the trigger's tooltip.
 * @example shortModelLabel({ label: 'GPT-6.1-Sol', agentId: 'codex' }) // "6.1 Sol"
 * @example shortModelLabel({ label: 'claude-opus-5-5', agentId: 'claude' }) // "Opus 5.5"
 * @complexity O(n) in the label length. Pure.
 */
export function shortModelLabel({ label, agentId }: { label: string; agentId?: string | undefined }, { max = 16 }: { max?: number } = {}): string {
  const trimmed = label.trim();
  const raw = RAW_MODEL_ID.test(trimmed);
  const words = raw ? prettifyRawModelId(trimmed) : trimmed.split(/[\s-]+/).filter(Boolean);
  const vendors = (agentId && BAR_VENDOR_WORDS[agentId]) || [];
  const dropVendor = words.length > 1 && vendors.includes(words[0]!.toLowerCase());
  // A display name with no vendor word to drop is shown as the catalog wrote it.
  const normalized = raw ? words.join(' ') : trimmed;
  const short = dropVendor ? words.slice(1).join(' ') : normalized;
  return short.length > max ? `${short.slice(0, max - 1).trimEnd()}…` : short;
}
