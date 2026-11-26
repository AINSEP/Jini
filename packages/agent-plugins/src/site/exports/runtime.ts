/** Admission and member-login host data for the HTML plugin-export port. */
import { escapeHtml } from "@jini-ai/core/text";
import type { PluginExportsPort, PluginExportTemplate } from "@jini-ai/core/contracts/site/widgets-html";
import type { PluginExportCatalogPort, PluginExportCatalogRow } from '@jini-ai/core/contracts/headless/plugin-export-catalog';
import type { LoginProvider } from "@jini-ai/core/contracts/site/user-management-server";
import { checkPluginExportConfig, selectPluginExport, PluginEmbedValidationError, type SelectedPluginExport } from "./diagnostics.js";
import type { PluginEmbedDiagnostic } from "@jini-ai/core/contracts/site/page-html-store";
import { pluginExportFileUrl, type PluginExportPackage, type PluginExportSource } from "./source.js";
import type { DeclaredPageHosts } from "@jini-ai/core/contracts/server/security-headers";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";

export interface PluginExportRenderSession extends PluginExportsPort {
  headHtml(required: Record<string, never>, options?: Record<string, never>): string;
  /** External hosts of the exports this page actually shows, for its content-security policy. */
  declaredHosts(required: Record<string, never>, options?: Record<string, never>): DeclaredPageHosts;
}
export interface PluginExportRuntime extends PluginExportCatalogPort {
  forRender(required: { mode: "live" | "static" }, options?: Record<string, never>): PluginExportRenderSession;
  validateHtml(required: { workspaceId: string; html: string }, options?: Record<string, never>): Promise<readonly PluginEmbedDiagnostic[]>;
  /** Hosts of every enabled export: a static host's header file covers the whole site at once. */
  declaredHosts(required: { workspaceId: string }, options?: Record<string, never>): Promise<DeclaredPageHosts>;
}
interface RuntimeDeps {
  readonly workspaceId: string;
  readonly source: PluginExportSource;
  readonly filesPrefix: string;
  readonly memberLoginStart: (input: { workspaceId: string; providerId: string }) => string;
  readonly markersOfType: (input: { html: string; type: string }) => readonly { config: Readonly<Record<string, unknown>> }[];
  readonly embedMarkerSnippetFromConfig: (input: { config: Readonly<Record<string, unknown>> }) => string;
  readonly listProviders: (input: { workspaceId: string }) => Promise<readonly LoginProvider[]>;
  /** True when the site turned its consent banner off, so declared resources load directly. */
  readonly embedConsentOff?: () => boolean;
}
type HostSets = Record<keyof DeclaredPageHosts, Set<string>>;
const newHostSets = (): HostSets => ({ script: new Set(), frame: new Set(), connect: new Set() });
const hostLists = (sets: HostSets): DeclaredPageHosts => ({ script: [...sets.script], frame: [...sets.frame], connect: [...sets.connect] });
function addHosts(required: { sets: HostSets; definition: AgentPluginExport }, _options = {}): void {
  const declared = required.definition.externalHosts ?? {};
  for (const kind of ["script", "frame", "connect"] as const) for (const origin of declared[kind] ?? []) required.sets[kind].add(origin);
}

/** Each host link must belong to this plugin's ready provider, not merely share a provider id.
 * @complexity O(l*p) declared links and ready providers; provider admission is loaded once per session.
 */
async function publicHost(required: { selected: SelectedPluginExport; deps: RuntimeDeps; providers: Promise<readonly LoginProvider[]> }, _options = {}): Promise<Readonly<Record<string, unknown>> | undefined> {
  const { owner, component, definition } = required.selected;
  const host: Record<string, unknown> = {};
  const links = Object.entries(definition.hostLinks ?? {});
  const providers = links.length ? await required.providers : [];
  for (const [slot, capability] of links) {
    if (!capability.startsWith("member-login:")) return undefined;
    const providerId = capability.slice("member-login:".length);
    if (!providers.some(provider => provider.id === providerId && provider.pluginId === owner.plugin.pluginId)) return undefined;
    host[slot] = required.deps.memberLoginStart({ workspaceId: required.deps.workspaceId, providerId });
  }
  host.assets = Object.fromEntries(Object.entries(definition.assets ?? {}).map(([name, filename]) => [name,
    pluginExportFileUrl({ prefix: required.deps.filesPrefix, pluginId: owner.plugin.pluginId, component, filename })]));
  return host;
}

/** Link only declared, admitted resources. A static fallback still ships its themeable CSS/artwork.
 * @complexity O(a) assets; Map keys deduplicate across repeated occurrences without global state.
 */
