/** The one reviewed layout table: every agent plugin `@jini-ai/agent-plugins` ships as a subpath.
 * A host imports `@jini-ai/agent-plugins/<name>` (its `plugin.json`) or `@jini-ai/agent-plugins/<name>/*`.
 * The isolation gate, the catalog generator and the legacy assembler read these rows, so adding an
 * agent plugin edits this table and the package's exports/files, nothing else.
 * Build-time tooling only; nothing here is published or imported by a host.
 */

/** One agent plugin, published as the `<name>/` folder and `./<name>` subpath of the agent-plugins package. */
export interface AgentPluginPackageRow {
  /** Local plugin name: the manifest `name`, its source folder name and its subpath. */
  readonly name: string;
  /** Source folder relative to the repository root (always `packages/agent-plugins/<name>`). */
  readonly sourceDir: string;
}

/** The package that ships every agent plugin, and its workspace folder. */
export const AGENT_PLUGINS_PACKAGE = '@jini-ai/agent-plugins';
export const AGENT_PLUGINS_ROOT = 'packages/agent-plugins';

const localName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sourceRoot = `${AGENT_PLUGINS_ROOT}/`;
// Plugin folders share the package root with the library, so its own folders can never be plugin names.
const reservedNames = new Set(['plugins', 'node_modules', 'src', 'dist', 'core', 'docs', 'coverage']);
// Never published: the package's `files` carries `!**/__tests__/**`; the rest mirror npm's own ignores.
const unpublishedSegments = new Set(['__tests__', 'node_modules', '.git', '.DS_Store', 'coverage', 'dist', '.cache']);

/** Import name of a row: `@jini-ai/agent-plugins/<name>`. */
export function agentPluginSubpath(row: AgentPluginPackageRow): string {
  return `${AGENT_PLUGINS_PACKAGE}/${row.name}`;
}

/** The two exports a row needs: the bare subpath names the manifest; the wildcard reaches only its own folder. */
export function agentPluginExports(row: AgentPluginPackageRow): Record<string, string> {
  return { [`./${row.name}`]: `./${row.name}/plugin.json`, [`./${row.name}/*`]: `./${row.name}/*` };
}

/** Whether a file path relative to a plugin folder is part of the published payload.
 * Tests, dependency trees, build caches and compiled-test artefacts stay in the checkout.
 * @complexity O(d) for d path segments. */
export function isPublishedAgentPluginFile(required: { path: string }, _optional: Record<string, never> = {}): boolean {
  const path = required.path.replaceAll('\\', '/');
  if (path.split('/').some(segment => unpublishedSegments.has(segment))) return false;
  return !/\.(?:test|spec)\.[^/]*$/.test(path) && !path.endsWith('.tsbuildinfo');
}

function assertRow(row: AgentPluginPackageRow): void {
  if (!localName.test(row.name) || reservedNames.has(row.name)) throw new TypeError(`Invalid agent plugin name: ${row.name}`);
  // The source sits directly under the agent-plugins root: the published folder is the source folder.
  if (row.sourceDir !== `${sourceRoot}${row.name}`) throw new TypeError(`Agent plugin ${row.name} must live in ${sourceRoot}${row.name}`);
}

/** Validate and freeze layout rows; every reader goes through this.
 * @throws TypeError for a malformed row or a name claimed twice (two plugins would share one subpath).
 * @complexity O(n) for n rows. */
export function defineAgentPluginPackages(
  required: { rows: readonly AgentPluginPackageRow[] },
  _optional: Record<string, never> = {},
): readonly AgentPluginPackageRow[] {
  const names = new Set<string>();
  for (const row of required.rows) {
    assertRow(row);
    if (names.has(row.name)) throw new TypeError(`Agent plugin listed twice: ${row.name}`);
    names.add(row.name);
  }
  return Object.freeze(required.rows.map(row => Object.freeze({ ...row })));
}

const sourceRow = (name: string): AgentPluginPackageRow => ({ name, sourceDir: `${sourceRoot}${name}` });

/** Reviewed rows, in name order. INT is the only editor; a row lands with its complete source folder
 * and its exports/files entries in packages/agent-plugins/package.json. */
export const agentPluginPackages = defineAgentPluginPackages({ rows: [
  'charts-echarts', 'charts-recharts', 'cloudflare', 'composio', 'fly', 'github', 'github-pages', 'google-login',
  'google-workspace', 'higgsfield-media', 'jev', 'meilisearch', 'netlify', 'opentelemetry', 'posthog', 'railway',
  'render', 'resend', 's3-compatible', 'sentry', 'shopify', 'site-compliance', 'site-import', 'slide-design', 'supabase',
  'ui-ux-design', 'vercel', 'wordpress',
].map(sourceRow) });

/** Published before subpaths existed (0.6.17) and still built from the same source folder until the
 * owner deprecates it in favour of `@jini-ai/agent-plugins/<name>`. Never add a row here. */
export const legacyAgentPluginPackages: Readonly<Record<string, string>> = Object.freeze({
  'ui-ux-design': '@jini-ai/plugin-ui-ux-design',
});
