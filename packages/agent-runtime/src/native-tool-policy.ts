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
  /** Trusted host eligibility, independent of the current workspace switches. */
  canGrantFullCliAccess?: boolean;
  nativeToolAccess?: boolean;
  nativeCapabilities?: Partial<NativeCapabilities>;
  cliParity?: boolean;
  permissionMode?: 'bypass' | 'restricted';
}

/** Shared picker/launch reason; hosts translate this key through their existing t() helper. */
export const FULL_CLI_OWNER_REASON = 'Only the owner can change Full CLI access.';

/** Resolve a full-access-only runtime after the host grants eligibility. Other policies stay intact.
 * Identity and environment checks belong to the host; this pure projection cannot grant eligibility.
 */
export function resolveNativeToolPolicy({ def, policy }: {
  def: { name?: string; fullCliAccessOnly?: boolean }; policy: NativeToolPolicyInput;
}, _options: Record<string, never> = {}): NativeToolPolicyInput {
  if (!def.fullCliAccessOnly || policy.canGrantFullCliAccess !== true) return policy;
  return { ...policy, nativeToolAccess: true, cliParity: true, permissionMode: 'bypass',
    nativeCapabilities: { shell: true, fileWrite: true, userMcp: true, subagents: true,
      userSettings: true, web: true, workflows: true, loginEnvironment: true } };
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
  return `${cliName} can't run ${blocked}. ${action} in the assistant settings, or choose Claude or Codex.`;
}

/** The same fail-closed assessment at selection and spawn; no CLI-name allowlist.
 * Unknown explicit OFF switches stay blocked. O(c) over declared limits, without effects.
 */
export function assessNativeToolPolicy({ def, policy }: {
  def: { name: string; supportsNativeToolAccess?: boolean; fullCliAccessOnly?: boolean };
  policy: NativeToolPolicyInput;
}, _options: Record<string, never> = {}): string | null {
  if (def.fullCliAccessOnly) return policy.canGrantFullCliAccess === true ? null : FULL_CLI_OWNER_REASON;
  if (def.supportsNativeToolAccess === true) return null;
  const parity = policy.cliParity === true && policy.permissionMode === 'bypass' && policy.nativeToolAccess !== false;
  const offSwitches = Object.entries(policy.nativeCapabilities ?? {}).filter(([, value]) => value === false).map(([key]) => key);
  if ((policy.nativeToolAccess !== undefined && !parity) || offSwitches.length > 0) {
    return nativeToolPolicyRefusal({ cliName: def.name, offSwitches });
  }
  return null;
}
