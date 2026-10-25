import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtml } from '@jini-ai/core/text';
import { CONSENT_CATEGORIES, type ConsentCategory } from '../../consent/types.js';
import type { PageHtmlEmbedRef } from './html-embeds.js';
import type { WidgetRenderIR } from '../types.js';
import {
  parseMarkerAttributes, withInnerContentAndAttributes, withInnerContentFinal,
  type EmbedMarker,
} from '../markers/marker.js';
import { validateServerWidgetFragment } from './server-fragment.js';

/** Host-prepared, admitted export. The host owns enablement, aliases, schema validation,
 * static-export policy, contained file reads, and public host-link readiness. No secrets belong here.
 * `props` must be the schema-validated marker props; `host` contains only declared public values.
 */
export interface PluginExportTemplate {
  readonly plugin: string;
  readonly component: string;
  readonly version: number;
  readonly minVersion?: number;
  readonly consent: ConsentCategory;
  readonly template: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly host?: Readonly<Record<string, unknown>>;
}

/** CMS knows no plugin lifecycle. Unavailable, invalid, or unsupported exports return undefined.
 * Diagnostics are host-owned and must only be exposed to an authenticated editor audience.
 */
export interface PluginExportsPort {
  resolve(required: { config: Readonly<Record<string, unknown>>; workspaceId: string }, optional?: Record<string, never>): Promise<PluginExportTemplate | undefined>;
}

/** Structured substitution result: canonical attribution travels with the validated HTML.
 * Pass the plugin-export IR's props to substituteHtmlEmbeds, rather than reducing it to a string.
 */
export interface PluginExportRender {
  readonly html: string;
  readonly plugin: string;
  readonly component: string;
  readonly version: number;
  readonly consent: ConsentCategory;
}

const SLOT = /{{\s*(props|host)\.([a-zA-Z0-9_.-]+)\s*}}/g;
const URL_ATTRIBUTES = new Set(['href', 'src', 'action']);
const STAMPS = new Set(['data-plugin', 'data-component', 'data-embed-v', 'data-consent-category']);

/** Resolve own properties only: template names cannot reach prototypes through page JSON.
 * Missing/non-scalar slots refuse the whole export instead of leaking template text.
 */
function slotValue({ source, path }: { source: Readonly<Record<string, unknown>>; path: string }, _optional: Record<string, never> = {}): string {
  let value: unknown = source;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('unknown plugin export slot');
    value = (value as Record<string, unknown>)[key];
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('non-scalar plugin export slot');
  return String(value);
}

/** Host links/assets stay on this origin; props cannot introduce URLs in v1. */
function assertLocalUrl({ value }: { value: string }, _optional: Record<string, never> = {}): void {
  if (!value.startsWith('/') || value.startsWith('//') || /[\u0000-\u0020\\]/.test(value)) throw new Error('plugin export URL must be a local path');
}

/** Interpolate once into a decoded text/attribute value; URL sinks admit only host-owned paths. */
function fillSlotText(
  { text, definition, url = false }: { text: string; definition: PluginExportTemplate; url?: boolean },
  _optional: Record<string, never> = {},
): string {
  // A single replace pass prevents a prop containing {{host.secret}} becoming another slot.
  if (/{{|}}/.test(text.replace(SLOT, ''))) throw new Error('unsupported plugin export slot');
  const output = text.replace(SLOT, (_match, scope: 'props' | 'host', path: string) => {
    if (url && scope === 'props') throw new Error('plugin export URL props are unsupported');
    return slotValue({ source: definition[scope] ?? {}, path });
  });
  if (url) assertLocalUrl({ value: output });
  return output;
}

/** Parse5 serializes decoded text/attribute values in their proper HTML contexts. Attribute source
 * locations enforce the quoted-slot contract that a parsed tree alone would otherwise forget.
 */
