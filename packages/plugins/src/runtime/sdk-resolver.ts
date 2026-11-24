/**
 * @file `registerPluginSdkResolver()` — the boot-time SDK module-resolution hook.
 * The host SDK import aliases share the bundled SDK module below. They are virtual resolver
 * contracts, not standalone plugin npm packages.
 *
 * Purpose:
 * A plugin's prebuilt `server/index.mjs` does `import { definePlugin } from '<host sdk>'`, but
 * that file is dynamically `import()`-ed from `<install-dir>/plugins/<id>/<version>/server/
 * index.mjs` — a directory the runtime binary's own `node_modules` (where the SDK actually
 * lives) is not an ancestor of. Ordinary Node resolution will not find it. This function
 * registers Node's built-in module-customization hook (`node:module`'s `register()`, stable since
 * Node 18.19/20.6) so every SDK bare-specifier resolution — regardless of the importing file's
 * location on disk — redirects to the runtime's own bundled SDK build, `shortCircuit: true`
 * always winning over any incidental local `node_modules` a plugin might (maliciously or
 * accidentally) plant nearby.
 *
 * **Security constraint (binding):** this function must be called exactly once, synchronously,
 * during the host's boot sequence, BEFORE any route is registered and before any code path that
 * could reach a plugin load is wired into the running process. A plugin `import()` that occurs
 * before this hook exists falls through to ordinary Node resolution, which could resolve the SDK
 * to a plugin-planted local `node_modules` copy instead of the runtime's real one — defeating the
 * deep-import blocking by construction (a fake SDK build could re-export core internals freely).
 *
 * The host resolves its own SDK build on disk and passes the absolute path as `sdkModulePath`:
 * resolving a package by name from this dist would reach the wrong `node_modules`, so the path is
 * a required argument, never a default.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * The hook module's own source, registered via a `data:` URL rather than a separate file on disk.
 * Node's `module.register()` API requires the hooks module to be a real, independently-loadable
 * ESM module (it runs in a dedicated hooks realm, not this file's own scope) — a `data:
 * text/javascript,...` URL is a self-contained module specifier Node's ESM loader resolves
 * directly, so this mechanism needs no extra `.mjs` file to keep in sync with the compiled
 * `dist/` output. `initialize(data)` receives the values this hook needs at registration time
 * (the resolved SDK URL and accepted specifiers); `resolve()` redirects only the exact canonical
 * and legacy SDK specifiers — deep imports still go through ordinary package export checks.
 */
const HOOK_MODULE_SOURCE = `
let sdkUrl;
let sdkSpecifiers;
export function initialize(data) { sdkUrl = data.sdkUrl; sdkSpecifiers = data.sdkSpecifiers; }
export async function resolve(specifier, context, nextResolve) {
  if (sdkSpecifiers.includes(specifier)) { // legacy alias
    return { url: sdkUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

/** Process-wide registration marker. Keyed on `globalThis` (not module state) so the
 * exactly-once-per-process guarantee also holds if two copies of this module are loaded. */
const REGISTERED = Symbol.for("@jini-ai/plugins/runtime/sdk-resolver:registered");
const processSlots = globalThis as unknown as Record<symbol, true | undefined>;

/** Thrown by a second `registerPluginSdkResolver()` call in the same process — distinguishes the
 * intentional double-registration guard from any other failure, so a test can assert specifically
 * on THIS failure mode. */
export class PluginSdkResolverAlreadyRegisteredError extends Error {
  constructor() {
    super("registerPluginSdkResolver: already registered for this process — a second call is a boot-sequencing bug");
    this.name = "PluginSdkResolverAlreadyRegisteredError";
  }
}

/**
 * The `file://` URL the hook redirects to. A string that already is a valid `file:` URL is
 * normalized as a URL; any other string is an absolute filesystem path. Passing a URL string to
 * `pathToFileURL` would treat it as a path and percent-encode it into a wrong location.
 *
 * @throws {TypeError} If the string starts with `file:` but is not a valid URL.
 * @complexity O(n) in the path length.
 */
export function sdkModuleUrl(required: { sdkModulePath: string }, _optional: Record<string, never> = {}): string {
  return required.sdkModulePath.startsWith("file:") ? new URL(required.sdkModulePath).href : pathToFileURL(required.sdkModulePath).href;
}

/**
 * Registers the `module.register()` customization hook exactly once for this process. Calling
 * this a second time is a wiring bug, not a silently-tolerated no-op: it throws clearly, so a
 * boot-sequencing bug fails loudly rather than silently double-hooking.
 *
 * @param required.sdkModulePath Absolute path (or `file://` URL) to the runtime's own bundled SDK
 * build, resolved by the host.
 * @param required.sdkSpecifiers Every exact bare specifier redirected to that build (canonical plus
 * any legacy aliases the host still honours).
 * @throws If called more than once in the same process.
 */
export function registerPluginSdkResolver(
  required: { sdkModulePath: string; sdkSpecifiers: readonly string[] },
  _optional: Record<string, never> = {},
): void {
  // Exactly once per process — a second call is a boot-sequencing bug, never a silent no-op or a
  // silent double-hook.
  if (processSlots[REGISTERED]) {
    throw new PluginSdkResolverAlreadyRegisteredError();
  }

  const sdkUrl = sdkModuleUrl({ sdkModulePath: required.sdkModulePath });
  const hookModuleUrl = `data:text/javascript,${encodeURIComponent(HOOK_MODULE_SOURCE)}`;

  register(hookModuleUrl, { data: { sdkUrl, sdkSpecifiers: [...required.sdkSpecifiers] } });
  processSlots[REGISTERED] = true;
}