function collectHead(required: { selected: SelectedPluginExport; mode: "live" | "static"; head: Map<string, string>; deps: RuntimeDeps }, _options = {}): void {
  const { owner, component, definition } = required.selected;
  const urlFor = ({ filename }: { filename: string }, _optional: Record<string, never> = {}) => escapeHtml({ text: pluginExportFileUrl({ prefix: required.deps.filesPrefix, pluginId: owner.plugin.pluginId, component, filename }) });
  if (definition.styles) required.head.set(`${owner.id}:${definition.styles}`, `<link rel="stylesheet" href="${urlFor({ filename: definition.styles })}">`);
  if (required.mode !== "static") return;
  for (const filename of Object.values(definition.assets ?? {})) {
    const url = urlFor({ filename });
    required.head.set(url, `<link rel="preload" as="image" href="${url}">`);
  }
}

/** Queue declared scripts in manifest order. A consent-gated one stays inert until the consent client
 * activates it; a static copy runs scripts only for a `full` export.
 * @complexity O(s) scripts; Map keys deduplicate across repeated occurrences.
 */
function collectScripts(required: { selected: SelectedPluginExport; mode: "live" | "static"; head: Map<string, string>; consentOff: boolean; deps: RuntimeDeps }, _options = {}): void {
  const { owner, component, definition } = required.selected;
  if (required.mode === "static" && definition.staticExport !== "full") return;
  const held = definition.consent !== "necessary" && !required.consentOff;
  for (const script of definition.scripts ?? []) {
    const url = escapeHtml({ text: script.startsWith("https://") ? script : pluginExportFileUrl({ prefix: required.deps.filesPrefix, pluginId: owner.plugin.pluginId, component, filename: script }) });
    required.head.set(`script:${url}`, held
      ? `<script type="text/plain" data-consent-category="${definition.consent}" data-src="${url}"></script>`
      : `<script src="${url}" defer></script>`);
  }
}

/** Resolve one occurrence; CMS alone fills/validates HTML and stamps its preserved wrapper.
 * @complexity O(p + e + props) catalog selection and schema check, plus one contained template read.
 */
async function resolveExport(required: {
  config: Readonly<Record<string, unknown>>; deps: RuntimeDeps; packages: Promise<readonly PluginExportPackage[]>;
  providers: Promise<readonly LoginProvider[]>; mode: "live" | "static"; head: Map<string, string>; hosts: HostSets;
}, _options = {}): Promise<PluginExportTemplate | undefined> {
  const selection = selectPluginExport({ packages: await required.packages, config: required.config });
  if (!("selected" in selection)) return undefined;
  const { selected } = selection;
  if (checkPluginExportConfig({ selected, config: required.config })) return undefined;
  collectHead({ selected, mode: required.mode, head: required.head, deps: required.deps });
  if (required.mode === "static" && selected.definition.staticExport === "fallback-only") return undefined;
  const host = await publicHost({ selected, deps: required.deps, providers: required.providers });
  if (!host) return undefined;
  const consentOff = required.deps.embedConsentOff?.() === true;
  collectScripts({ selected, mode: required.mode, head: required.head, consentOff, deps: required.deps });
  addHosts({ sets: required.hosts, definition: selected.definition });
  return exportTemplate({ selected, config: required.config, deps: required.deps, host, consentOff });
}

/** The CMS-side template for one resolved occurrence: its contract fields, template file and props.
 * @complexity O(1) plus one contained template read.
 */
async function exportTemplate(required: {
  selected: SelectedPluginExport; config: Readonly<Record<string, unknown>>; deps: RuntimeDeps; host: Readonly<Record<string, unknown>>; consentOff: boolean;
}, _options = {}): Promise<PluginExportTemplate> {
  const { selected, consentOff, host } = required;
  return { plugin: selected.owner.id, component: selected.component, version: selected.definition.version,
    minVersion: selected.definition.minVersion, consent: selected.definition.consent, consentOff,
    frameHosts: selected.definition.externalHosts?.frame ?? [], scriptData: (selected.definition.scripts?.length ?? 0) > 0,
    template: await required.deps.source.readFile({ plugin: selected.owner.plugin, filename: selected.definition.template }),
    props: (required.config.props === undefined ? {} : required.config.props) as Readonly<Record<string, unknown>>, host };
}

/** Validate known enabled contracts before the single HTML writer mutates anything. Unknown,
 * disabled and unsupported contracts remain savable with safe editor warnings. O(markers + schemas).
 */
async function validateHtml(required: { input: { workspaceId: string; html: string }; deps: RuntimeDeps }, _options = {}): Promise<readonly PluginEmbedDiagnostic[]> {
  if (required.input.workspaceId !== required.deps.workspaceId) throw new PluginEmbedValidationError({ message: "Plugin embed workspace does not match this site." });
  const markers = required.deps.markersOfType({ html: required.input.html, type: "plugin" });
  if (!markers.length) return [];
  const packages = await required.deps.source.list({ workspaceId: required.input.workspaceId }).catch(() => []);
  const providers = required.deps.listProviders({ workspaceId: required.input.workspaceId }).catch(() => []);
  const warnings: PluginEmbedDiagnostic[] = [];
  for (const marker of markers) {
    const diagnostic = await editorDiagnostic({ packages, config: marker.config, deps: required.deps, providers });
    if (diagnostic?.code === "PLUGIN_EMBED_INVALID_PROPS") throw new PluginEmbedValidationError({ message: diagnostic.message });
    if (diagnostic) warnings.push(diagnostic);
  }
  return warnings;
}

