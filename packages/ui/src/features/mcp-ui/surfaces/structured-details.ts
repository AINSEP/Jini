/** Shared value presentation for confirmation, form and outcome details. Never interprets HTML. */
import { escapeHtml } from '../escape.js';

/** One fact. Values and previous snapshots must be JSON-serializable; strings remain supported. */
export interface SurfaceDetail {
  readonly label: string;
  readonly value: unknown;
  /** Presence enables a diff, including an explicitly absent previous override. */
  readonly previous?: unknown;
  /** Explicit, optionally translated labels keyed by dotted object path. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Optional secondary context beneath the label, using the shared muted hint style. */
  readonly description?: string;
  /**
   * `code` discloses a monospace `<pre>` that keeps line breaks and scrolls inside its own box
   * past a fixed height, so long SQL or JSON remains readable without stretching the dialog past
   * its frame. `status` reserves one line for a short outcome value. Omitted (or `text`) permits
   * value-sensitive presentation, preserving plain inline strings for short prose.
   */
  readonly format?: 'text' | 'code' | 'status';
}

type ValueContext = { value: unknown; path: string; labels: Readonly<Record<string, string>>; format?: SurfaceDetail['format'] };
type DiffContext = ValueContext & { previous: unknown };

/** Native details owns keyboard interaction; mirror its state for explicit ARIA consumers. */
export const DETAIL_DISCLOSURE_SCRIPT = `document.addEventListener("toggle", function (event) {
  var disclosure = event.target;
  if (!disclosure.matches || !disclosure.matches("details.mcpui-detail-disclosure")) return;
  disclosure.querySelector("summary").setAttribute("aria-expanded", disclosure.open ? "true" : "false");
}, true);`;

/** Humanized English fallback; caller labels remain verbatim. @complexity O(k) key length. */
export function surfaceDetailLabel({ key, path, labels }: { key: string; path: string; labels: ValueContext['labels'] }, _options = {}): string {
  if (Object.hasOwn(labels, path)) return labels[path]!;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  const acronyms = words.replace(/\b(url|css|html|json|api|id)\b/g, word => word.toUpperCase());
  return acronyms.charAt(0).toUpperCase() + acronyms.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function disclosure({ summary, body, kind = '' }: { summary: string; body: string; kind?: string }, _options = {}): string {
  return `<details class="mcpui-detail-disclosure ${kind}"><summary aria-expanded="false">${escapeHtml(summary)}</summary>${body}</details>`;
}

/** JSON scalar display; missing override values use the same empty marker as null. */
function scalarText({ value }: { value: unknown }, _options = {}): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  return String(value);
}

