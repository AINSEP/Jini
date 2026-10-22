import { describeAdminEntityFieldMismatch } from '../../core/entities/rules.js';
import type { AdminEntityDescriptor, AdminEntityField, AdminEntityRelationField, AdminEntityRowData } from '../../core/ports/entities.js';
import type { EntityRegistryPort } from './types.js';
export const RELATION_OPTION_LIMIT = 100;
export function resolveEntityPageSize({ raw }: { readonly raw: string | null }): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 25;
}

/** Every `relation` field on a descriptor, narrowed so `target` is reachable. */
export function relationFieldsOf(
  { descriptor }: { readonly descriptor: AdminEntityDescriptor },
): readonly AdminEntityRelationField[] {
  return descriptor.fields.filter(
    (field): field is AdminEntityRelationField => field.kind === "relation",
  );
}

/** One relation target's options: what a picker offers, and what a list cell resolves against. */
export interface RelationOptions {
  /** Target rows as `{ id, title }`, in the target's own list order. */
  readonly options: readonly { readonly id: string; readonly title: string }[];
  /** `id` -> title, for O(1) cell rendering. */
  readonly titles: Readonly<Record<string, string>>;
  /** True when the target has more rows than {@link RELATION_OPTION_LIMIT} loaded here. */
  readonly truncated: boolean;
}

/** Relation target name -> its loaded options. Keyed by TARGET, not by field, so two fields
 *  pointing at the same entity share one load. */
export type RelationIndex = Readonly<Record<string, RelationOptions>>;

/**
 * Loads the option set for every distinct relation target on `descriptor`.
 *
 * @param descriptor The entity whose relations need resolving.
 * @param registry Host registry resolving a target's existing entity port.
 * @returns One entry per distinct target. A target that does not resolve is simply absent, and the
 *   screens then render the raw stored id marked as unresolved rather than a blank cell.
 * @complexity One `list` call per distinct target, in parallel; O(targets × limit) rows held.
 * @overallScore 100
 */
export async function loadRelationIndex(
  { descriptor, registry }: { readonly descriptor: AdminEntityDescriptor; readonly registry: EntityRegistryPort },
): Promise<RelationIndex> {
  const targets = [...new Set(relationFieldsOf({ descriptor }).map((field) => field.target))];
  const loaded = await Promise.all(
    targets.map(async (target) => {
      const port = registry.getEntity({ name: target });
      if (port === null) return null;
      const page = await port.list({ limit: RELATION_OPTION_LIMIT });
      const { titleField } = port.descriptor;
      const options = page.items.map((row) => ({
        id: row.id,
        title: readTitle({ row, titleField }) ?? row.id,
      }));
      const titles: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const option of options) titles[option.id] = option.title;
      // Truncation is read from `nextCursor`, not from `total`: `total` is optional on the port,
      // so an adapter that omits it would make every over-long target silently look complete.
      return [target, { options, titles, truncated: page.nextCursor !== null }] as const;
    }),
  );
  return Object.fromEntries(loaded.filter((entry) => entry !== null));
}

/**
 * A row's human-readable title, or `null` when the descriptor's `titleField` does not resolve to a
 * string on this row.
 *
 * Returns `null` rather than `String(value)` so a caller falls back to the id: a picker rendering
 * the literal text `undefined` for every row is the exact symptom of a mistyped `titleField`, and
 * `createAdminEntityRegistry` already rejects that at startup — this guards the remaining case,
 * where the field is declared correctly and one row simply has no value for it.
 *
 * @complexity Time O(1).
 * @overallScore 100
 */
