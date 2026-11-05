/** Native fallback tools, independent of a host's catalog and identity policy. */
export const NATIVE_FALLBACK_TOOLS: readonly string[] = Object.freeze([
  'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'BashOutput', 'KillShell',
]);

/** Independent native CLI dimensions; hosts own identity, defaults and persistence. */
export interface NativeCapabilities {
  shell: boolean;
  fileWrite: boolean;
  userMcp: boolean;
  subagents: boolean;
  userSettings: boolean;
  web: boolean;
  workflows: boolean;
  loginEnvironment: boolean;
}

const CAPABILITY_TOOLS = {
  shell: ['Bash', 'BashOutput', 'KillShell'],
  fileWrite: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  subagents: ['Task', 'Agent'],
  web: ['WebFetch', 'WebSearch'],
  workflows: ['CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree', 'RemoteTrigger', 'Workflow'],
} as const;

/** Append explicit capability denies AFTER resolving the legacy all-or-nothing grant.
 * An unrelated ON permission must never erase an individual OFF. Pure, bounded tool list.
 */
export function resolveNativeCapabilityDenies(required: {
  capabilities?: Partial<NativeCapabilities>; denied: readonly string[];
}, _optional: Record<string, never> = {}): readonly string[] {
  const denied = new Set(required.denied);
  for (const key of Object.keys(CAPABILITY_TOOLS) as (keyof typeof CAPABILITY_TOOLS)[]) {
    if (required.capabilities?.[key] === false) for (const tool of CAPABILITY_TOOLS[key]) denied.add(tool);
  }
  return [...denied];
}

/** Hosts explicitly grant native fallbacks; omitted preserves the standalone CLI contract.
 * Pure, O(t) for t configured denies. Security/path denies always survive the grant.
 * @example resolveNativeToolDenies({ enabled: true, denied: ['Bash', 'Read(/secret)'] }, {});
 */
export function resolveNativeToolDenies(required: {
  enabled: boolean | undefined; denied?: readonly string[];
}, _optional: Record<string, never> = {}): readonly string[] {
  const denied = required.denied ?? [];
  if (required.enabled === undefined) return denied;
  if (required.enabled) return denied.filter(tool => !NATIVE_FALLBACK_TOOLS.includes(tool));
  return [...new Set([...denied, ...NATIVE_FALLBACK_TOOLS])];
}

/** Current run limits, shared by launch enforcement and browser preflight. */
export interface NativeToolPolicyInput {
  nativeToolAccess?: boolean;
  nativeCapabilities?: Partial<NativeCapabilities>;
  cliParity?: boolean;
  permissionMode?: 'bypass' | 'restricted';
}

/** Resolve without granting authority: runtimes requiring full access need explicit host consent.
 * Pure O(1); a definition is never an authorization decision.
 */
export function resolveNativeToolPolicy({ policy }: {
  def: { name?: string; fullCliAccessOnly?: boolean }; policy: NativeToolPolicyInput;
}, _options: Record<string, never> = {}): NativeToolPolicyInput {
  return policy;
}

/** Switch names a person sees for each native capability (the host's settings use the same words). */
const NATIVE_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  shell: 'Bash/shell', fileWrite: 'File edit/write', userMcp: 'Your MCP servers', subagents: 'Subagents/Task',
  userSettings: 'Your skills and settings', web: 'Web fetch/search', workflows: 'Workflows', loginEnvironment: 'Your shell environment',
};

/** The refusal a person reads when a CLI without a native-tool policy cannot honor this run's switches:
 * it names the CLI and the switch to turn on. Owner 2026-10-27: the old "no native-tool policy and
 * audit adapter" told a Gemini user nothing. Pure, O(c) for c OFF switches.
 * @example nativeToolPolicyRefusal({ cliName: 'Antigravity', offSwitches: ['userMcp'] }, {});
 */
function nativeToolPolicyRefusal({ cliName, offSwitches }: { cliName: string; offSwitches: readonly string[] }, _options = {}): string {
  const switches = offSwitches.map(key => `'${NATIVE_CAPABILITY_LABELS[key] ?? key}'`);
  const blocked = switches.length > 0 ? `with ${new Intl.ListFormat('en', { type: 'conjunction' }).format(switches)} off` : `with this chat's CLI tool limits`;
  const pronoun = switches.length === 1 ? 'it' : 'them';
  const action = switches.length === 0 ? `Turn on 'Full CLI access'` : `Turn ${pronoun} on`;
  return `${cliName} can't run ${blocked}. ${action} in gear → More settings → Agent permissions, or choose an available agent that supports these limits.`;
}

