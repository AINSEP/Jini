/**
 * @file The Tier-2 import policy: a Node module-resolution hook that limits what ONE Tier-2 plugin's
 * own modules may import inside its worker. Node adapter only (`node:module` `register()`).
 *
 * A module inside the plugin's package (the canonical root the host registered — an installed
 * package's root, or a built-in's declared sourceDir — which must contain the entry) may
 * import by name only the host's SDK specifiers plus any EXACT specifiers the host trusts for that
 * entry; `node:fs`, `child_process`, npm packages, `data:` modules and `#imports` are refused. A path
 * import must stay inside the package, or a `../..` climb would reach the same modules. Code outside
 * the package (the SDK build, a trusted host module, the host's own lazy imports) resolves as before.
 *
 * The host supplies the SDK specifiers and its trust decisions; Jini names no product module.
 * The SDK resolver is the host's own hook; this policy only allows its specifiers through, so the
 * two hooks give the same answer whichever is registered first.
 */
import { realpathSync } from "node:fs";
import { register as registerModuleHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** One host trust decision: the exact extra bare specifiers one registered entry's package may import. */
export interface Tier2TrustedImports {
  /** The registered entry module (path or `file:` URL), matched by real path. */
  readonly entryPath: string;
  /** Exact specifiers; no prefix or directory matching. */
  readonly specifiers: readonly string[];
}

/** The host's import policy for every Tier-2 worker it starts. */
export interface Tier2ImportPolicy {
  /** The SDK specifiers every plugin may import by name (the host's SDK and its aliases). */
  readonly sdkSpecifiers: readonly string[];
  /** Omitted ⇒ SDK-only for every entry. */
  readonly trustedImports?: readonly Tier2TrustedImports[];
}

/** What the hook receives through `initialize(data)`. */
export interface Tier2ImportPolicyData {
  /** `file:` URL of the plugin package, ending in `/`. */
  readonly packageUrl: string;
  readonly allowedSpecifiers: readonly string[];
  readonly sdkSpecifiers: readonly string[];
}

export interface Tier2ImportPolicyRequired {
  /** The entry the worker is about to import (path or `file:` URL). */
  readonly entryPath: string;
  /** The plugin's canonical package root from host registration (path or `file:` URL). */
  readonly packageRoot: string;
  readonly policy: Tier2ImportPolicy;
}

export interface RegisterTier2ImportPolicyOptional {
  /** Test seam over `node:module`'s `register()`. */
  readonly register?: (specifier: string, options: { readonly data: Tier2ImportPolicyData }) => void;
}

/** The hook module, registered as a `data:` URL so it needs no file kept in sync with `dist/`. */
const HOOK_MODULE_SOURCE = `
let packageUrl;
let allowedSpecifiers;
let sdkSpecifiers;
export function initialize(data) { packageUrl = data.packageUrl; allowedSpecifiers = data.allowedSpecifiers; sdkSpecifiers = data.sdkSpecifiers; }
function refuse(specifier, reason) {
  throw new Error("This plugin may not import " + JSON.stringify(specifier) + ": " + reason);
}
export async function resolve(specifier, context, nextResolve) {
  if (!String(context.parentURL).startsWith(packageUrl) || allowedSpecifiers.includes(specifier)) {
    return nextResolve(specifier, context);
  }
  if (!/^(\\.{0,2}\\/|file:)/.test(specifier)) {
    refuse(specifier, "a plugin may import only the plugin SDK (" + sdkSpecifiers.join(", ") + ") and its own files.");
  }
  const resolved = await nextResolve(specifier, context);
  if (!resolved.url.startsWith(packageUrl)) refuse(specifier, "it is outside its own package.");
  return resolved;
}
`;

function realEntryFile(entryPath: string): string {
  const filePath = entryPath.startsWith("file:") ? fileURLToPath(entryPath) : entryPath;
  try {
    // Real paths, because the loader reports a module's real path as its `parentURL`.
    return realpathSync(filePath);
  } catch (error) {
    // A missing entry fails at import with Node's own plain message; anything else is a real fault.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}

/**
 * Computes the hook's data for one entry. Throws for a malformed `file:` URL or an unreadable path,
 * which the worker start turns into an import-stage reply.
 *
 * @complexity O(t · path length) for t trusted entries.
 */
export function tier2ImportPolicyData(required: Tier2ImportPolicyRequired, _optional: Record<string, never> = {}): Tier2ImportPolicyData {
  const entryFile = realEntryFile(required.entryPath);
  const packageRoot = realEntryFile(required.packageRoot);
  const relative = path.relative(packageRoot, entryFile);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`The plugin entry ${JSON.stringify(entryFile)} is not inside its registered package ${JSON.stringify(packageRoot)}.`);
  }
  const { sdkSpecifiers, trustedImports = [] } = required.policy;
  const trusted = trustedImports.filter((decision) => realEntryFile(decision.entryPath) === entryFile).flatMap((decision) => decision.specifiers);
  return {
    packageUrl: pathToFileURL(packageRoot).href.replace(/\/?$/, "/"),
    allowedSpecifiers: [...sdkSpecifiers, ...trusted],
    sdkSpecifiers: [...sdkSpecifiers],
  };
}

/**
 * Registers the import policy for this worker's one plugin entry. Call once per worker, before the
 * plugin's first import; the data is computed before anything is registered.
 *
 * @complexity O(t · path length), see {@link tier2ImportPolicyData}.
 */
export function registerTier2ImportPolicy(required: Tier2ImportPolicyRequired, optional: RegisterTier2ImportPolicyOptional = {}): void {
  const data = tier2ImportPolicyData(required);
  const register = optional.register ?? ((specifier, options) => registerModuleHooks(specifier, options));
  register(`data:text/javascript,${encodeURIComponent(HOOK_MODULE_SOURCE)}`, { data });
}
