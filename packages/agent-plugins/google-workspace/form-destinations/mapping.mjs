/**
 * @file Column mapping for the Google Sheets form destination: which column each form field is
 * written to, which new columns a delivery adds, and the row of RAW values one submission becomes.
 *
 * Exists so a spreadsheet's columns never silently change meaning. Fields are identified by their
 * stable field id (`name`); the label is only the header text. The first time the plugin writes a field
 * to a column it tags that column with a developer-metadata marker (`tovu_form_field` = field id,
 * attached to the column itself). From then on the marker decides the column: a label edited in
 * the form, a header renamed in the sheet, or columns inserted or moved before it do not move the
 * field's data (Google moves column metadata with its column). Why a marker in the sheet and not
 * the binding: the delivery adapter cannot write the host's binding, and a marker needs no state
 * outside the spreadsheet it describes; unlike a header note, people do not see or edit it.
 * An untagged field is matched by its label in row 1 (and tagged), else added as a new column at
 * the end. A tab that should have the plugin's columns but lacks them, a header found twice, a field
 * tagged on two columns, or two entries landing on one column is a mapping error the person
 * repairs; nothing is appended into a sheet whose columns cannot be matched. The visitor's IP is
 * never a field, and answers that are not fields of the frozen form are never written.
 */
import { DeliveryRefusal } from './delivery-result.mjs';

// These names keep their `tovu` prefix: deliveries have already written them into people's
// spreadsheets, and a renamed header or marker key would no longer match those columns.
export const SUBMISSION_ID_HEADER = '_tovu_submission_id';
export const SUBMITTED_AT_HEADER = '_tovu_submitted_at';
/** Developer-metadata key tagging a column with the form field id it holds. */
export const FIELD_MARKER_KEY = 'tovu_form_field';

const mappingInvalid = () => new DeliveryRefusal({ code: 'mapping-invalid', retryable: false });

/** One answer as a RAW cell: a checkbox group is joined with ", "; scalars keep their type. @complexity O(items). */
export function cellValue(required, _optional = {}) {
  const { value } = required;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  return typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
}

/**
 * The mapping for one job: the two plugin columns, then one entry per field of the frozen form.
 * @param {{ form: { fields: readonly { name: string, label?: string }[] } }} required
 * @returns {{ header: string, field?: string, source?: 'id' | 'submittedAt' }[]}
 * @throws {DeliveryRefusal} `mapping-invalid` when two entries would share a header.
 * @complexity O(fields).
 */
export function buildMapping(required, _optional = {}) {
  const entries = [
    { header: SUBMISSION_ID_HEADER, source: 'id' },
    { header: SUBMITTED_AT_HEADER, source: 'submittedAt' },
    // Trimmed like the sheet's cells are, so stray spaces never decide a match; a blank label falls back to the id.
    ...required.form.fields.map((field) => ({ field: field.name, header: String(field.label ?? '').trim() || field.name })),
  ];
  if (new Set(entries.map((entry) => entry.header)).size !== entries.length) throw mappingInvalid();
  return entries;
}

/** Whether a dimension range is exactly one column of this tab. @complexity O(1). */
const isOneColumnOf = (range, sheetId) => range?.sheetId === sheetId && range.dimension === 'COLUMNS' && range.endIndex - range.startIndex === 1;

/** One column marker as `{ field, index }`; anything not exactly one column of this tab is ignored. @complexity O(1). */
function columnMarker(metadata, sheetId) {
  const range = metadata?.location?.dimensionRange;
  const isMarker = metadata?.metadataKey === FIELD_MARKER_KEY && typeof metadata.metadataValue === 'string';
  return isMarker && isOneColumnOf(range, sheetId) ? { field: metadata.metadataValue, index: range.startIndex } : undefined;
}

/**
 * Field id → the columns tagged with it, from a `developerMetadata:search` answer.
 * @param {{ matches: readonly unknown[], sheetId: number }} required `matchedDeveloperMetadata`.
 * @returns {Map<string, number[]>}
 * @complexity O(matches).
 */
