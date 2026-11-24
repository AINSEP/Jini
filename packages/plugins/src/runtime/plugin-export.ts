/**
 * @file `readDefinedPlugin()` — the one check that a plugin module's default export is a real
 * `definePlugin()` value. Shared by `Jini/packages/plugins/src/host/node/loader.ts` (step 4, in-process) and the Tier-2 worker
 * (`Jini/packages/plugins/src/host/worker/run-call.ts`), and kept in its own dependency-free module so the worker does not have to
 * load the loader's install/snapshot/hashing graph just to validate an export.
 */
import type { DefinedPlugin as Plugin } from "@jini-ai/core/contracts/plugin-sdk";

/** `definePlugin()`'s runtime return shape. A plain `{ setup() {} }` export is deliberately not
 * accepted: only the SDK helper's opaque `{ definition }` wrapper is a valid plugin ABI value. */
export function readDefinedPlugin({ moduleValue }: { moduleValue: unknown }, _optional = {}): Plugin | null {
  if (typeof moduleValue !== "object" || moduleValue === null) return null;
  const candidate = (moduleValue as { default?: unknown }).default;
  if (typeof candidate !== "object" || candidate === null) return null;
  const definition = (candidate as { definition?: unknown }).definition;
  if (typeof definition !== "object" || definition === null) return null;
  return typeof (definition as { setup?: unknown }).setup === "function" ? (candidate as Plugin) : null;
}