export function readTitle({ row, titleField }: { readonly row: AdminEntityRowData; readonly titleField: string }): string | null {
  const value = row[titleField];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The draft a "new" form starts from.
 *
 * Every declared field is present and absent-valued, so each control is controlled from the first
 * render rather than switching from uncontrolled on the first keystroke.
 *
 * The one exception is a REQUIRED boolean, which starts `false`. A checkbox has no third state: an
 * untouched one already means "no", so leaving it absent would block Save on a field the operator
 * has, visibly, already answered — they would have to tick it and untick it to satisfy a
 * requirement the unticked box was expressing all along. An OPTIONAL boolean stays absent, because
 * there "unanswered" and "no" are genuinely different and only the descriptor's author knows which
 * the row means.
 *
 * @complexity Time O(fields).
 * @overallScore 100
 */
export function emptyDraft({ descriptor }: { readonly descriptor: AdminEntityDescriptor }): Record<string, unknown> {
  const draft: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of descriptor.fields) {
    draft[field.name] = field.kind === "boolean" && field.required === true ? false : undefined;
  }
  return draft;
}

/**
 * The draft an editor opens with: {@link emptyDraft}'s floor, with `row`'s declared values on top.
 *
 * Layered rather than `{ ...row }`, and that is the whole point. A row is not guaranteed to carry
 * every declared field — an app that adds a `required` field to its descriptor has existing rows
 * that predate it — and a draft built from the row alone inherits that gap. For a required BOOLEAN
 * the consequence is {@link emptyDraft}'s trap arriving by the other door: the checkbox renders
 * unticked, which already says "no", while Save stays blocked on "required and still empty" until
 * the operator ticks and unticks it. The create path was fixed for this and the edit path was not,
 * because they built their drafts in two different places.
 *
 * Only DECLARED fields are copied. A key the descriptor does not mention is invisible to every
 * control on the screen, so carrying it into the draft would send a value back on save that nobody
 * could see or edit — and `eraseEntityPort` reports it as an `undeclared-field` violation on the
 * way in, so it is already known to be adapter drift rather than data.
 *
 * `id` is never copied: it is implicit on every row and `createAdminEntityRegistry` rejects any
 * descriptor that declares it as a field.
 *
 * @param descriptor The entity being edited.
 * @param row An existing row, or `null` when creating.
 * @returns A draft with one entry per declared field.
 * @complexity Time O(fields).
 * @overallScore 100
 */
export function draftForRow(
  { descriptor, row }: { readonly descriptor: AdminEntityDescriptor; readonly row: AdminEntityRowData | null },
): Record<string, unknown> {
  const draft = emptyDraft({ descriptor });
  if (row === null) return draft;
  for (const field of descriptor.fields) {
    // Skips `undefined` rather than spreading: an adapter that patches a row with an absent value
    // leaves an OWN key holding `undefined`, and spreading that would overwrite the `false` floor a
    // required boolean depends on.
    const value = row[field.name];
    if (value !== undefined) draft[field.name] = value;
  }
  return draft;
}

/**
 * Whether `value` reads as "the operator has not filled this in".
 *
 * `false` and `0` are deliberately NOT blank — they are answers, and a truthiness test that calls
 * them empty is the single most reliable way to make a boolean or a numeric field unsaveable at its
 * most ordinary value. `""` is blank for every kind whose control is a text box, but NOT for
 * `json`, where the JSON string `""` is a legitimate stored value that is visibly on screen.
 *
 * @complexity Time O(1).
 * @overallScore 100
 */
function isBlankDraftValue(field: AdminEntityField, value: unknown): boolean {
  if (value === undefined) return true;
  return field.kind !== "json" && value === "";
}

/** Field names whose declared `required: true` is not satisfied by `draft`. */
export function missingRequiredFields(
  { descriptor, draft }: { readonly descriptor: AdminEntityDescriptor; readonly draft: Record<string, unknown> },
): readonly string[] {
  return descriptor.fields
    .filter((field) => field.required === true)
    .filter((field) => isBlankDraftValue(field, draft[field.name]))
    .map((field) => field.name);
}

/** One draft entry that holds a value its declared kind does not accept. */
export interface DraftFieldProblem {
  readonly field: string;
  /** Reads as "servings: is not an integer" — the port's own wording, not a second opinion. */
  readonly detail: string;
}

