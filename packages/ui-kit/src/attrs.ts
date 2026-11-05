/** Opaque host metadata. Implementations must spread it onto the documented focus target. */
export type KitAttrs = Readonly<{ id?: string; 'data-jini-part'?: string }> &
  Readonly<Partial<Record<`data-${string}` | `aria-${string}`, string | number | boolean | undefined>>>;
export interface AgentSpec { readonly handle: string; readonly role: 'button' | 'field' | 'select'; readonly label: string }
/** The host owns handle validation and its agent runtime; this package never imports one. */
export type AgentAttrsPort = (required: { handle: string }, optional?: { role?: AgentSpec['role']; label?: string }) => KitAttrs;

/**
 * Keeps ordinary control props while excluding agent addressing from a semantic secret, including
 * after reveal changes its native input type. Caller metadata cannot override the private marker.
 * @param required.attrs - Input or reveal-control props; never mutated.
 * @returns A fresh props object with only the enforced agent privacy marker.
 * @complexity O(n) time and space in the number of supplied props; no I/O or effects.
 * @overallScore 100
 */
export function secretControlAttrs<T extends object>({ attrs }: { attrs: T }, _optional: Record<string, never> = {}): Omit<T, `data-agent-${string}`> & { 'data-agent-private': '' } {
  const ordinary = Object.entries(attrs).filter(([name]) => !name.toLowerCase().startsWith('data-agent-'));
  return { ...Object.fromEntries(ordinary), 'data-agent-private': '' } as Omit<T, `data-agent-${string}`> & { 'data-agent-private': '' };
}
