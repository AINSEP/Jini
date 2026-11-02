/** The one reviewed layout table: which `@jini-ai/plugin-*` package ships each agent plugin payload.
 * The assembler, the catalog generator and the isolation check all read these rows, so adding an
 * agent plugin (or joining a face to its provider package) edits this table and nothing else.
 * Build-time tooling only; nothing here is published or imported by a host.
 */

/** One agent plugin payload. The payload is published under `<name>/` inside its package. */
export interface AgentPluginPackageRow {
  /** Local plugin name: the manifest `name`, its source folder name and its payload folder. */
  readonly name: string;
  /** Source folder relative to the repository root. */
  readonly sourceDir: string;
  /** Package suffix after `@jini-ai/plugin-`; omitted when the package is named after the plugin.
   * A combined package (provider plus its agent face) names the provider id here. */
  readonly packageId?: string;
}

const localName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sourceRoot = 'packages/agent-plugins/';
// Payload roots that would shadow a provider payload or package metadata are reserved.
const reservedNames = new Set(['plugins', 'node_modules', 'src', 'dist']);

/** Package suffix that ships this row. */
export function agentPluginPackageId(row: AgentPluginPackageRow): string {
  return row.packageId ?? row.name;
}

/** npm name of the package that ships this row. */
export function agentPluginPackageName(row: AgentPluginPackageRow): string {
  return `@jini-ai/plugin-${agentPluginPackageId(row)}`;
}

/** Workspace folder of that package, relative to the repository root. */
export function agentPluginPackageRoot(row: AgentPluginPackageRow): string {
  return `packages/plugin-${agentPluginPackageId(row)}`;
}

function assertRow(row: AgentPluginPackageRow): void {
  if (!localName.test(row.name) || reservedNames.has(row.name)) throw new TypeError(`Invalid agent plugin name: ${row.name}`);
  if (row.packageId !== undefined && !localName.test(row.packageId)) throw new TypeError(`Invalid package id for ${row.name}: ${row.packageId}`);
  // The source sits directly under the agent-plugins root, so the content check and package scans agree.
  if (row.sourceDir !== `${sourceRoot}${row.name}`) throw new TypeError(`Agent plugin ${row.name} must live in ${sourceRoot}${row.name}`);
}

/** Validate and freeze layout rows; every reader goes through this.
 * @throws TypeError for a malformed row or a payload name claimed twice (it would collapse two payloads).
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

/** Rows shipped by one package, in table order. */
export function agentPluginRowsForPackage(
  required: { packageId: string },
  optional: { rows?: readonly AgentPluginPackageRow[] } = {},
): AgentPluginPackageRow[] {
  return (optional.rows ?? agentPluginPackages).filter(row => agentPluginPackageId(row) === required.packageId);
}

/** Reviewed rows. INT is the only editor; a row lands in the same commit as its complete source and package. */
export const agentPluginPackages = defineAgentPluginPackages({ rows: [
  { name: 'slide-design', sourceDir: 'packages/agent-plugins/slide-design' },
  { name: 'ui-ux-design', sourceDir: 'packages/agent-plugins/ui-ux-design' },
] });
