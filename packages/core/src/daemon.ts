import type { Bindings } from './bindings.js';
import type { Pack, PackContainer } from './pack.js';
import type { AnyToken, ManyToken, Token } from './token.js';

/**
 * Exported (not just used locally) so `./internal.js` can re-derive `createDaemon`'s exact
 * compile-time "missing binding" gate for a wrapper composition function (today:
 * `@jini-ai/server`'s `createLocalNodeDaemon`) without duplicating the type-level logic. Not
 * re-exported from `index.ts` — see `./internal.ts`'s module doc for why this stays off the
 * public surface (same boundary pattern as `tool-registry.ts`'s `authorizeToolInvocation`).
 */
export type AnyPack = Pack<any, any, string>;

export type RequiredTokenIds<Packs extends readonly AnyPack[]> = Packs[number]['deps'][number]['id'];

export type MissingTokenIds<Packs extends readonly AnyPack[], BoundIds extends string> = Exclude<
  RequiredTokenIds<Packs>,
  BoundIds
>;

type ServicesOf<Packs extends readonly AnyPack[], Name extends string> = Extract<
  Packs[number],
  { name: Name }
> extends Pack<any, infer Services, any>
  ? Services
  : never;

export interface Daemon<Packs extends readonly AnyPack[] = readonly AnyPack[]> {
  readonly services: { [K in Packs[number]['name']]: ServicesOf<Packs, K> };
}

export interface DaemonConfig<Packs extends readonly AnyPack[], BoundIds extends string> {
  packs: Packs;
  bindings: Bindings<BoundIds>;
  transports?: readonly unknown[];
}

function makeContainer(pack: AnyPack, bound: Bindings<any>): PackContainer {
  const declaredIds = new Set(pack.deps.map((d: AnyToken<unknown, string>) => d.id));
  const guard = (id: string) => {
    if (!declaredIds.has(id)) {
      throw new Error(`pack "${pack.name}" resolved "${id}" without declaring it in deps`);
    }
  };
  return {
    get<T>(t: Token<T, string>): T {
      guard(t.id);
      return bound.resolveOne(t);
    },
    getMany<T>(t: ManyToken<T, string>): T[] {
      guard(t.id);
      return bound.resolveMany(t);
    },
  };
}

/**
 * Composes packs against a bound set of tokens. Compile-time: if any pack
 * declares a dep whose id isn't in `BoundIds`, the config parameter widens to
 * require an (unsatisfiable) `__missingBindings` property carrying the exact
 * missing-id union, so the call site fails to typecheck with that union
 * visible in the error. Runtime: `bindings.bind()` already rejects duplicate
 * singletons and version mismatches at bind time; resolving here (eagerly,
 * per pack, at compose time) surfaces "missing binding" even if the
 * compile-time gate was bypassed with `any`.
 */
export function createDaemon<const Packs extends readonly AnyPack[], BoundIds extends string>(
  config: DaemonConfig<Packs, BoundIds> &
    (MissingTokenIds<Packs, BoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, BoundIds> }),
): Daemon<Packs> {
  const services: Record<string, unknown> = {};
  for (const pack of config.packs) {
    const container = makeContainer(pack, config.bindings);
    services[pack.name] = pack.services(container);
  }
  return { services } as Daemon<Packs>;
}
