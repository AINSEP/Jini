import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { createRequire } from "node:module";

// ESM has no ambient `require`; `node:sea` is loaded conditionally below (it
// throws outside a single-executable build) and `seaApi()` must stay
// synchronous, so a local `require` is synthesized rather than switching to
// dynamic `import()`.
const require = createRequire(import.meta.url);

export interface SeaApi {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
}

/**
 * @file Single-executable-build (`node:sea`) detection, shared by `admin-static.ts` (serving
 * SEA-embedded assets) and `admin-dev-proxy.ts` (never proxying to Vite from inside a packaged
 * build). Split out of `admin-static.ts` on 2026-09-16 to break the import cycle those two files
 * previously formed: `admin-static.ts` imported `createAdminDevProxyRequestHandler` from
 * `admin-dev-proxy.ts`, which imported `isSeaRuntime` back from `admin-static.ts`. Neither file
 * owns this predicate more than the other, so it now lives here instead of inside either one.
 */

/** Loads node:sea when running inside a single-executable build. */
export function seaApi(): SeaApi | null {
  return orFallbackSync({ work: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the optional SEA probe must stay synchronous and catch an unavailable module.
    const sea = require("node:sea") as SeaApi;
    return sea.isSea() ? sea : null;
  }, fallback: null, step: "Probe bundled runtime" });
}

/**
 * Whether this process is a packaged single-executable build. `admin-static.ts` and
 * `admin-dev-proxy.ts` both apply the same "SEA always wins" precedence and neither needs its own
 * copy of {@link seaApi}'s try/require dance.
 */
export function isSeaRuntime(): boolean {
  return seaApi() !== null;
}
