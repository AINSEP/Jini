import type { Bindings } from './bindings.js';
import type { Pack, PackContainer } from './pack.js';
import type { AnyToken, ManyToken, Token } from './token.js';

/**
 * Exported (not just used locally) so `./composition.js` can re-derive `createDaemon`'s exact
 * compile-time "missing binding" gate for a wrapper composition function (today:
 * `@jini-ai/server`'s `createLocalNodeDaemon`) without duplicating the type-level logic. Not
 * re-exported from `index.ts` — see `./composition.ts`'s module doc for why this stays off the
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
}

/** Optional transport metadata, separate from required packs and bindings. */
export interface DaemonOptions {
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
    get<T>({ token: t }: { token: Token<T, string> }): T {
      guard(t.id);
      return bound.resolveOne({ token: t });
    },
    getMany<T>({ token: t }: { token: ManyToken<T, string> }): T[] {
      guard(t.id);
      return bound.resolveMany({ token: t });
    },
  };
}

/**
 * Composes packs against a bound set of tokens. Compile-time: if any pack
 * declares a dep whose id isn't in `BoundIds`, the config parameter widens to
 * require an (unsatisfiable) `__missingBindings` property carrying the exact
 * missing-id union, so the call site fails to typecheck with that union
 * visible in the error. Runtime: `bindings.bind()` rejects duplicate
 * singletons at bind time; singleton resolution checks presence and version.
 * Resolve every declared dependency before constructing any services, so an
 * unused singleton still surfaces "missing binding" or a version mismatch
 * even if the compile-time gate was bypassed with `any`. Many-token resolution
 * preserves its existing empty-list behavior and does not check versions.
 */
export function createDaemon<const Packs extends readonly AnyPack[], BoundIds extends string>(
  config: DaemonConfig<Packs, BoundIds> &
    (MissingTokenIds<Packs, BoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, BoundIds> }),
  _optional: DaemonOptions = {},
): Daemon<Packs> {
  // Validate the whole composition before service factories acquire resources;
  // checking one pack at a time could leave earlier packs initialized on failure.
  for (const pack of config.packs) {
    for (const dependency of pack.deps) {
      if (dependency.cardinality === 'one') config.bindings.resolveOne({ token: dependency });
      else config.bindings.resolveMany({ token: dependency });
    }
  }
  const services: Record<string, unknown> = {};
  for (const pack of config.packs) {
    const container = makeContainer(pack, config.bindings);
    services[pack.name] = pack.services(container);
  }
  return { services } as Daemon<Packs>;
}
