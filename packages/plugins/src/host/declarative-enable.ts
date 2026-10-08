/** Concrete content-type construction is host-owned. The required declaration port owns its
 * grammar, planning and application; this module owns ordering and deferred binding. */
/**
 * @file The enable path for a plugin's DECLARED contributions (AW-7 Tier 1): a `tier-1`
 * (manifest-only) plugin is applied from its manifest and never imported, and a code plugin that
 * also declares content types gets them.
 *
 * Runs inside `composePluginRuntime().onPluginEnabled` (`server/runtime/composition/plugin-runtime.ts`),
 * AFTER its conflict gate, so a declared content-type key is checked against every other plugin's
 * claims first (`plugin-claims.ts`, kind `content-type`). Boot re-attach skips tier-1 plugins: their
 * types were stored when they were turned on, and there is no code to load.
 *
 * Order for a code plugin with content types: plan (read-only) → load code → create types. A
 * conflict refuses the enable before the plugin's code is imported, and a failed load leaves no
 * types behind. A type that still fails to create (everything core would refuse is already refused
 * at discovery, so this is an infrastructure failure) unloads the code again, so a refused enable
 * never leaves a hook running. Types created before that failure stay: retain-by-default, and
 * tombstoning them would burn their keys for good (content-types INV-06); a later enable keeps them.
 */
import { PluginInvalidError } from "./activation.js";
import type { DeclarativeContentTypesPort, DeclaredContentTypePorts } from "./ports.js";
import type { PluginManifest } from "./manifest.js";

export interface EnableDeclaredPluginRequired {
  readonly declarativeContentTypes: DeclarativeContentTypesPort;
  readonly pluginId: string;
  readonly workspaceId: string;
  /** The discovery record's manifest — already through `validateManifest`, declarations included. */
  readonly manifest: PluginManifest;
  /** Loads and attaches the plugin's code (the runtime's own load path). Never called for tier-1. */
  readonly loadCode: () => Promise<void>;
  /** Detaches what `loadCode` attached — called only when a content type fails to create after it. */
  readonly unloadCode: () => void;
}

export interface EnableDeclaredPluginOptional {
  /** Where declared content types are created. Omitted (a composition with no content-type store)
   *  ⇒ a plugin that declares any is refused rather than enabled without them. */
  readonly contentTypes?: DeclaredContentTypePorts;
}

/**
 * Turns one plugin on around its declarations. A plugin that declares no content types is just
 * `loadCode()` (tier-1 with none: nothing at all). Content-type conflicts with what the site
 * already has throw `PluginInvalidError` (the enable route maps it to 422; `setPluginEnabled`
 * restores the prior activation row).
 *
 * @complexity O(t) port reads/writes over the manifest's declared types (bounded, ≤ 20).
 */
export async function enableDeclaredPlugin(required: EnableDeclaredPluginRequired, optional: EnableDeclaredPluginOptional = {}): Promise<void> {
  const { pluginId, workspaceId, manifest, loadCode } = required;
  // ADR-024 §1: a Tier-1 plugin is zero executable code — the runtime never imports anything for it.
  const load = manifest.tier === "tier-1" ? async () => {} : loadCode;
  const { decls } = required.declarativeContentTypes.parse({ value: manifest.contentTypes });
  if (decls.length === 0) return load();
  const ports = optional.contentTypes;
  if (!ports) throw new PluginInvalidError(`plugin '${pluginId}' declares content types, but this site cannot create them`);

  const plan = await required.declarativeContentTypes.plan({ ports, workspaceId, decls });
  if (plan.conflicts.length > 0) {
    throw new PluginInvalidError(`plugin '${pluginId}' cannot be turned on: ${plan.conflicts.join("; ")}`);
  }
  await load();
  try {
    await required.declarativeContentTypes.apply({ ports, workspaceId, pluginId, plan });
  } catch (error) {
    required.unloadCode();
    throw error;
  }
}

/**
 * Binds the host's `registerContentType` for the provisioner. `authorize` always allows, on purpose: the
 * real authorization already happened one layer up — turning a plugin on requires the plugin-manage
 * permission and the owner's consent, and these types are what that consented action declares
 * (the same reasoning as widgets' `PRE_AUTHORIZED`). The write is recorded as `principalKind:
 * "system"` with the plugin as actor, so the revision log says no human typed this schema.
 */
// createDeclaredContentTypePorts stays at the host composition boundary with the core write service.

/**
 * Ports built on first use. Both composition roots compose the plugin runtime before their
 * content-type repo and outbox exist (top-level composition is synchronous and enable never runs
 * during it), so they hand the runtime this and bind the real ports where those are declared.
 */
export function deferDeclaredContentTypePorts(required: { build: () => DeclaredContentTypePorts }, _optional: Record<string, never> = {}): DeclaredContentTypePorts {
  let ports: DeclaredContentTypePorts | undefined;
  const resolve = () => (ports ??= required.build());
  return {
    findByKey: (params) => resolve().findByKey(params),
    register: (input) => resolve().register(input),
  };
}
