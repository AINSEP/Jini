/** Structurally compatible with @jini-ai/core's singleton Token<T, Id>.
 * Admin currently has no core dependency or core/token export to reuse. Keep the same
 * named/versioned wire identity without adding an undeclared runtime dependency. */
export interface AdminPortToken<T = unknown, Id extends string = string> {
  readonly id: Id;
  readonly version: number;
  readonly cardinality: 'one';
  readonly __type?: T;
}
export function adminPort<T, const Id extends string = string>(
  { id }: { id: Id },
  { version = 1 }: { version?: number } = {},
): AdminPortToken<T, Id> {
  return Object.freeze({ id, version, cardinality: 'one' });
}
export type PortMap = Readonly<Record<string, AdminPortToken>>;
export type PortValues<P extends PortMap> = {
  readonly [K in keyof P]: P[K] extends AdminPortToken<infer T> ? T : never;
};