/** The same safe refusal reasons drive editor warnings; provider readiness never opens secrets. */
async function editorDiagnostic(required: { packages: readonly PluginExportPackage[]; config: Readonly<Record<string, unknown>>; deps: RuntimeDeps; providers: Promise<readonly LoginProvider[]> }, _options = {}): Promise<PluginEmbedDiagnostic | undefined> {
  const selection = selectPluginExport(required);
  if ("diagnostic" in selection) return selection.diagnostic;
  const diagnostic = checkPluginExportConfig({ selected: selection.selected, config: required.config });
  if (diagnostic) return diagnostic;
  const host = await publicHost({ selected: selection.selected, deps: required.deps, providers: required.providers });
  return host ? undefined : { code: "PLUGIN_HOST_UNAVAILABLE", message: "Plugin sign-in is not configured or unavailable; visitors see your fallback." };
}

/** Catalog rows expose contracts and snippets, never templates, secrets or local file paths.
 * O(exports * providers), no extra file reads per row beyond the shared catalog load.
 */
async function catalogRows(required: { packages: readonly PluginExportPackage[]; deps: RuntimeDeps }, _options = {}): Promise<ReadonlyMap<string, readonly PluginExportCatalogRow[]>> {
  const rows = new Map<string, readonly PluginExportCatalogRow[]>();
  const providers = required.deps.listProviders({ workspaceId: required.deps.workspaceId }).catch(() => []);
  for (const owner of required.packages) {
    const exports: PluginExportCatalogRow[] = [];
    for (const [component, definition] of Object.entries(owner.exports)) {
      const config = { type: "plugin", plugin: owner.id, component, version: definition.version, props: {} };
      const selection = selectPluginExport({ packages: required.packages, config });
      const selected = { owner, component, definition };
      const availability = await catalogAvailability({ selection, selected, config, providers, deps: required.deps });
      exports.push({ plugin: owner.id, ...(owner.displayName ? { displayName: owner.displayName } : {}), component, version: definition.version, minVersion: definition.minVersion ?? 1, props: definition.props,
        consent: definition.consent, availability, snippet: availability === "ready" ? required.deps.embedMarkerSnippetFromConfig({ config }) : null });
    }
    rows.set(owner.plugin.pluginId, exports);
  }
  return rows;
}

/** Distinguish props that the author must fill from host readiness; fixed public diagnostics. */
async function catalogAvailability(required: {
  selection: ReturnType<typeof selectPluginExport>; selected: SelectedPluginExport; config: Readonly<Record<string, unknown>>;
  providers: Promise<readonly LoginProvider[]>; deps: RuntimeDeps;
}, _options = {}): Promise<string> {
  if ("diagnostic" in required.selection) return required.selection.diagnostic.code;
  if (!await publicHost(required)) return "host-unavailable";
  return checkPluginExportConfig({ selected: required.selected, config: required.config }) ? "props-required" : "ready";
}

/** Bind to one site. Request-local memoization shares catalog/readiness across occurrences; a new
 * request observes plugin toggles. Static full/link-only exports use the same template.
 * @complexity O(1) construction; work is deferred to the bounded CMS occurrence pass.
 */
export function createPluginExportRuntime(required: RuntimeDeps, _options = {}): PluginExportRuntime {
  return {
    forRender: ({ mode }, _options = {}) => {
      let packages: Promise<readonly PluginExportPackage[]> | undefined;
      let providers: Promise<readonly LoginProvider[]> | undefined;
      const head = new Map<string, string>();
      const hosts = newHostSets();
      return {
        resolve: async ({ config, workspaceId }, _options = {}) => {
          if (workspaceId !== required.workspaceId) return undefined;
          packages ??= required.source.list({ workspaceId });
          // Readiness failures are a public fallback, never an unhandled rejected lazy promise.
          providers ??= required.listProviders({ workspaceId }).catch(() => []);
          return resolveExport({ config, deps: required, packages, providers, mode, head, hosts });
        },
        headHtml: (_input, _options = {}) => [...head.values()].join("\n"),
        declaredHosts: (_input, _options = {}) => hostLists(hosts),
      };
    },
    validateHtml: (input, _options = {}) => validateHtml({ input, deps: required }),
    declaredHosts: async ({ workspaceId }, _options = {}) => {
      const sets = newHostSets();
      if (workspaceId !== required.workspaceId) return hostLists(sets);
      for (const owner of await required.source.list({ workspaceId })) {
        if (owner.enabled) for (const definition of Object.values(owner.exports)) addHosts({ sets, definition });
      }
      return hostLists(sets);
    },
    catalog: async ({ workspaceId }, _options = {}) => workspaceId === required.workspaceId
      ? catalogRows({ packages: await required.source.list({ workspaceId }), deps: required }) : new Map(),
  };
}
