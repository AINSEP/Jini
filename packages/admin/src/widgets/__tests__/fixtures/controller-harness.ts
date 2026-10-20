import type { AdminWidget } from '../../models.js';
export interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
/** Lets every already-settled promise continuation run. */
export async function flush(): Promise<void> { for (let i = 0; i < 5; i++) await Promise.resolve(); }
export function widgetRow({ id }: { id: string }, overrides: Partial<AdminWidget> = {}): AdminWidget {
  return { id, workspaceId: 'ws', slug: `${id}-slug`, title: `Title ${id}`, status: 'active', widgetType: 'text', config: { body: id }, updatedAt: 'then', version: 1, ...overrides };
}
