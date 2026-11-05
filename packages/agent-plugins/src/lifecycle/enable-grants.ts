/** A plugin's declared tools are the ceiling for additions, never a remote server's tool listing. */
export interface AgentPluginDeclaredTools {
  readonly allow?: readonly string[] | undefined;
  readonly write: readonly string[];
}

export interface AgentPluginToolGrant {
  readonly enabled: boolean;
  readonly allow: readonly string[];
  readonly write: readonly string[];
}

/** Existing nonempty lists belong to the owner; sign-in must not widen either list. O(1). */
function hasExistingGrants({ current }: { current: AgentPluginToolGrant }, _options = {}): boolean {
  return current.allow.length > 0 || current.write.length > 0;
}

/** Plan the existing sign-in grant or an explicit owner-approved enable without changing inputs.
 * Sign-in preserves every edited list. Owner enable retains existing grants and adds only declared
 * tools; the host must bind this plan to its approval card before applying it.
 * @param required Current row grants and the installed declaration.
 * @param options Grant occasion; sign-in is the conservative default.
 * @returns The exact resulting grants, or null when no grant is declared or needed.
 * @throws RangeError when a declaration grants writes outside its allowlist.
 * @complexity O(a + w) time and space in current and declared tool names; no I/O.
 */
export function planAgentPluginToolGrant(
  { current, declared }: { current: AgentPluginToolGrant; declared: AgentPluginDeclaredTools },
  { reason = 'sign-in' }: { reason?: 'sign-in' | 'owner-enable' } = {},
): AgentPluginToolGrant | null {
  if (!declared.allow) return null;
  const declaredAllow = new Set(declared.allow);
  if (declared.write.some(name => !declaredAllow.has(name))) throw new RangeError('Plugin write grants must be in its declared allow list');
  if (reason === 'sign-in' && hasExistingGrants({ current })) return null;
  const allow = [...new Set([...current.allow, ...declared.allow])];
  const write = [...new Set([...current.write, ...declared.write])];
  if (current.enabled && JSON.stringify(current.allow) === JSON.stringify(allow) && JSON.stringify(current.write) === JSON.stringify(write)) return null;
  return { enabled: true, allow, write };
}