export function readMarkers(required, _optional = {}) {
  const markers = new Map();
  for (const match of required.matches) {
    const marker = columnMarker(match?.developerMetadata, required.sheetId);
    if (marker) markers.set(marker.field, [...(markers.get(marker.field) ?? []), marker.index]);
  }
  return markers;
}

const headerText = (cell) => String(cell ?? '').trim();

/** Untagged columns of row 1 whose header is `header`. @complexity O(width). */
function headerPositions(plan, header) {
  return plan.headerRow.flatMap((cell, index) => (headerText(cell) === header && !plan.tagged.has(index) ? [index] : []));
}

/** A new column at the end, headed `header`. @complexity O(1). */
function addColumn(plan, header) {
  const index = plan.width;
  plan.width += 1;
  plan.newHeaders.push({ index, header });
  return index;
}

/** A plugin column (`_tovu_*` header): found once by its fixed header, or new on a fresh tab. @complexity O(width). */
function tovuColumn(plan, entry) {
  const positions = headerPositions(plan, entry.header);
  if (positions.length === 1) return positions[0];
  if (positions.length > 1 || !plan.fresh) throw mappingInvalid();
  return addColumn(plan, entry.header);
}

/** A field's column: its marker, else its header found once, else a new column; untagged ones get tagged. @complexity O(width). */
function fieldColumn(plan, entry, taggedAt) {
  if (taggedAt.length > 1) throw mappingInvalid();
  if (taggedAt.length === 1) return taggedAt[0];
  const positions = headerPositions(plan, entry.header);
  if (positions.length > 1) throw mappingInvalid();
  const index = positions.length === 1 ? positions[0] : addColumn(plan, entry.header);
  plan.untagged.push({ field: entry.field, index });
  return index;
}

/**
 * Where each mapping entry is written. An empty first row is a fresh tab. The plugin's two columns are
 * found by their fixed headers (refused when missing from a tab that is not fresh); each field by
 * its marker, else by its label (see the file comment).
 * @param {{ mapping: readonly { header: string, field?: string, source?: string }[], headerRow: readonly unknown[], markers: ReadonlyMap<string, readonly number[]> }} required
 * @returns {{ columns: number[], newHeaders: { index: number, header: string }[], untagged: { field: string, index: number }[], width: number }}
 *   `newHeaders` are contiguous at the end; `untagged` are the field columns to tag.
 * @throws {DeliveryRefusal} `mapping-invalid` for a duplicated, missing or conflicting column.
 * @complexity O(entries * width).
 */
export function planColumns(required, _optional = {}) {
  const { mapping, markers } = required;
  const fresh = required.headerRow.every((cell) => headerText(cell) === '');
  const tagged = new Set([...markers.values()].flat());
  const headerRow = fresh ? [] : required.headerRow;
  const plan = { fresh, tagged, headerRow, width: Math.max(headerRow.length, ...[...tagged].map((index) => index + 1)), newHeaders: [], untagged: [] };
  const columns = mapping.map((entry) => (entry.source ? tovuColumn(plan, entry) : fieldColumn(plan, entry, markers.get(entry.field) ?? [])));
  if (new Set(columns).size !== columns.length) throw mappingInvalid();
  return { columns, newHeaders: plan.newHeaders, untagged: plan.untagged, width: plan.width };
}

/**
 * The appended row: each mapped value at its column, blanks elsewhere (columns of removed fields
 * or someone else's columns stay empty for this row).
 * @param {{ mapping: readonly { field?: string, source?: 'id' | 'submittedAt' }[], columns: readonly number[], width: number, submission: { id: string, submittedAt: string, answers: Readonly<Record<string, unknown>> } }} required
 * @complexity O(width + entries).
 */
export function buildRow(required, _optional = {}) {
  const { mapping, columns, submission } = required;
  const row = Array.from({ length: required.width }, () => '');
  const valueFor = (entry) => {
    if (entry.source) return submission[entry.source];
    // Own keys only: a field id such as `constructor` must not read the prototype.
    return cellValue({ value: Object.hasOwn(submission.answers, entry.field) ? submission.answers[entry.field] : undefined });
  };
  mapping.forEach((entry, index) => { row[columns[index]] = valueFor(entry); });
  return row;
}
