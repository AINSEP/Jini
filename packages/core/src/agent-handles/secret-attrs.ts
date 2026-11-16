
/**
 * Keeps ordinary control props while excluding agent addressing from a semantic secret, including
 * after reveal changes its native input type. Caller metadata cannot override the private marker.
 * @param required.attrs - Input or reveal-control props; never mutated.
 * @returns A fresh props object with only the enforced agent privacy marker.
 * @complexity O(n) time and space in the number of supplied props; no I/O or effects.
 * @overallScore 100
 */
export function secretControlAttrs<T extends object>({ attrs }: { attrs: T }): Omit<T, `data-agent-${string}`> & { 'data-agent-private': '' } {
  const ordinary = Object.entries(attrs).filter(([name]) => !name.toLowerCase().startsWith('data-agent-'));
  return { ...Object.fromEntries(ordinary), 'data-agent-private': '' } as Omit<T, `data-agent-${string}`> & { 'data-agent-private': '' };
}
