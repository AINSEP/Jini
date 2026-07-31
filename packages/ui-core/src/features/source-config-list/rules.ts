/**
 * Pure logic for the generic source-config-list primitive. No React, no
 * transport, no DOM — see `packages/ui/source-map.md` for full provenance.
 */
import { MASK_CHAR, MASKED_VALUE_MIN_MASK_LENGTH, MASKED_VALUE_VISIBLE_SUFFIX_LENGTH } from './constants.js';
import type {
  SourceActionKind,
  SourceConfigItem,
  SourceDraftIssue,
  SourceDraftValidation,
  SourceFieldSpec,
  SourceFieldValues,
} from './types.js';

/** Builds an all-empty draft matching a field-spec list, used to seed (and reset) the add-source form. */
export function emptySourceDraft(fieldSpecs: readonly SourceFieldSpec[]): SourceFieldValues {
  const draft: SourceFieldValues = {};
  for (const spec of fieldSpecs) draft[spec.key] = '';
  return draft;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a draft against its field specs: required-field presence, plus a
 * `url`-kind format check (ported from the origin's shared "must be a valid
 * http(s) URL" rule, seen in both `McpClientSection.tsx`'s `validateRow` and
 * `PluginsView.tsx`'s marketplace-URL add flow). Protocol-specific API-key
 * shape validation (the origin `byok/validation.ts`'s Anthropic/OpenAI/
 * Google key-format detection) is deliberately NOT ported here — see
 * `source-map.md`'s dropped-behavior list; a host that needs it supplies its
 * own extra validation before calling `addSource`.
 *
 * `message` is an i18n-ready TEMPLATE (`'{label} is required.'`), not a
 * pre-baked English sentence — this module stays hook-free per the i18n
 * policy (no `useT()` here), so the call site wraps it at render time via
 * `t(issue.message, { label: t(spec.label) })`, exactly like every other
 * `{placeholder}`-templated string this package already produces (e.g.
 * `t('Trust level for {name}', { name: label })`).
 */
export function validateSourceDraft(
  fieldSpecs: readonly SourceFieldSpec[],
  values: SourceFieldValues,
): SourceDraftValidation {
  const issues: SourceDraftIssue[] = [];
  for (const spec of fieldSpecs) {
    const raw = values[spec.key] ?? '';
    const trimmed = raw.trim();
    if (spec.required && !trimmed) {
      issues.push({ field: spec.key, message: '{label} is required.' });
      continue;
    }
    if (spec.kind === 'url' && trimmed && !isValidHttpUrl(trimmed)) {
      issues.push({ field: spec.key, message: '{label} must be a valid http:// or https:// URL.' });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function issueForField(
  validation: SourceDraftValidation,
  fieldKey: string,
): SourceDraftIssue | undefined {
  return validation.issues.find((issue) => issue.field === fieldKey);
}

/** Stable per-(id, action) key used to track in-flight per-item actions independently, so one card's Refresh doesn't disable another card's Remove. */
export function pendingActionKey(id: string, kind: SourceActionKind): string {
  return `${kind}:${id}`;
}

export function isActionPending(
  pendingKeys: ReadonlySet<string>,
  id: string,
  kind: SourceActionKind,
): boolean {
  return pendingKeys.has(pendingActionKey(id, kind));
}

export function withPendingAction(
  pendingKeys: ReadonlySet<string>,
  id: string,
  kind: SourceActionKind,
): ReadonlySet<string> {
  const next = new Set(pendingKeys);
  next.add(pendingActionKey(id, kind));
  return next;
}

export function withoutPendingAction(
  pendingKeys: ReadonlySet<string>,
  id: string,
  kind: SourceActionKind,
): ReadonlySet<string> {
  if (!pendingKeys.has(pendingActionKey(id, kind))) return pendingKeys;
  const next = new Set(pendingKeys);
  next.delete(pendingActionKey(id, kind));
  return next;
}

export function upsertSourceById<TSource extends SourceConfigItem>(
  list: readonly TSource[],
  next: TSource,
): TSource[] {
  const index = list.findIndex((source) => source.id === next.id);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function removeSourceById<TSource extends SourceConfigItem>(
  list: readonly TSource[],
  id: string,
): TSource[] {
  return list.filter((source) => source.id !== id);
}

export function updateSourceById<TSource extends SourceConfigItem>(
  list: readonly TSource[],
  id: string,
  patch: Partial<TSource>,
): TSource[] {
  return list.map((source) => (source.id === id ? { ...source, ...patch } : source));
}

/**
 * Masks a field value for list/summary display. `password`-kind fields show
 * only their trailing {@link MASKED_VALUE_VISIBLE_SUFFIX_LENGTH} characters
 * behind a run of mask characters (never fewer than
 * {@link MASKED_VALUE_MIN_MASK_LENGTH}, so a very short secret doesn't leak
 * its own length); every other kind passes through unchanged.
 */
export function maskFieldValue(kind: SourceFieldSpec['kind'], value: string): string {
  if (kind !== 'password' || !value) return value;
  const visible = value.length > MASKED_VALUE_VISIBLE_SUFFIX_LENGTH ? value.slice(-MASKED_VALUE_VISIBLE_SUFFIX_LENGTH) : '';
  const maskLength = Math.max(MASKED_VALUE_MIN_MASK_LENGTH, value.length - visible.length);
  return MASK_CHAR.repeat(maskLength) + visible;
}

/**
 * Derives a display label for a source card: explicit `label`, else the
 * first field's value (masked, if that field is `password`-kind — a source
 * with no explicit label and a secret as its only field must never leak
 * that secret into the always-visible summary row), else the raw id.
 */
export function sourceDisplayLabel(source: SourceConfigItem, fieldSpecs: readonly SourceFieldSpec[]): string {
  const label = source.label?.trim();
  if (label) return label;
  const firstSpec = fieldSpecs[0];
  if (firstSpec) {
    const value = source.fields[firstSpec.key]?.trim();
    if (value) return maskFieldValue(firstSpec.kind, value);
  }
  return source.id;
}