/** Classifies content for a disclosure, preserving the original text bytes in the body. */
function codeKind({ value, path, format }: { value: string; path: string; format?: SurfaceDetail['format'] }, _options = {}): string | undefined {
  if (/css$/i.test(path) || (/\{[^}]*:[^}]*\}/.test(value) && !/^\s*[\[{]/.test(value))) return 'CSS';
  if (/^\s*</.test(value)) return 'HTML';
  if (/^\s*[\[{]/.test(value)) return 'JSON';
  if (format === 'code') return 'Code';
  return /[\r\n]/.test(value) ? 'Text' : undefined;
}

/** Escapes all text once at the HTML sink. Long prose uses a three-line summary. */
function renderText({ value, path, format }: { value: string; path: string; format?: SurfaceDetail['format'] }, _options = {}): string {
  const text = escapeHtml(value);
  const kind = codeKind({ value, path, format });
  if (kind) {
    const lines = value.split(/\r\n|\r|\n/).length;
    return disclosure({ summary: `${kind} · ${lines} ${lines === 1 ? 'line' : 'lines'}`, body: `<pre class="mcpui-code">${text}</pre>`, kind: 'mcpui-detail-code' });
  }
  if (value.length <= 80) return text;
  return `<details class="mcpui-detail-disclosure mcpui-detail-long"><summary aria-expanded="false"><span class="mcpui-detail-preview">${text}</span><span class="mcpui-detail-more">Show more</span><span class="mcpui-detail-less">Show less</span></summary><div class="mcpui-detail-full">${text}</div></details>`;
}

/** Arrays keep scalar items compact; nested or long items use readable bullet rows. */
function renderArray({ value, ...context }: ValueContext & { value: readonly unknown[] }, _options = {}): string {
  if (value.length === 0) return '<span class="mcpui-detail-value">—</span>';
  const compact = value.every(item => item === null || ['boolean', 'number', 'string'].includes(typeof item))
    && value.every(item => String(item).length <= 80 && !/[\r\n<{[]/.test(String(item)));
  if (compact) return renderText({ ...context, value: value.map(item => scalarText({ value: item })).join(', ') });
  const items = value.map((item, index) => {
    const path = context.path ? `${context.path}.${index}` : String(index);
    return `<li>${renderValue({ ...context, value: item, path })}</li>`;
  });
  const rest = items.length <= 5 ? '' : disclosure({ summary: `Show more (${items.length - 5} items)`, body: `<ul class="mcpui-detail-array">${items.slice(5).join('')}</ul>` });
  return `<ul class="mcpui-detail-array">${items.slice(0, 5).join('')}</ul>${rest}`;
}

function objectRow({ key, context, body }: { key: string; context: ValueContext; body: string }, _options = {}): string {
  return `<div class="mcpui-detail-row"><dt>${escapeHtml(surfaceDetailLabel({ key, path: context.path, labels: context.labels }))}</dt><dd>${body}</dd></div>`;
}

/** Nested objects stay definition lists, indented once per actual group. @complexity O(n) rendered bytes. */
function renderObject({ value, ...context }: ValueContext & { value: Record<string, unknown> }, _options = {}): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '<span class="mcpui-detail-value">—</span>';
  const rows = entries.map(([key, item]) => {
    const child = { ...context, value: item, path: context.path ? `${context.path}.${key}` : key };
    return objectRow({ key, context: child, body: renderValue(child) });
  }).join('');
  return `<dl class="mcpui-detail-group">${rows}</dl>`;
}

/** Pure recursive rendering, O(n) in output bytes and O(depth) traversal stack; no external I/O. */
function renderValue(context: ValueContext, _options = {}): string {
  const { value } = context;
  if (Array.isArray(value)) return renderArray({ ...context, value });
  if (isRecord(value)) return renderObject({ ...context, value });
  if (typeof value === 'string' && value !== '') return renderText({ ...context, value });
  return escapeHtml(scalarText({ value }));
}

/** Object order is immaterial; array order and missing keys matter to an approval diff. */
function equalValue({ before, after }: { before: unknown; after: unknown }, _options = {}): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((item, index) => equalValue({ before: item, after: after[index] }));
  }
  if (!isRecord(before) || !isRecord(after)) return false;
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length && keys.every(key => Object.hasOwn(after, key) && equalValue({ before: before[key], after: after[key] }));
}

/** A missing JSON key must never read an inherited property such as __proto__ or constructor. */
function ownValue({ record, key }: { record: Record<string, unknown>; key: string }, _options = {}): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Presence needs its own label: null and missing otherwise both display an empty marker. */
function renderFieldDiff({ child, previous, value, key }: {
  child: DiffContext; previous: Record<string, unknown>; value: Record<string, unknown>; key: string;
}, _options = {}): string {
  const body = renderDiff(child);
  if (Object.hasOwn(previous, key) && Object.hasOwn(value, key)) return body;
  const label = Object.hasOwn(value, key) ? 'Added' : 'Removed';
  return `<span class="mcpui-hint">${label}</span>${body}`;
}

/** Partition by equality before rendering so unchanged fields never crowd out changes.
 * @complexity O(n * depth) worst-case nested comparison work; O(n) markup space. No reads or mutation. */
function renderObjectDiff(context: DiffContext & { previous: Record<string, unknown>; value: Record<string, unknown> }, _options = {}): string {
  const { previous, value } = context;
  const keys = [...new Set([...Object.keys(value), ...Object.keys(previous)])];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const key of keys) {
    const child = { ...context, previous: ownValue({ record: previous, key }), value: ownValue({ record: value, key }), path: context.path ? `${context.path}.${key}` : key };
    const same = Object.hasOwn(previous, key) === Object.hasOwn(value, key) && equalValue({ before: child.previous, after: child.value });
    const body = same ? renderValue(child) : renderFieldDiff({ child, previous, value, key });
    (same ? unchanged : changed).push(objectRow({ key, context: child, body }));
  }
  const rest = unchanged.length === 0 ? '' : disclosure({ summary: `Unchanged fields (${unchanged.length})`, body: `<dl class="mcpui-detail-group">${unchanged.join('')}</dl>`, kind: 'mcpui-detail-unchanged' });
  const changes = changed.length === 0 ? '' : `<dl class="mcpui-detail-group">${changed.join('')}</dl>`;
  return changes + rest || '<span class="mcpui-detail-value">—</span>';
}

/** Recurse only through object pairs; atomic and array updates show explicit before/after values. */
function renderDiff(context: DiffContext, _options = {}): string {
  if (isRecord(context.previous) && isRecord(context.value)) return renderObjectDiff({ ...context, previous: context.previous, value: context.value });
  return `<div class="mcpui-detail-change"><div><span class="mcpui-hint">Before</span>${renderValue({ ...context, value: context.previous })}</div><div><span class="mcpui-hint">After</span>${renderValue(context)}</div></div>`;
}

/** One reusable detail body. Raw JSON is escaped text, never a script or HTML fragment.
 * @returns HTML for JSON-compatible caller data; JSON.stringify errors propagate for invalid data.
 * @complexity O(n * depth) with a previous snapshot, otherwise O(n), in serialized bytes. */
export function renderStructuredDetail({ detail }: { detail: SurfaceDetail }, _options = {}): string {
  const context: ValueContext = { value: detail.value, path: '', labels: detail.labels ?? {}, format: detail.format };
  const hasPrevious = Object.hasOwn(detail, 'previous');
  const body = hasPrevious ? renderDiff({ ...context, previous: detail.previous }) : renderValue(context);
  const raw = hasPrevious ? { previous: detail.previous, value: detail.value } : detail.value;
  const showRaw = hasPrevious || (typeof detail.value === 'object' && detail.value !== null) || body.startsWith('<details ');
  if (!showRaw) return body;
  return body + disclosure({ summary: 'View raw', body: `<pre class="mcpui-code">${escapeHtml(JSON.stringify(raw, null, 2))}</pre>`, kind: 'mcpui-detail-raw' });
}
