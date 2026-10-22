import type { ManyToken, Token } from './token.js';

interface BoundOne {
  value: unknown;
  version: number;
}

/**
 * A typed binding set. `BoundIds` accumulates the literal union of bound
 * token ids as `.bind`/`.bindMany` are chained, so `createDaemon` can check
 * `Exclude<RequiredTokenIds<Packs>, BoundIds>` at compile time (see daemon.ts).
 */
export class Bindings<BoundIds extends string = never> {
  constructor(_required: Record<string, never>) {}

  private readonly one = new Map<string, BoundOne>();
  private readonly many = new Map<string, unknown[]>();

  bind<T, Id extends string>({ token: t, impl }: { token: Token<T, Id>; impl: T }): Bindings<BoundIds | Id> {
    if (this.one.has(t.id)) {
      throw new Error(`duplicate binding: ${t.id} is already bound (a singleton token accepts exactly one binding)`);
    }
    this.one.set(t.id, { value: impl, version: t.version });
    return this as unknown as Bindings<BoundIds | Id>;
  }

  bindMany<T, Id extends string>({ token: t, impl }: { token: ManyToken<T, Id>; impl: T }): Bindings<BoundIds | Id> {
    const list = this.many.get(t.id) ?? [];
    list.push(impl);
    this.many.set(t.id, list);
    return this as unknown as Bindings<BoundIds | Id>;
  }

  /** @internal */
  resolveOne<T>({ token: t }: { token: Token<T, string> }): T {
    const entry = this.one.get(t.id);
    if (!entry) {
      throw new Error(`missing binding: ${t.id}`);
    }
    if (entry.version !== t.version) {
      throw new Error(`version-incompatible binding: ${t.id} expects v${t.version}, got v${entry.version}`);
    }
    return entry.value as T;
  }

  /** @internal */
  resolveMany<T>({ token: t }: { token: ManyToken<T, string> }): T[] {
    return (this.many.get(t.id) ?? []) as T[];
  }
}

export function bindings(required: Record<string, never>): Bindings<never> {
  return new Bindings<never>(required);
}
