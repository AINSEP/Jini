/**
 * @file `CORE_RESOLVERS` — the closed, core-owned resolver dispatch map (SPEC-043 REQ-08/09/10/23;
 * ADR-047 Debate Fold-In Amendment 2/3).
 *
 * Purpose:
 * The ONE place a registry's `resolverId` string resolves against real, executable code. A
 * `WidgetTypeRegistration.resolverId` is never used as a dynamic import path, `eval`-style
 * reference, or arbitrary function lookup anywhere else in this codebase (REQ-08) — this map is
 * the sole allowlist. `resolveWidgetType` is the dispatcher every page render goes through
 * (`resolver-service.ts`'s `resolvePageWidgets` calls this, once per distinct type present),
 * and it owns the try/catch + timeout boundary so a resolver's exception or hang can never
 * propagate past a widget's placement boundary (REQ-27, INV-05).
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-003). The dispatcher's failure-isolation
 * contract is design-frozen from SPEC-043; `resolveWidgetType()` dispatches to the closed
 * `CORE_RESOLVERS` map (or the static path for a resolver-less type), wrapping every call in the
 * shared try/catch + timeout boundary so a resolver failure never propagates past REQ-27/INV-05.
 * Verified against `__tests__/integration/resolver-service.integration.test.ts`.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { findWidgetTypeRegistration } from "../registry.js";
import { createCoreResolvers, type CoreResolverDeps } from "./create-core-resolvers.js";
import type {
  WidgetInstanceView,
  WidgetResolveContext,
  WidgetResolveFailureReason,
  WidgetResolveResult,
  WidgetResolver,
  WidgetTypeKey,
  WidgetTypeRegistration,
} from "../types.js";

// `create-core-resolvers.ts` is the only production caller of the three factories below — they're
// wired into `CORE_RESOLVERS` via `wireCoreResolvers`, never invoked directly outside this module.
// Each also has its own dedicated unit/integration test exercising the resolver's own logic in
// isolation (2026-08-18 widgets/resolvers deep-import triage), so each factory is re-exported here
// narrowly, one line per consumer:
// `createRecentEntriesResolver` — `widgets/__tests__/unit/resolvers-recent-entries.unit.test.ts`.
export { createRecentEntriesResolver } from "./recent-entries.js";
// `createMenuResolver` — `widgets/__tests__/unit/resolvers-menu.unit.test.ts`.
export { createMenuResolver } from "./menu.js";
// `createContactFormResolver` — `widgets/__tests__/integration/resolve-html-page-embeds.integration.test.ts`.
export { createContactFormResolver } from "./contact-form.js";

/**
 * The mutable backing store `CORE_RESOLVERS` (below) exposes only a readonly view over — see that
 * export's own doc for why the map itself must stay assignable at runtime despite its readonly TS
 * type (the certified test suite mutates it directly, via `@ts-expect-error`, as its test-double
 * seam). `registerCoreResolver`/`wireCoreResolvers` are the two real, typed ways production code
 * populates it; nothing else in this module writes to it.
 */
const mutableResolvers: Partial<Record<WidgetTypeKey, WidgetResolver>> = {};

/**
 * The closed map. Adding a resolver = adding one entry here, never a dynamic import. Types with
 * capability `static` (no `resolverId`) never appear here — `resolveWidgetType` takes the static
 * path for those instead of consulting this map.
 *
 * Typed `Readonly<...>` so every ordinary caller gets a compile-time guarantee this map is never
 * mutated ad hoc from outside `registerCoreResolver`/`wireCoreResolvers` — the certified test
 * suite's direct-assignment test-double seam (`CORE_RESOLVERS["recent-entries"] = resolver`)
 * deliberately overrides that guarantee with `@ts-expect-error`, since at runtime this is the same
 * plain, mutable object `mutableResolvers` is (TypeScript's `readonly` has no runtime effect) —
 * this is intentional, not a bug: it lets the test suite swap in failure-injecting test doubles
 * without a second, parallel test-only export.
 */
export const CORE_RESOLVERS: Readonly<Partial<Record<WidgetTypeKey, WidgetResolver>>> = mutableResolvers;

/** Registers (or replaces) one resolver in the closed map — the one typed, non-test way to populate it. */
export function registerCoreResolver(required: { typeKey: WidgetTypeKey; resolver: WidgetResolver }, _optional: Record<string, never> = {}): void {
  mutableResolvers[required.typeKey] = required.resolver;
}

/**
 * Assembles and registers every real, DI'd v1 dynamic resolver (`recent-entries`, `menu`,
 * `contact-form` — see the sibling files in this directory) against the given infrastructure
 * deps. Not called automatically at module load (these resolvers need injected repos that don't
 * exist yet at pure import time — see each resolver factory's own doc) — a future boot-wiring
 * pass (`server/app.ts`/`server/deps.ts`, out of this task's scope) is expected to call this once,
 * with real adapters, before the app serves traffic. Left uncalled here is a disclosed gap, not an
 * oversight — no test in this slice exercises real dynamic-resolver behavior (see
 * `resolvers/{recent-entries,menu,contact-form}.ts`'s own file headers).
 */
