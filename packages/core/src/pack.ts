/**
 * @module pack
 *
 * A `Pack` is this kernel's one composition unit: a named bundle of services, plus the optional
 * transports (`http`/`cli`), **tool registrations** (`tools`), and teardown (`dispose`) that belong
 * to those services.
 *
 * `tools` and `dispose` were added 2026-07-29 to close the **Route-vs-Tool Gap**. Before them a
 * pack could contribute an HTTP surface but had no way to contribute a `ToolRegistration`, so every
 * real composition (notably `@jini-ai/server`'s `createLocalNodeDaemon`) registered a feature's
 * tools in one place and mounted that feature's routes in another. Those two steps could then be
 * gated independently — turning a route family "off" while leaving its tool registered and
 * reachable through the always-mounted delegated-tool-call route. Putting both contributions on one
 * object makes that failure unrepresentable: a pack that is not composed contributes neither, and
 * there is no separate mounting step for a caller to forget.
 *
 * The rule for pack authors is therefore: **a capability's tools and its routes belong to the same
 * pack.** Splitting them across two packs re-opens the gap by hand.
 */
import type { ToolRegistration } from './tool-registry.js';
import type { AnyToken, ManyToken, Token } from './token.js';

/**
 * The only resolver a pack's `services` factory ever sees. Scoped to that
 * pack's own declared `deps` — resolving a token the pack didn't declare is a
 * bug (kernel escape hatch), not a convenience, so it throws rather than
 * silently falling through to a global container.
 */
export interface PackContainer {
  get<T>(t: Token<T, string>): T;
  getMany<T>(t: ManyToken<T, string>): T[];
}

export interface Pack<
  Deps extends readonly AnyToken<unknown, string>[] = readonly AnyToken<unknown, string>[],
  Services = unknown,
  Name extends string = string,
> {
  readonly name: Name;
  readonly deps: Deps;
  readonly services: (c: PackContainer) => Services;
  /**
   * `{descriptor, handler, policy}` triples this pack contributes to the composition's shared
   * `ToolRegistry`. Called exactly once per composed pack, before any transport is mounted, so a
   * pack's routes can assume its own tools are already registered.
   *
   * Atomic with `http`/`cli` by construction: a pack that is not composed contributes neither its
   * tools nor its routes. See this module's own doc for the failure mode that makes this
   * load-bearing rather than a convenience.
   */
  readonly tools?: (services: Services) => readonly ToolRegistration[];
  readonly http?: (app: unknown, services: Services) => void;
  readonly cli?: (reg: unknown, services: Services) => void;
  /**
   * Releases whatever this pack's `services` acquired (a pty manager, a database handle, an OAuth
   * callback listener). Composition roots call these in reverse composition order, best-effort:
   * one pack's failure to dispose must never prevent another's from running.
   */
  readonly dispose?: (services: Services) => Promise<void> | void;
}

export function definePack<
  const Name extends string,
  const Deps extends readonly AnyToken<unknown, string>[],
  Services,
>(def: {
  name: Name;
  deps: Deps;
  services: (c: PackContainer) => Services;
  tools?: (services: Services) => readonly ToolRegistration[];
  http?: (app: unknown, services: Services) => void;
  cli?: (reg: unknown, services: Services) => void;
  dispose?: (services: Services) => Promise<void> | void;
}): Pack<Deps, Services, Name> {
  return def as unknown as Pack<Deps, Services, Name>;
}