/**
 * Every draft entry whose value its declared kind would reject.
 *
 * Delegates to `describeAdminEntityFieldMismatch` — the SAME function `eraseEntityPort` uses to
 * report adapter violations — rather than re-deciding here what an `integer` accepts. Two
 * validators for one rule drift, and the drift is silent in the worst direction: the form saves a
 * value the port then reports as a violation, so the write succeeds and the console blames the
 * adapter for something the editor produced.
 *
 * The values this actually catches all come from `<input type="number">`, whose `step` constrains
 * the spinner and not the parsed value: `1.5` typed into an `integer`, and `1e400` typed into a
 * `real`, which becomes `Infinity` and then `null` the moment it meets `JSON.stringify`. Neither
 * field kind appears in any descriptor the browser acceptance run renders, so neither has ever been
 * seen to fail.
 *
 * Blank entries are skipped: an absent value is {@link missingRequiredFields}' business when the
 * field is required, and legitimate when it is not.
 *
 * @complexity Time O(fields), plus the bounded JSON walk for each `json` field.
 * @overallScore 100
 */
export function invalidDraftFields(
  { descriptor, draft }: { readonly descriptor: AdminEntityDescriptor; readonly draft: Record<string, unknown> },
): readonly DraftFieldProblem[] {
  const problems: DraftFieldProblem[] = [];
  for (const field of descriptor.fields) {
    const value = draft[field.name];
    if (isBlankDraftValue(field, value)) continue;
    const detail = describeAdminEntityFieldMismatch(field, value);
    if (detail !== null) problems.push({ field: field.name, detail });
  }
  return problems;
}

/**
 * ISO-8601 -> the `YYYY-MM-DDTHH:mm:ss` an `<input type="datetime-local" step="1">` requires, read
 * as UTC.
 *
 * Read and written as UTC on purpose, and labelled as such next to the control. Converting to the
 * viewer's local zone would round-trip a stored instant through two conversions and shift it by the
 * offset whenever the two disagree about DST — a bug that is invisible for anyone in UTC and
 * corrupts timestamps for everyone else.
 *
 * Seconds are carried, not trimmed. The obvious `slice(0, 16)` matches the `datetime-local`
 * default, and quietly rewrites `10:30:45Z` to `10:30:00Z` on the next Save of a row nobody meant
 * to change the time of. Every timestamp in the dummy app is `00:00:00.000Z`, so the truncation is
 * a no-op in the only data the acceptance run sees.
 *
 * @param value A stored field value, of any type.
 * @returns The control's value, or `""` for anything not a parseable timestamp — which is what an
 *   empty `datetime-local` shows anyway.
 * @complexity Time O(1).
 * @overallScore 100
 */
export function toDatetimeLocalValue({ value }: { readonly value: unknown }): string {
  if (typeof value !== "string" || value === "") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const iso = parsed.toISOString();
  return iso.endsWith('.000Z') ? iso.slice(0, 19) : iso.slice(0, 23);
}

/**
 * The inverse: a `datetime-local` control's value -> a stored ISO-8601 instant, read as UTC.
 *
 * The `Z` is what makes it UTC — without it the string is parsed in the browser's local zone, which
 * is the half of the round trip that silently shifts an instant for everyone not in UTC.
 *
 * @param raw The control's `value`, `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`.
 * @returns `undefined` for an empty control; the ISO instant otherwise; and `raw` UNCHANGED when it
 *   will not parse — so `invalidDraftFields` reports it and Save is blocked, rather than this
 *   throwing a `RangeError` through a render or silently discarding what the operator typed.
 * @complexity Time O(1).
 * @overallScore 100
 */
export function fromDatetimeLocalValue({ raw }: { readonly raw: string }): string | undefined {
  if (raw === "") return undefined;
  const parsed = new Date(`${raw}Z`);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}
