import { ToolInputError, type ToolRegistration } from '@jini-ai/core';
import type { NativeCapabilities } from '@jini-ai/agent-runtime/native-tool-policy';

const CAPABILITY_KEYS = ['shell', 'fileWrite', 'userMcp', 'subagents', 'userSettings', 'web', 'workflows', 'loginEnvironment'] as const;
const SETTING_KEYS = ['enabled', ...CAPABILITY_KEYS] as const;
type SettingKey = typeof SETTING_KEYS[number];
type SettingSource = 'site' | 'byAgent' | 'default' | 'host_locked';
export interface ChatSettingsSnapshot {
  agent: string; model: string | null; effort: string | null;
  enabled: boolean; capabilities: NativeCapabilities;
  sources: Record<SettingKey, SettingSource>;
  source: 'provided' | 'provided+personal'; isolation: 'none' | 'no-client' | 'perRun';
  verdict: 'RUN' | 'ASK' | 'SETUP'; keys: SettingKey[]; reason?: string;
  toolIds: string[]; servers: { id: string; host: string }[]; truncated: boolean;
}
export interface ChatSettingsSnapshotInput {
  agentId: string; model?: string; effort?: string;
  permissions: { enabled: boolean; capabilities: Partial<NativeCapabilities> };
  sourceByKey?: Partial<Record<SettingKey, SettingSource>>;
  plan: { verdict: 'RUN' | 'ASK' | 'SETUP'; loadsOwn?: boolean; keys?: readonly string[]; reason?: string };
  isolation: 'none' | 'no-client' | 'perRun'; toolIds?: readonly string[];
  servers?: readonly { id: string; transport: string; url?: string; host?: string }[];
}

/** A server's parsed hostname is the only address data exposed; stdio reveals no command or args.
 * @complexity O(u) for URL length; pure. @overallScore 100 */
function serverHost(server: { transport: string; url?: string; host?: string }): string {
  if (server.transport === 'stdio') return 'local command';
  if (server.host === 'local command') return 'local command';
  try { return new URL(server.host ? `https://${server.host}` : server.url ?? '').hostname; } catch { return 'unknown'; }
}

/** Append one public inventory record only if the whole UTF-8 snapshot stays within 2 KiB.
 * The candidate is rolled back on overflow; callers stop immediately. @complexity O(2048).
 * @overallScore 100 */
function appendWithinBound<T>(snapshot: ChatSettingsSnapshot, list: T[], item: T): boolean {
  list.push(item);
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= 2048) return true;
  list.pop(); snapshot.truncated = true; return false;
}

/** Explicit projection of one launch's facts; never accepts configs, credentials or personal lists.
 * Identifiers are bounded, URLs become hostnames, inventory overflow is labelled. No I/O.
 * @param required The host-gated permissions and planner decision used for this launch.
 * @returns A detached snapshot whose serialized UTF-8 body is at most 2 KiB.
 * @complexity O(2048) output space; processes only the inventory prefix that fits.
 * @overallScore 100
 * @example createChatSettingsSnapshot({agentId:'claude', permissions, plan, isolation:'none'}, {});
 */
export function createChatSettingsSnapshot(required: ChatSettingsSnapshotInput, _optional: Record<string, never> = {}): ChatSettingsSnapshot {
  const snapshot: ChatSettingsSnapshot = {
    agent: required.agentId.slice(0, 96), model: required.model?.slice(0, 96) ?? null, effort: required.effort?.slice(0, 32) ?? null,
    enabled: required.permissions.enabled,
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, required.permissions.capabilities[key] === true])) as unknown as NativeCapabilities,
    sources: Object.fromEntries(SETTING_KEYS.map(key => [key, required.sourceByKey?.[key] ?? 'default'])) as Record<SettingKey, SettingSource>,
    source: required.plan.loadsOwn === true ? 'provided+personal' : 'provided', isolation: required.isolation,
    verdict: required.plan.verdict, keys: SETTING_KEYS.filter(key => required.plan.keys?.includes(key)),
    toolIds: [], servers: [], truncated: false,
  };
  const reason = required.plan.reason;
  if (reason && ['not_installed', 'not_signed_in', 'host_locked', 'isolation_blocked'].includes(reason)) snapshot.reason = reason;
  appendInventory(snapshot, required);
  return snapshot;
}

/** Bounded inventory projection; no additional config or remote reads. @complexity O(2048).
 * @overallScore 100 */
function appendInventory(snapshot: ChatSettingsSnapshot, required: ChatSettingsSnapshotInput): void {
  for (const id of required.toolIds ?? []) if (!appendWithinBound(snapshot, snapshot.toolIds, id.slice(0, 128))) break;
  for (const server of required.servers ?? []) if (!appendWithinBound(snapshot, snapshot.servers, { id: server.id.slice(0, 96), host: serverHost(server).slice(0, 253) })) break;
}

/** Register the argument-free, card-free read for the invoking authenticated run and principal.
 * The host lookup must return nothing for foreign principals, missing snapshots and terminal runs.
 * @param required.readSnapshot Existing authenticated run-scoped snapshot lookup; performs no config reads.
 * @returns A read-only registration; caller-supplied run/site/principal selectors are rejected.
 * @throws ToolInputError for arguments or an unavailable run snapshot.
 * @complexity O(1), one snapshot lookup, output bounded by createChatSettingsSnapshot.
 * @overallScore 100
 * @example registry.register(createChatSettingsGetRegistration({readSnapshot}, {}));
 */
export function createChatSettingsGetRegistration(required: {
  readSnapshot(input: { runId: string; principalId: string }): ChatSettingsSnapshot | undefined;
}, _optional: Record<string, never> = {}): ToolRegistration {
  return {
    descriptor: { id: 'chat_settings_get', description: 'Read this run’s effective tool settings, source mode, planner reason and admitted tools. Call when explaining your own access. Takes no arguments. Returns the launch snapshot, up to 2 KiB; unavailable after the run ends.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true, sideEffects: 'none', requiresConfirmation: false, maxOutputBytes: 2048 },
    policy: { authorize: ({ run, principal }) => required.readSnapshot({ runId: run.id, principalId: principal.id }) ? 'allow' : 'deny' },
    handler: async ctx => {
      if (!ctx.input || typeof ctx.input !== 'object' || Array.isArray(ctx.input) || Object.keys(ctx.input).length !== 0) throw new ToolInputError({ message: 'chat_settings_get takes no arguments.' });
      const snapshot = required.readSnapshot({ runId: ctx.run.id, principalId: ctx.principal.id });
      if (!snapshot) throw new ToolInputError({ message: 'Chat settings are unavailable for this run.' });
      return snapshot;
    },
  };
}