function fillElement(
  { node, definition }: { node: DefaultTreeAdapterMap['element']; definition: PluginExportTemplate },
  _optional: Record<string, never> = {},
): void {
  for (const attr of node.attrs) {
    const source = node.sourceCodeLocation?.attrs?.[attr.name];
    const authored = source ? definition.template.slice(source.startOffset, source.endOffset) : '';
    if (attr.value.includes('{{') && !/^[^=]+=\s*["']/.test(authored)) throw new Error('plugin export slots require quoted attributes');
    attr.value = fillSlotText({ text: attr.value, definition, url: URL_ATTRIBUTES.has(attr.name) });
  }
  for (const child of node.childNodes) fillNode({ node: child, definition });
}

/** Mutate only the freshly parsed tree; text slots stay data when serialized. Comments are inert. */
function fillNode(
  { node, definition }: { node: DefaultTreeAdapterMap['childNode']; definition: PluginExportTemplate },
  _optional: Record<string, never> = {},
): void {
  if ('tagName' in node) return fillElement({ node, definition });
  if (node.nodeName === '#comment' && /{{|}}/.test((node as DefaultTreeAdapterMap['commentNode']).data)) throw new Error('plugin export slots cannot appear in comments');
  if (node.nodeName === '#text') {
    const text = node as DefaultTreeAdapterMap['textNode'];
    text.value = fillSlotText({ text: text.value, definition });
  }
}

/** Fill scalar props/host slots in text or quoted attributes, then use the single fragment-policy
 * owner. Throws on invalid slots, markup or URLs. No scripts, style, editing handles or recursion.
 * @complexity O(n + s*d), template length n, slot count s, property-path depth d; existing fragment
 * byte cap bounds input and output. No I/O.
 */
export function fillPluginExportTemplate(
  { definition }: { definition: PluginExportTemplate },
  _optional: Record<string, never> = {},
): string {
  // Reuse the policy owner's cap before parsing as well as after interpolation.
  validateServerWidgetFragment({ html: definition.template });
  const root = parseFragment(definition.template, { sourceCodeLocationInfo: true });
  for (const node of root.childNodes) fillNode({ node, definition });
  return validateServerWidgetFragment({ html: serialize(root) });
}

/** Marker versions default to 1. Admission/range refusal is fallback, never a page failure. */
function renderExport(
  { config, definition }: { config: Readonly<Record<string, unknown>>; definition: PluginExportTemplate },
  _optional: Record<string, never> = {},
): PluginExportRender | undefined {
  const version = config.version === undefined ? 1 : config.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
  if (version < (definition.minVersion ?? 1) || version > definition.version) return undefined;
  if (!CONSENT_CATEGORIES.includes(definition.consent)) return undefined;
  return { html: fillPluginExportTemplate({ definition }), plugin: definition.plugin, component: definition.component, version, consent: definition.consent };
}

/** Resolve capped occurrences independently. The host port is site-scoped and validates marker props;
 * failures are isolated to one occurrence, retaining its fallback in the substitution stage.
 * @complexity O(k) port calls for the already capped k refs, plus template filling. No global state.
 */
export async function resolvePluginExportEmbeds(
  { refs, port, workspaceId }: { refs: readonly PageHtmlEmbedRef[]; port?: PluginExportsPort | undefined; workspaceId: string },
  _optional: Record<string, never> = {},
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const results = new Map<string, WidgetRenderIR>();
  if (!port) return results;
  for (const ref of refs) {
    if (!ref.id || !ref.config) continue;
    try {
      const definition = await port.resolve({ config: ref.config, workspaceId });
      const rendered = definition && renderExport({ config: ref.config, definition });
      if (rendered) results.set(ref.id, { componentId: 'plugin-export', props: { ...rendered } });
    } catch {
      // Host lookup, schema failures and invalid fragments must never take the page down.
    }
  }
  return results;
}

/** Plugin markers always retain the author wrapper. Only structured, validated output may stamp
 * canonical identity/consent; a missing result keeps authored fallback and removes the marker.
 */
export function substitutePluginExport(
  { marker, resolved }: { marker: EmbedMarker; resolved: string | PluginExportRender | undefined },
  _optional: Record<string, never> = {},
): string {
  if (!resolved || typeof resolved === 'string') return withInnerContentFinal({ marker, inner: marker.inner });
  const attrs = parseMarkerAttributes({ marker }).filter(attr => !STAMPS.has(attr.name));
  const values = [resolved.plugin, resolved.component, String(resolved.version), resolved.consent];
  const stamps = [...STAMPS].map((name, index) => ({ name, value: escapeHtml({ text: values[index]! }) }));
  return withInnerContentAndAttributes({ marker, attrs: [...attrs, ...stamps], inner: resolved.html });
}