/** The same fail-closed assessment at selection and spawn; no CLI-name allowlist.
 * Unknown explicit OFF switches stay blocked. O(c) over declared limits, without effects.
 */
export function assessNativeToolPolicy({ def, policy }: {
  def: { name: string; supportsNativeToolAccess?: boolean; fullCliAccessOnly?: boolean };
  policy: NativeToolPolicyInput;
}, _options: Record<string, never> = {}): string | null {
  if (def.supportsNativeToolAccess === true) return null;
  const parity = policy.cliParity === true && policy.permissionMode === 'bypass' && policy.nativeToolAccess !== false;
  const offSwitches = Object.entries(policy.nativeCapabilities ?? {}).filter(([, value]) => value === false).map(([key]) => key);
  if ((policy.nativeToolAccess !== undefined && !parity) || offSwitches.length > 0) {
    return nativeToolPolicyRefusal({ cliName: def.name, offSwitches });
  }
  return null;
}

/** Consent keys are the existing master switch and independently stored native capabilities. */
export type RunConsentKey = 'enabled' | keyof NativeCapabilities;
export type RunPlan =
  | { verdict: 'RUN'; loadsOwn: boolean; bridged: boolean }
  | { verdict: 'ASK'; keys: RunConsentKey[]; why?: 'isolation_blocked' }
  | { verdict: 'SETUP'; reason: 'not_installed' | 'not_signed_in' | 'host_locked'; keys?: RunConsentKey[]; lock?: string };

type PlanningDef = { name: string; supportsNativeToolAccess?: boolean; mcpIsolation?: 'none' | 'no-client' | { readonly perRun: string }; externalMcpInjection?: string; mcpHttp?: boolean };
export interface RunPlanHost {
  installed?: boolean;
  auth?: 'ok' | 'missing' | 'unknown';
  locked?: string;
  isolationBlocked?: boolean;
}

function loadsOwnSources(def: PlanningDef, policy: NativeToolPolicyInput, blocked: boolean): boolean {
  const isolation = blocked ? 'none' : def.mcpIsolation;
  if (isolation === 'no-client') return false;
  if (typeof isolation === 'object' && typeof isolation.perRun === 'string' && isolation.perRun.length > 0) {
    return policy.nativeCapabilities?.userMcp === true;
  }
  return true;
}

function consentKeys(def: PlanningDef, policy: NativeToolPolicyInput, loadsOwn: boolean): RunConsentKey[] {
  const keys: RunConsentKey[] = def.supportsNativeToolAccess === true ? [] :
    Object.entries(policy.nativeCapabilities ?? {}).filter(([key, value]) => key !== 'userMcp' && value === false).map(([key]) => key as RunConsentKey);
  if (def.supportsNativeToolAccess !== true && policy.nativeToolAccess === false) keys.unshift('enabled');
  if (loadsOwn && policy.nativeCapabilities?.userMcp !== true) keys.push('userMcp');
  return keys;
}

/** Pure launch decision, before credentials, config repair or spawn. Unknown auth proceeds;
 * unknown isolation requires consent. Fixed capability work, no filesystem or credential reads.
 */
export function planRun({ def, policy, host = {} }: {
  def: PlanningDef; policy: NativeToolPolicyInput; host?: RunPlanHost;
}, _optional: Record<string, never> = {}): RunPlan {
  if (host.installed === false) return { verdict: 'SETUP', reason: 'not_installed' };
  if (host.auth === 'missing') return { verdict: 'SETUP', reason: 'not_signed_in' };
  const loadsOwn = loadsOwnSources(def, policy, host.isolationBlocked === true);
  const keys = consentKeys(def, policy, loadsOwn);
  if (keys.length > 0 && host.locked) return { verdict: 'SETUP', reason: 'host_locked', keys, lock: host.locked };
  if (keys.length > 0) return { verdict: 'ASK', keys, ...(host.isolationBlocked ? { why: 'isolation_blocked' as const } : {}) };
  return { verdict: 'RUN', loadsOwn, bridged: Boolean(def.externalMcpInjection || def.mcpHttp) };
}

/** Shared consumer contract for a fresh local owner: provided tools stay available;
 * the agent's personal MCP sources require an explicit grant. No persisted settings or I/O.
 */
export const LOCAL_HOST_DEFAULT_PERMISSIONS = Object.freeze({
  enabled: true,
  capabilities: Object.freeze({ shell: true, fileWrite: true, userMcp: false, subagents: true,
    userSettings: true, web: true, workflows: true, loginEnvironment: true }),
});
