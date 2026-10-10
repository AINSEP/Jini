import type { GuidePointer, GuideTopic, GuideWorkflow } from './types.js';

/** Native shape guards keep the core barrel usable without the optional A2UI/Zod peer. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum = 8_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
function keys(value: Record<string, unknown>, permitted: readonly string[]): boolean {
  return Object.keys(value).every(key => permitted.includes(key));
}
function list<T>(value: unknown, maximum: number, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= maximum && value.every(guard);
}
function permission(value: unknown): value is string { return text(value, 128); }
function permissions(value: unknown): value is string[] { return list(value, 32, permission); }
function step(value: unknown): value is string { return text(value); }
/** Accept document/admin/HTTPS pointers, never script URLs or arbitrary local files. */
function href(value: unknown): value is string {
  return text(value, 512) && (value.startsWith('/admin/') || value.startsWith('development/') || value.startsWith('https://'));
}
function pointer(value: unknown): value is GuidePointer {
  if (!record(value) || !keys(value, ['label', 'tool', 'href', 'permissions'])) return false;
  if (!text(value.label) || !permissions(value.permissions)) return false;
  if (value.tool !== undefined && !text(value.tool, 128)) return false;
  if (value.href !== undefined && !href(value.href)) return false;
  return value.tool !== undefined || value.href !== undefined;
}
function workflow(value: unknown): value is GuideWorkflow {
  if (!record(value) || !keys(value, ['title', 'steps', 'permissions'])) return false;
  return text(value.title) && permissions(value.permissions) && list(value.steps, 16, step) && value.steps.length > 0;
}
function topic(value: unknown): value is GuideTopic {
  if (!record(value) || !keys(value, ['id', 'title', 'summary', 'explanation', 'permissions', 'pointers', 'workflows'])) return false;
  if (!text(value.id, 64) || !/^[a-z][a-z0-9-]*$/.test(value.id)) return false;
  return text(value.title, 128) && text(value.summary, 1_000) && text(value.explanation) && permissions(value.permissions)
    && list(value.pointers, 24, pointer) && list(value.workflows, 16, workflow);
}

/** Parse bounded data-only enrichment. Invalid fields and duplicate ids refuse the whole file.
 * @returns Validated topics or a fixed, data-free diagnostic; never quotes plugin bytes.
 * @complexity O(n) characters, capped at 256 KiB of UTF-8, plus bounded shape traversal.
 * @example parseGuideTopics({ raw: '{"version":1,"topics":[]}' });
 */
export function parseGuideTopics({ raw }: { readonly raw: string }, _options: Record<string, never> = {}):
  { readonly ok: true; readonly descriptors: readonly GuideTopic[] } | { readonly ok: false; readonly reason: string } {
  if (raw.length > 262_144 || new TextEncoder().encode(raw).byteLength > 262_144) return { ok: false, reason: 'site-guide manifest exceeds 256 KiB' };
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return { ok: false, reason: 'site-guide manifest must be valid JSON' }; }
  if (!record(value) || !keys(value, ['version', 'topics']) || value.version !== 1 || !list(value.topics, 64, topic)) {
    return { ok: false, reason: 'site-guide manifest does not match version 1 topic schema' };
  }
  const ids = new Set(value.topics.map(item => item.id));
  if (ids.size !== value.topics.length) return { ok: false, reason: 'site-guide manifest contains duplicate topic ids' };
  return { ok: true, descriptors: value.topics };
}
