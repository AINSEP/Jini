/**
 * Pure logic for the generic source-config-list primitive. No React, no
 * transport, no DOM — see `archived UI provenance ledger` for full provenance.
 */
import { isAllowedEndpointUrl } from '../../utils/endpoint-policy.js';
import { pendingActionKey as pendingActionKey_, isActionPending as isActionPending_, withPendingAction as withPendingAction_, withoutPendingAction as withoutPendingAction_ } from '../../utils/pending-actions.js';
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
export function emptySourceDraft({ fieldSpecs }: { fieldSpecs: readonly SourceFieldSpec[] }, _optional: Record<string, never> = {}): SourceFieldValues {
  const draft: SourceFieldValues = {};
  for (const spec of fieldSpecs) draft[spec.key] = '';
  return draft;
}

/** Same endpoint policy the execution and media-provider tabs apply — a
 *  `url`-kind source field is an operator-supplied endpoint like any other, and
 *  a scheme-only check accepted private address space. See
 *  `utils/endpoint-policy.ts`. */
function isValidHttpUrl(value: string): boolean {
  return isAllowedEndpointUrl({ raw: value });
}

/**
 * Validates a draft against its field specs: required-field presence, plus a
 * `url`-kind format check (ported from the origin's shared "must be a valid
 * http(s) URL" rule, seen in both `McpClientSection.tsx`'s `validateRow` and
 * `PluginsView.tsx`'s marketplace-URL add flow). Protocol-specific API-key
 * shape validation (the origin `byok/validation.ts`'s Anthropic/OpenAI/
 * Google key-format detection) is deliberately NOT ported here — see
 * `archived provenance ledger`'s dropped-behavior list; a host that needs it supplies its
 * own extra validation before calling `addSource`.
 *
 * **Applies to the EDIT path as well as the add path.** That was once true only
 * by accident of nobody editing: the sole call site was the add form, and
 * `updateSource` reached the port with raw component state, so a source could
 * be edited into a shape this function would have rejected at creation.
 * `SourceConfigItemCard` now runs it before saving an edit. A host driving
 * `port.updateSource` itself owns the same check — the sentence above about
 * `addSource` was never meant to license an unvalidated `updateSource`, it
 * simply never mentioned it.
 *
 * `message` is an i18n-ready TEMPLATE (`'{label} is required.'`), not a
 * pre-baked English sentence — this module stays hook-free per the i18n
 * policy (no `useT()` here), so the call site wraps it at render time via
 * `t(issue.message, { label: t(spec.label) })`, exactly like every other
 * `{placeholder}`-templated string this package already produces (e.g.
 * `t('Trust level for {name}', { name: label })`).
 */
export function validateSourceDraft(
  { fieldSpecs, values }: { fieldSpecs: readonly SourceFieldSpec[]; values: SourceFieldValues }, _optional: Record<string, never> = {}
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
  { validation, fieldKey }: { validation: SourceDraftValidation; fieldKey: string }, _optional: Record<string, never> = {}
): SourceDraftIssue | undefined {
  return validation.issues.find((issue) => issue.field === fieldKey);
}

/** Stable per-(id, action) key used to track in-flight per-item actions independently, so one card's Refresh doesn't disable another card's Remove. */
export function pendingActionKey({ id, kind }: { id: string; kind: SourceActionKind }, _optional: Record<string, never> = {}): string {
  return pendingActionKey_({ id, kind });
}

export function isActionPending(
  { pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: SourceActionKind }, _optional: Record<string, never> = {}
): boolean {
  return isActionPending_({ pendingKeys, id, kind });
}

export function withPendingAction(
  { pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: SourceActionKind }, _optional: Record<string, never> = {}
): ReadonlySet<string> {
  return withPendingAction_({ pendingKeys, id, kind });
}

export function withoutPendingAction(
  { pendingKeys, id, kind }: { pendingKeys: ReadonlySet<string>; id: string; kind: SourceActionKind }, _optional: Record<string, never> = {}
): ReadonlySet<string> {
  return withoutPendingAction_({ pendingKeys, id, kind });
}

export function upsertSourceById<TSource extends SourceConfigItem>(
  { list, next }: { list: readonly TSource[]; next: TSource }, _optional: Record<string, never> = {}
): TSource[] {
  const index = list.findIndex((source) => source.id === next.id);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function removeSourceById<TSource extends SourceConfigItem>(
  { list, id }: { list: readonly TSource[]; id: string }, _optional: Record<string, never> = {}
): TSource[] {
  return list.filter((source) => source.id !== id);
}

export function updateSourceById<TSource extends SourceConfigItem>(
  { list, id, patch }: { list: readonly TSource[]; id: string; patch: Partial<TSource> }, _optional: Record<string, never> = {}
): TSource[] {
  return list.map((source) => (source.id === id ? { ...source, ...patch } : source));
}

/** One secret masked to its trailing {@link MASKED_VALUE_VISIBLE_SUFFIX_LENGTH} characters, behind
 *  never fewer than {@link MASKED_VALUE_MIN_MASK_LENGTH} mask characters so a short secret does not
 *  leak its own length. */
function maskSecret(value: string): string {
  const visible = value.length > MASKED_VALUE_VISIBLE_SUFFIX_LENGTH ? value.slice(-MASKED_VALUE_VISIBLE_SUFFIX_LENGTH) : '';
  const maskLength = Math.max(MASKED_VALUE_MIN_MASK_LENGTH, value.length - visible.length);
  return MASK_CHAR.repeat(maskLength) + visible;
}

/**
 * Masks a field value for list/summary display.
 *
 * - `password` — the whole value is the secret, so the whole value is masked.
 * - `secret-textarea` — `KEY=VALUE` per line: the KEY is kept (an operator needs
 *   to see WHICH variables are set) and only the VALUE is masked. A line with no
 *   `=` is treated as entirely secret rather than passed through, so a malformed
 *   or reformatted block fails closed.
 * - everything else passes through unchanged.
 *
 * The `secret-textarea` branch exists because an MCP server's `env` block was
 * declared a plain `textarea` and therefore rendered `GITHUB_TOKEN=ghp_live…`
 * verbatim in the always-expandable source card — on a field whose own
 * placeholder advertises that it holds exactly that.
 */
export function maskFieldValue({ kind, value }: { kind: SourceFieldSpec['kind']; value: string }, _optional: Record<string, never> = {}): string {
  if (!value) return value;
  if (kind === 'password') return maskSecret(value);
  if (kind === 'secret-textarea') {
    return value
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const eq = line.indexOf('=');
        // No `=` means this is not the KEY=VALUE shape the mask relies on, so
        // there is no safe "name" half to keep — mask the entire line.
        if (eq <= 0) return maskSecret(line);
        return `${line.slice(0, eq + 1)}${maskSecret(line.slice(eq + 1))}`;
      })
      .join('\n');
  }
  return value;
}

/**
 * Derives a display label for a source card: explicit `label`, else the
 * first field's value (masked, if that field is `password`-kind — a source
 * with no explicit label and a secret as its only field must never leak
 * that secret into the always-visible summary row), else the raw id.
 */
export function sourceDisplayLabel({ source, fieldSpecs }: { source: SourceConfigItem; fieldSpecs: readonly SourceFieldSpec[] }, _optional: Record<string, never> = {}): string {
  const label = source.label?.trim();
  if (label) return label;
  const firstSpec = fieldSpecs[0];
  if (firstSpec) {
    const value = source.fields[firstSpec.key]?.trim();
    if (value) return maskFieldValue({ kind: firstSpec.kind, value });
  }
  return source.id;
}
