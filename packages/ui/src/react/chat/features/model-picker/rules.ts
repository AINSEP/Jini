/**
 * @module rules
 *
 * Pure logic for the model-picker feature: grouping models by provider,
 * searching/filtering, and resolving the current selection. No React, no
 * transport, no DOM — ported and generified from OD's
 * `NewProjectPanel.tsx`'s `MediaModelCards` (provider grouping + search) and
 * `modelOptions.tsx`'s `matchesModelSearch`/`isCustomModel` (search matching
 * + custom-value detection). See `source-map.md`.
 */
import { CREDENTIAL_STATUS_SORT_PRIORITY } from './constants.js';
import type { CredentialStatus, ModelOption, ModelPickerGroup, ModelPickerSelection, ModelProvider } from './types.js';

/**
 * Groups models by `providerId`, attaching each group's resolved credential
 * status and sorting configured providers first (stable — ties keep model
 * order). A model whose `providerId` has no matching entry in `providers`
 * gets a synthesized provider (`{ id, label: id }`) rather than being
 * dropped, so an unrecognized provider id still renders instead of silently
 * disappearing.
 */
export function groupModelsByProvider(
  models: readonly ModelOption[],
  providers: readonly ModelProvider[],
  statusByProviderId: Readonly<Record<string, CredentialStatus>>,
): ModelPickerGroup[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider] as const));
  const groupsByProviderId = new Map<string, ModelPickerGroup>();

  for (const model of models) {
    let group = groupsByProviderId.get(model.providerId);
    if (!group) {
      const provider = providerById.get(model.providerId) ?? { id: model.providerId, label: model.providerId };
      const status = statusByProviderId[model.providerId] ?? 'unconfigured';
      group = { provider, status, models: [] };
      groupsByProviderId.set(model.providerId, group);
    }
    group.models.push(model);
  }

  return Array.from(groupsByProviderId.values()).sort(
    (a, b) => CREDENTIAL_STATUS_SORT_PRIORITY[a.status] - CREDENTIAL_STATUS_SORT_PRIORITY[b.status],
  );
}

export function matchesModelQuery(model: ModelOption, provider: ModelProvider, normalizedQuery: string): boolean {
  const haystack = `${model.id}\n${model.label}\n${model.hint ?? ''}\n${provider.label}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

/** Filters each group's models by `query`; drops groups left with zero matches. Returns a shallow copy of every group when `query` is blank. */
export function filterModelGroups(groups: readonly ModelPickerGroup[], query: string): ModelPickerGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return groups.map((group) => ({ ...group, models: group.models.slice() }));
  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => matchesModelQuery(model, group.provider, normalized)),
    }))
    .filter((group) => group.models.length > 0);
}

/** Finds which group (and therefore provider) `modelId` belongs to, or `null` if it isn't in any group. */
export function findSelectedModel(
  groups: readonly ModelPickerGroup[],
  modelId: string | null | undefined,
): ModelPickerSelection | null {
  if (!modelId) return null;
  for (const group of groups) {
    const model = group.models.find((m) => m.id === modelId);
    if (model) return { model, group };
  }
  return null;
}

/** True when `modelId` is set but not present in any group — a free-text/custom value. */
export function isCustomModelId(modelId: string | null | undefined, groups: readonly ModelPickerGroup[]): boolean {
  if (!modelId) return false;
  return findSelectedModel(groups, modelId) === null;
}

/** The first model in the first (highest-priority) group, or `null` if every group is empty. */
export function firstAvailableModelId(groups: readonly ModelPickerGroup[]): string | null {
  return groups[0]?.models[0]?.id ?? null;
}

/**
 * A one-line subtitle for the selected model: its hint, prefixed with the
 * provider label unless the hint already opens with it (avoids
 * "OpenAI · OpenAI · 4K, native multimodal"-style duplication).
 */
export function modelSubtitle(selection: ModelPickerSelection): string {
  const hint = selection.model.hint ?? '';
  const providerLabel = selection.group.provider.label;
  if (!hint) return providerLabel;
  return hint.toLowerCase().startsWith(providerLabel.toLowerCase()) ? hint : `${providerLabel} · ${hint}`;
}
