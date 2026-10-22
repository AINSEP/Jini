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
