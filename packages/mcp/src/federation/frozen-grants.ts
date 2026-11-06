/** Owner grant changes reuse the connection's original untrusted tool snapshot (R5). */
import { createToolRegistrationScope, type ToolRegistry, type ToolRegistration } from '@jini-ai/core';
import type { ResolvedFederatedConnection } from './config.js';
import type { McpSessionPort, RemoteToolDescriptor, FederatedMcpConnectionConfig, FederatedConnectionOrigin } from './ports.js';
import type { FederatedAdmissionReport } from './trust.js';
import { buildFederatedMcpRegistrations, type FederationDeps } from './registrations.js';

interface FrozenConnection {
  readonly session: McpSessionPort;
  readonly config: FederatedMcpConnectionConfig;
  readonly tools: readonly RemoteToolDescriptor[];
  readonly deps: FederationDeps;
  readonly buildRegistrations: typeof buildFederatedMcpRegistrations;
  readonly scope: ReturnType<typeof createToolRegistrationScope>;
  ids: ReadonlySet<string>;
  grantsKey: string;
  visible: boolean;
}
const connectionsByRegistry = new WeakMap<ToolRegistry, Map<string, FrozenConnection>>();

/** Read only the original connection listing for the exact admitted source identity.
 * Unavailable or replaced sources return null; querying never connects or lists remote tools.
 * @returns Detached advertised names, including tools not yet granted by the owner.
 * @complexity O(t) time/space for t names in the existing bounded listing; no I/O.
 */
export function readFrozenFederationToolNames(
  { registry, connectionId, origin }: { registry: ToolRegistry; connectionId: string; origin: FederatedConnectionOrigin },
  _options = {},
): readonly string[] | null {
  const frozen = connectionsByRegistry.get(registry)?.get(connectionId);
  const admittedOrigin = frozen?.config.origin;
  if (!frozen || !admittedOrigin || admittedOrigin.kind !== origin.kind) return null;
  if (origin.kind === 'roster' && admittedOrigin.kind === 'roster' && origin.admissionRevision !== admittedOrigin.admissionRevision) return null;
  return frozen.tools.map(tool => tool.name);
}

/** Compare only owner grants; remote definitions, endpoint identity and read trust remain frozen. */
function grantsKey({ config }: { config: FederatedMcpConnectionConfig }, _options = {}): string {
  return JSON.stringify([config.allowedToolNames, config.writeAllowedToolNames]);
}

/** Register one roster source in the existing core revocation scope and retain its first listing.
 * @returns Registered tool ids; remote snapshots stay private to this registry's lifetime.
 * @throws Core scope/collision errors before publishing a partial replacement.
 * @complexity O(t) snapshot and registration work for t originally listed tools; no I/O.
 */
export function registerFrozenFederationConnection(
  { registry, session, config, tools, deps, registrations }: { registry: ToolRegistry; session: McpSessionPort; config: FederatedMcpConnectionConfig; tools: readonly RemoteToolDescriptor[]; deps: FederationDeps; registrations: readonly ToolRegistration[] },
  { buildRegistrations = buildFederatedMcpRegistrations }: { buildRegistrations?: typeof buildFederatedMcpRegistrations } = {},
): string[] {
  const scope = createToolRegistrationScope({ registry });
  scope.replace({ registrations });
  const connections = connectionsByRegistry.get(registry) ?? new Map<string, FrozenConnection>();
  connectionsByRegistry.set(registry, connections);
  const ids = registrations.map(registration => registration.descriptor.id);
  connections.set(config.connectionId, { scope, session, deps, buildRegistrations, config: structuredClone(config), tools: structuredClone(tools), ids: new Set(ids), grantsKey: grantsKey({ config }), visible: true });
  return ids;
}

/** Hide a removed/off/changed source, revoking already-held handler closures too. O(t) removals. */
function hideConnection({ frozen }: { frozen: FrozenConnection }, _options = {}): void {
  if (!frozen.visible) return;
  frozen.scope.replace({ registrations: [] });
  frozen.visible = false;
}

/** Restore or re-grant only the original endpoint, with original schemas and classifications.
 * @complexity O(n+t) registry collision checking and rebuilding for t frozen tools; no I/O.
 */
function refreshConnection({ registry, frozen, current }: { registry: ToolRegistry; frozen: FrozenConnection; current: ResolvedFederatedConnection | undefined }, _options = {}): FederatedAdmissionReport | null {
  if (!current || JSON.stringify(current.config.origin) !== JSON.stringify(frozen.config.origin)) { hideConnection({ frozen }); return null; }
  const key = grantsKey({ config: current.config });
  if (frozen.visible && key === frozen.grantsKey) return null;
  const config = { ...frozen.config, allowedToolNames: current.config.allowedToolNames, writeAllowedToolNames: current.config.writeAllowedToolNames };
  const nativeToolIds = new Set(registry.list({}).map(tool => tool.id).filter(id => !frozen.ids.has(id)));
  const { registrations, report } = frozen.buildRegistrations({ config, tools: frozen.tools, session: frozen.session, deps: frozen.deps, nativeToolIds });
  frozen.scope.replace({ registrations });
  frozen.ids = new Set(registrations.map(registration => registration.descriptor.id));
  frozen.grantsKey = key;
  frozen.visible = true;
  return report;
}

/** Apply current owner grants to already connected roster sources without tools/list or connect.
 * Missing sources are hidden; changed identities remain hidden until a new connection is admitted.
 * @returns Updated reports in the existing admission shape; frozen definitions never widen.
 * @throws Collision errors from the core's atomic registration-scope replacement.
 * @complexity O(c + r*(n+t)) for c sources, r changed grants, n registered tools, t frozen tools;
 * no database, filesystem, polling or remote I/O.
 */
export function refreshFrozenFederationGrants(
  { registry, connections }: { registry: ToolRegistry; connections: readonly ResolvedFederatedConnection[] },
  _options = {},
): { connectionId: string; report: FederatedAdmissionReport; isPreset: boolean }[] {
  const currentById = new Map(connections.map(connection => [connection.config.connectionId, connection]));
  const reports = [];
  for (const [connectionId, frozen] of connectionsByRegistry.get(registry) ?? []) {
    const report = refreshConnection({ registry, frozen, current: currentById.get(connectionId) });
    if (report) reports.push({ connectionId, report, isPreset: false });
  }
  return reports;
}
