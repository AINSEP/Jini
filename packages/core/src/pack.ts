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
  get<T>(required: { token: Token<T, string> }): T;
  getMany<T>(required: { token: ManyToken<T, string> }): T[];
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
   * `ToolRegistry`. Composition roots must call `registerPackTools` exactly once per composed pack,
   * before mounting any transport, so a pack's routes can assume its tools are already registered.
   * This interface and `createDaemon` do not enforce that orchestration; repeated registration
   * invokes the contribution again and duplicate tool IDs are rejected by the registry.
   *
   * Atomic with `http`/`cli` by construction: a pack that is not composed contributes neither its
   * tools nor its routes. See this module's own doc for the failure mode that makes this
   * load-bearing rather than a convenience.
   */
  readonly tools?: (required: { services: Services }) => readonly ToolRegistration[];
  readonly http?: (required: { app: unknown; services: Services }) => void;
  readonly cli?: (required: { reg: unknown; services: Services }) => void;
  /**
   * Releases whatever this pack's `services` acquired (a pty manager, a database handle, an OAuth
   * callback listener). Composition roots call these in reverse composition order, best-effort:
   * one pack's failure to dispose must never prevent another's from running.
   */
  readonly dispose?: (required: { services: Services }) => Promise<void> | void;
}

export interface PackContributions<Services> {
  tools?: (required: { services: Services }) => readonly ToolRegistration[];
  http?: (required: { app: unknown; services: Services }) => void;
  cli?: (required: { reg: unknown; services: Services }) => void;
  dispose?: (required: { services: Services }) => Promise<void> | void;
}

export function definePack<
  const Name extends string,
  const Deps extends readonly AnyToken<unknown, string>[],
  Services,
>(def: {
  name: Name;
  deps: Deps;
  services: (c: PackContainer) => Services;
}, optional: PackContributions<Services> = {}): Pack<Deps, Services, Name> {
  return { ...def, ...optional };
}
