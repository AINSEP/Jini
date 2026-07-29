/**
 * @module pack-lifecycle
 *
 * The non-HTTP half of pack mounting: `registerPackTools` drains every composed pack's `tools`
 * contribution into one shared `ToolRegistry`, and `disposePacks` runs every composed pack's
 * `dispose` in reverse composition order.
 *
 * These live in `@jini-ai/core` rather than beside `@jini-ai/http-kit`'s `mountPackHttp` because
 * neither has anything to do with a transport — a CLI-only or headless composition needs the tool
 * registry and the teardown just as much as an HTTP one does. `mountPackHttp` stays where it is for
 * the same reason in reverse: it is the only one of the three that touches an `app`.
 */
import type { Daemon } from './daemon.js';
import type { Pack } from './pack.js';
import type { ToolRegistration, ToolRegistry } from './tool-registry.js';

type AnyPack = Pack<any, any, string>;

/**
 * Registers `pack.tools(services)` for every pack in `packs` that declares one, in pack order,
 * into the single shared `registry`.
 *
 * Order matters and is deliberately the caller's to choose: `ToolRegistry.register` throws on a
 * duplicate descriptor id, so whichever pack registers second is the one named in the error. A
 * composition root that wants a host's own tools to win that message registers the host's packs
 * last.
 *
 * @param registry - The shared registry every composed pack contributes into.
 * @param packs - The composed packs, in composition order.
 * @param daemon - The `createDaemon` result holding each pack's already-built services.
 * @returns Every registration that was added, in the order it was added — so a caller can seed a
 * catalog, log an inventory, or assert on the composition without re-deriving it.
 * @throws Whatever `ToolRegistry.register` throws (notably a duplicate descriptor id), at the
 * moment of the offending registration. Composition roots should treat this as fatal: a partially
 * registered tool set is not a state anything downstream can reason about.
 * @complexity O(t) in total contributed tools.
 */
export function registerPackTools<const Packs extends readonly AnyPack[]>(
  registry: ToolRegistry,
  packs: Packs,
  daemon: Daemon<Packs>,
): readonly ToolRegistration[] {
  const services = daemon.services as Record<string, unknown>;
  const registered: ToolRegistration[] = [];
  for (const pack of packs) {
    for (const registration of pack.tools?.(services[pack.name]) ?? []) {
      registry.register(registration);
      registered.push(registration);
    }
  }
  return registered;
}

/** One pack's teardown failure, kept with the pack's name so a caller can report which one failed. */
export interface PackDisposalFailure {
  readonly pack: string;
  readonly error: unknown;
}

/**
 * Runs `pack.dispose(services)` for every pack that declares one, in **reverse** composition order
 * (a pack composed later may depend on an earlier pack's resources, so it must release first).
 *
 * Best-effort by design: one pack throwing must never prevent the rest from disposing, or a single
 * misbehaving pack would leak every other pack's file handles and listeners. Failures are collected
 * and returned rather than thrown, leaving the composition root free to decide whether a teardown
 * failure is worth surfacing to its own caller.
 *
 * @param packs - The composed packs, in composition order (this function reverses them itself).
 * @param daemon - The `createDaemon` result holding each pack's already-built services.
 * @returns The failures, in the order they occurred. Empty when every pack disposed cleanly.
 * @complexity O(p) in pack count, plus each pack's own teardown cost.
 */
export async function disposePacks<const Packs extends readonly AnyPack[]>(
  packs: Packs,
  daemon: Daemon<Packs>,
): Promise<readonly PackDisposalFailure[]> {
  const services = daemon.services as Record<string, unknown>;
  const failures: PackDisposalFailure[] = [];
  for (let index = packs.length - 1; index >= 0; index -= 1) {
    const pack = packs[index]!;
    if (!pack.dispose) continue;
    try {
      await pack.dispose(services[pack.name]);
    } catch (error) {
      failures.push({ pack: pack.name, error });
    }
  }
  return failures;
}
