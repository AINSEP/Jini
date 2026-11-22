/**
 * @file Real `ImageTransformerPort` / `ImageCodecPort` adapter — calls `sharp` to actually
 * resize/re-encode pixels (renditions are always re-encoded,
 * never passed through unmodified).
 *
 * `sharp` is an OPTIONAL runtime dependency of this package (mirrors
 * `packages/user-management/src/server/hasher.ts`'s treatment of `argon2`), not a hard one — a host that
 * only wants `InMemoryImageTransformer` (tests, or a build that has no need
 * for real pixel transforms) must not be forced to install a native binary
 * just by importing `./media`. Two consequences follow:
 *
 * 1. `sharp` is loaded via `node:module`'s `createRequire`, not a static
 *    `import`/`require` of the string `"sharp"` — this is what lets the
 *    module resolve and typecheck even in an environment/build where `sharp`
 *    is not installed at all. Nothing in this package's own `tsconfig.json`
 *    needs `sharp`'s types as a result: the narrow `SharpFactory`/
 *    `SharpInstance` shapes in the transformer entry are hand-declared and the loaded value is
 *    cast to them, exactly the same "not statically type-checked against the
 *    real package" contract the original of this adapter always had.
 * 2. The load is deferred to the moment a transform actually needs to run,
 *    not to module-evaluation time. This file is reachable from a host's
 *    request-serving import graph (wired into its route deps for the real
 *    running server), so a top-level import would throw `MODULE_NOT_FOUND`
 *    on every boot, for every request, even ones that never touch a
 *    transform, if `sharp` were ever absent. The lazy load scopes that
 *    failure mode to the one call site that needs it, surfaced as
 *    {@link ImageTransformUnavailableError} — a named, thrown error, not a
 *    silently-passed-through/faked image.
 */
import { createRequire } from "node:module";
import type { SharpFactory } from "../image-transformer.sharp.js";

const require = createRequire(import.meta.url);

// Node shares one native runtime across adapters. Weak keys avoid retaining injected factories.
const configuredSharpFactories = new WeakSet<SharpFactory>();

/** The default loader: a deferred, untyped `require("sharp")` (see file header for why). */
export function requireSharp(): SharpFactory {
  return require("sharp") as SharpFactory;
}

/** Configure a loaded native factory only after both controls succeed, permitting retries. */
export function configureSharpRuntime({ loadSharp }: { loadSharp: () => SharpFactory }, _optional: Record<string, never> = {}): SharpFactory {
  const factory = loadSharp();
  if (!configuredSharpFactories.has(factory)) {
    factory.cache?.(false);
    factory.concurrency?.(1);
    configuredSharpFactories.add(factory);
  }
  return factory;
}
