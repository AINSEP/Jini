import { readAgentPluginPortableExtension } from "../lifecycle/manifest.js";
import { orFallback } from "@jini-ai/core/errors/idioms";
/**
 * @file Trusted-replacement supersession, declared by the replacing plugin and read generically.
 *
 * A bundled plugin that replaces older packages names them in its own `plugin.json` under
 * `extensions.jini.supersedes`:
 *
 * ```json
 * "supersedes": {
 *   "packages": ["old-package"],
 *   "contributions": [{ "fromPlugins": ["old-package", "other"], "descriptorId": "x", "label": "deploy target" }]
 * }
 * ```
 *
 * `packages` refuses every contribution from those packages; `contributions` refuses one descriptor
 * id from the named packages. Both apply only while the declaring plugin is a TRUSTED verdict for the
 * seam, so core never names a vendor — the knowledge lives in the plugin that owns it.
 *
 * Architectural role: `features/agent-plugins` policy over the lifecycle owner's trust verdicts.
 * Depends on injected manifest readers only; `lifecycle.ts` binds the production ones.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrustedPluginPackage, TrustedPluginVerdict } from "../lifecycle/index.js";

/** One descriptor id the successor provides instead of the named packages. */
export interface SupersededContribution {
  readonly fromPlugins: readonly string[];
  readonly descriptorId: string;
  /** Singular noun for refusal text, e.g. `"deploy target"`. */
  readonly label: string;
}
/** What one trusted plugin declares it supersedes. */
export interface PluginSupersession {
  readonly successorId: string;
  readonly packages: readonly string[];
  readonly contributions: readonly SupersededContribution[];
}
/** Reads a trusted plugin's manifest text; either may reject, which reads as "no declaration". */
export interface SupersessionManifestsPort {
  readonly readInstalled: (required: { readonly plugin: TrustedPluginPackage }) => Promise<string>;
  readonly readBundledSource: (required: { readonly pluginId: string }) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringList({ value }: { value: unknown }, _optional: Record<string, never> = {}): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value : undefined;
}
function parseContribution({ value }: { value: unknown }, _optional: Record<string, never> = {}): SupersededContribution | undefined {
  if (!isRecord(value)) return undefined;
  const fromPlugins = stringList({ value: value.fromPlugins });
  const { descriptorId, label } = value;
  if (fromPlugins === undefined || typeof descriptorId !== "string" || typeof label !== "string") return undefined;
  return { fromPlugins, descriptorId, label };
}
function parseJson({ text }: { text: string }, _optional: Record<string, never> = {}): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
function declaredSupersedes({ manifest }: { manifest: unknown }, _optional: Record<string, never> = {}): unknown {
  return readAgentPluginPortableExtension({ value: manifest })?.supersedes;
}

/** The manifest's declaration, or `undefined` when it has none or any part is malformed — a
 *  half-understood declaration must never refuse contributions it did not clearly name.
 *  @complexity O(n) in the declaration's entries. */
export function parseSupersedes(required: { readonly manifestText: string | undefined }, _optional: Record<string, never> = {}): Omit<PluginSupersession, "successorId"> | undefined {
  const declared = declaredSupersedes({ manifest: required.manifestText === undefined ? undefined : parseJson({ text: required.manifestText }) });
  if (!isRecord(declared)) return undefined;
  const packages = stringList({ value: declared.packages ?? [] });
  const rawContributions: unknown = declared.contributions ?? [];
  if (packages === undefined || !Array.isArray(rawContributions)) return undefined;
  const contributions = rawContributions.map((value) => parseContribution({ value }));
  if (contributions.some(entry => entry === undefined)) return undefined;
  return { packages, contributions: contributions as readonly SupersededContribution[] };
}

async function readOrUndefined({ read }: { read: () => Promise<string> }, _optional: Record<string, never> = {}): Promise<string | undefined> {
  return orFallback({ work: read, fallback: undefined, step: "read plugin supersession manifest" });
}

async function declaredBy(required: { readonly plugin: TrustedPluginPackage; readonly manifests: SupersessionManifestsPort }) {
  const { plugin, manifests } = required;
  const installed = parseSupersedes({ manifestText: await readOrUndefined({ read: () => manifests.readInstalled({ plugin }) }) });
  if (installed !== undefined) return installed;
  // A trusted package can predate its own declaration: the trust gate accepts the digest the
  // bundled-digest ledger last recorded, and a boot whose seed of the new version failed keeps the
  // previous one. The build's own source manifest for the same id is then the declaration.
  return parseSupersedes({ manifestText: await readOrUndefined({ read: () => manifests.readBundledSource({ pluginId: plugin.pluginId }) }) });
}

/** Every trusted verdict's declaration, in verdict order. Refusal verdicts never supersede.
 *  @complexity O(v) manifest reads, at most two per trusted verdict. */
export async function readSupersessions(required: { readonly verdicts: readonly TrustedPluginVerdict[]; readonly manifests: SupersessionManifestsPort }): Promise<readonly PluginSupersession[]> {
  const supersessions: PluginSupersession[] = [];
  for (const verdict of required.verdicts) {
    if (!("trusted" in verdict)) continue;
    const declared = await declaredBy({ plugin: verdict.trusted, manifests: required.manifests });
    if (declared !== undefined) supersessions.push({ successorId: verdict.trusted.pluginId, ...declared });
  }
  return supersessions;
}

/** The refusal for a whole superseded package, or `undefined`. */
export function supersededPackageRefusal(required: { readonly supersessions: readonly PluginSupersession[]; readonly pluginId: string }): string | undefined {
  const successor = required.supersessions.find(entry => entry.packages.includes(required.pluginId));
  return successor === undefined ? undefined : `contributions from '${required.pluginId}' were superseded by trusted '${successor.successorId}'`;
}

function descriptorIdOf({ descriptor }: { descriptor: unknown }, _optional: Record<string, never> = {}): unknown {
  return isRecord(descriptor) ? descriptor.id : undefined;
}

/** The refusal for one superseded descriptor from a named package, or `undefined`. */
export function supersededDescriptorRefusal(required: { readonly supersessions: readonly PluginSupersession[]; readonly pluginId: string; readonly descriptor: unknown }): string | undefined {
  const id = descriptorIdOf({ descriptor: required.descriptor });
  for (const successor of required.supersessions) {
    const hit = successor.contributions.find(entry => entry.descriptorId === id && entry.fromPlugins.includes(required.pluginId));
    if (hit !== undefined) return `${hit.label} '${hit.descriptorId}' is provided by the trusted '${successor.successorId}' replacement`;
  }
  return undefined;
}

/** Reads `<sourceRoot>/<pluginId>/plugin.json`. An id that is not a single path segment is refused
 *  so a manifest read can never leave the bundled source root. The host supplies the build's
 *  resolved bundled source root because a feature must not import the composition root. */
export function createBundledSourceManifestReader(
  required: { readonly bundledSourceRoot: string },
  optional: { readonly readText?: (filePath: string) => Promise<string> } = {},
): SupersessionManifestsPort["readBundledSource"] {
  const readText = optional.readText ?? (filePath => readFile(filePath, "utf8"));
  return async ({ pluginId }) => {
    if (pluginId === "" || path.basename(pluginId) !== pluginId || pluginId === "." || pluginId === "..") {
      throw new Error(`'${pluginId}' is not a bundled plugin directory name`);
    }
    return readText(path.join(required.bundledSourceRoot, pluginId, "plugin.json"));
  };
}