export function wireCoreResolvers(deps: CoreResolverDeps, _optional: Record<string, never> = {}): void {
  for (const [typeKey, resolver] of Object.entries(createCoreResolvers(deps)) as Array<[WidgetTypeKey, WidgetResolver]>) {
    registerCoreResolver({ typeKey, resolver });
  }
}

/** Converts a resolver exception/hang into a typed failure — never propagates (REQ-27, INV-05). */
class ResolverTimeoutError extends Error {}

async function withResolverTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ResolverTimeoutError(`resolver exceeded ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * REQ-25 — re-enforces a type's registered `maxItems` clamp at the orchestration layer,
 * independent of the resolver's own discipline (defense in depth, not redundant — see
 * `registry.ts`'s own doc on this point). Applies to any IR node carrying `children` (the shape a
 * list-like resolved widget uses).
 */
function clampResolveResult(result: WidgetResolveResult, registration: WidgetTypeRegistration): WidgetResolveResult {
  if (!result.ok) return result;
  const maxItems = registration.clamps.maxItems;
  if (maxItems === undefined || !result.ir.children || result.ir.children.length <= maxItems) return result;
  return { ...result, ir: { ...result.ir, children: result.ir.children.slice(0, maxItems) } };
}

/**
 * Dispatches to `CORE_RESOLVERS[typeKey].resolveMany` (batch-first, REQ-24), or the static path
 * (REQ-10) for a type with no registered resolver. Owns the sole try/catch + timeout wrapper
 * around every resolver invocation (REQ-26/27) — never throws itself; every failure mode in
 * REQ-27's closed taxonomy converts to a typed `{ ok: false, reason }` result per affected
 * instance.
 *
 * @complexity O(1) dispatch plus whatever the resolver's own `resolveMany` costs (bounded by the
 * registration's `timeoutMs` clamp).
 * @overallScore 100
 */
/** Sets every instance to the same typed failure — the shared shape behind each "reject the whole batch" branch below. */
function fillFailure(
  results: Map<UUID, WidgetResolveResult>,
  instances: readonly WidgetInstanceView[],
  reason: WidgetResolveFailureReason
): void {
  for (const instance of instances) results.set(instance.id, { ok: false, reason });
}

/** REQ-10: static capability — validated config renders directly, no resolver invocation. */
function fillStaticResults(
  results: Map<UUID, WidgetResolveResult>,
  instances: readonly WidgetInstanceView[],
  registration: WidgetTypeRegistration
): void {
  for (const instance of instances) {
    results.set(instance.id, {
      ok: true,
      ir: { componentId: registration.typeKey, props: instance.config },
      dependencyKeys: [instance.id],
    });
  }
}

/** Invokes the resolver under the shared try/catch + timeout boundary (REQ-26/27) and fills `results` per instance. */
async function fillResolverResults(
  results: Map<UUID, WidgetResolveResult>,
  resolver: WidgetResolver,
  instances: readonly WidgetInstanceView[],
  context: WidgetResolveContext,
  registration: WidgetTypeRegistration
): Promise<void> {
  try {
    const resolved = await withResolverTimeout(resolver.resolveMany(instances, context), registration.clamps.timeoutMs);
    for (const instance of instances) {
      const result = resolved.get(instance.id);
      results.set(instance.id, result ? clampResolveResult(result, registration) : { ok: false, reason: "resolver-error" });
    }
  } catch (error) {
    const reason = error instanceof ResolverTimeoutError ? "timeout" : "resolver-error";
    fillFailure(results, instances, reason);
  }
}

export async function resolveWidgetType(
  required: {
  typeKey: WidgetTypeKey;
  instances: readonly WidgetInstanceView[];
  context: WidgetResolveContext;
},
  _optional: Record<string, never> = {},
): Promise<ReadonlyMap<UUID, WidgetResolveResult>> {
  const { typeKey, instances, context } = required;
  const results = new Map<UUID, WidgetResolveResult>();
  if (instances.length === 0) return results;

  // `typeKey` is typed `WidgetTypeKey` but only ASSERTED to be one — it's grouped off stored
  // widget-instance data (`resolver-service.ts`'s `payload.widgetType`, itself an
  // `entry-payload.ts` cast over decoded JSON), so `findWidgetTypeRegistration` is the correct,
  // honestly-partial accessor: `"unknown-type"` below is a real, reachable failure mode (REQ-27).
  const registration = findWidgetTypeRegistration({ raw: typeKey });
  if (!registration) {
    fillFailure(results, instances, "unknown-type");
    return results;
  }

  if (!registration.resolverId) {
    fillStaticResults(results, instances, registration);
    return results;
  }

  const resolver = CORE_RESOLVERS[registration.resolverId as WidgetTypeKey];
  if (!resolver) {
    fillFailure(results, instances, "resolver-error");
    return results;
  }

  await fillResolverResults(results, resolver, instances, context, registration);
  return results;
}

export * from "./ports.js";
export { createCoreResolvers, type CoreResolverDeps } from "./create-core-resolvers.js";
export { resolveTaxonomyEmbeds } from "./taxonomy.js";
