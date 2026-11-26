import { ToolInputError } from '@jini-ai/core';
import type { StaticPublishConfig, PublishCredentialSource } from './types.js';
import type { DeployTargetCredentialSpec, DeployTargetRegistry, LoadedDeployTarget, DeployTargetInspection } from '../deploy-targets/types.js';

type AdminPublishSiteDeps = {
  workspaceId: string;
  loadDeployTargets: (required: { workspaceId: string }) => Promise<DeployTargetRegistry>;
  refusal: (refusal: string) => void;
  unknownTargetMessage: (required: { registry: DeployTargetRegistry; targetId: string }) => string;
  readStaticPublishConfig: (required: { target: LoadedDeployTarget; raw: Record<string, unknown>; options: { blankAsAbsent: boolean } }) => { ok: true; config: StaticPublishConfig } | { ok: false; message: string };
  missingRequiredFieldMessage: (required: { target: LoadedDeployTarget; config: StaticPublishConfig }) => string | null;
  planStaticPublish: (required: { registry: DeployTargetRegistry; config: StaticPublishConfig }) => { ok: true; basePath?: string } | { ok: false; message: string };
  inspectStaticPublish: (required: { input: { workspaceId: string; config: StaticPublishConfig; projectName: string; credentialId?: string } }) => Promise<{ inspection?: DeployTargetInspection }>;
};
type PublishSiteContext = { deps: AdminPublishSiteDeps; credentialSource: PublishCredentialSource };

/**
 * Resolves `targetId` in this workspace's registry and reads its descriptor-declared config fields
 * from `raw`. Registry refusals (a module that did not load) are logged, never returned.
 * @returns The target and config, or a refusal naming the unknown target / the non-string field.
 * @complexity One registry load plus O(f) declared fields.
 */
export async function readTargetConfig({ deps, targetId, raw, blankAsAbsent }: { deps: AdminPublishSiteDeps; targetId: string; raw: Record<string, unknown>; blankAsAbsent: boolean }, _optional = {}): Promise<{ ok: true; registry: DeployTargetRegistry; target: LoadedDeployTarget; config: StaticPublishConfig } | { ok: false; error: string }> {
  const registry = await deps.loadDeployTargets({ workspaceId: deps.workspaceId });
  for (const refusal of registry.refusals) deps.refusal(refusal);
  const target = registry.get(targetId);
  if (target === undefined) return { ok: false, error: deps.unknownTargetMessage({ registry, targetId }) };
  const read = deps.readStaticPublishConfig({ target, raw, options: { blankAsAbsent } });
  if (!read.ok) return { ok: false, error: read.message };
  return { ok: true, registry, target, config: read.config };
}

/** A target's saved-credential form, as the admin renders it: the vendor's display name, the field
 *  specs (secret fields flagged, never a value), the form's help and token page, and which field is
 *  the token. Never the vendor id. @complexity O(1). */
function publicCredentialSpec(spec: DeployTargetCredentialSpec): {
  vendorLabel?: string;
  help?: string;
  userHelp?: string;
  tokenPageUrl?: string;
  tokenField: string;
  fields: DeployTargetCredentialSpec["fields"];
} {
  return {
    ...(spec.vendorLabel !== undefined ? { vendorLabel: spec.vendorLabel } : {}),
    ...(spec.help !== undefined ? { help: spec.help } : {}),
    ...(spec.userHelp !== undefined ? { userHelp: spec.userHelp } : {}),
    ...(spec.tokenPageUrl !== undefined ? { tokenPageUrl: spec.tokenPageUrl } : {}),
    tokenField: spec.tokenField,
    fields: spec.fields,
  };
}

export function credentialChoice({ value }: { value: unknown }, _options = {}): { credentialId?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError({ message: "credentialId must be a non-empty string naming the selected connection. Reload and choose it again." });
  return { credentialId: value };
}

/** The HTTP projection calls the same authenticated inspection used by the chat preview. */
export async function httpPublishPreview(required: {
  deps: AdminPublishSiteDeps; credentialSource: PublishCredentialSource; registry: DeployTargetRegistry;
  config: StaticPublishConfig; query: Record<string, unknown>;
}, _options = {}) {
  const { deps, credentialSource, registry, config, query } = required;
  const plan = deps.planStaticPublish({ registry, config });
  const credential = await credentialSource.isConfigured({ workspaceId: deps.workspaceId, target: config.target });
  const inspected = plan.ok && credential.configured ? await deps.inspectStaticPublish({
    input: { workspaceId: deps.workspaceId, config, projectName: typeof query.projectName === "string" ? query.projectName : "", ...credentialChoice({ value: query.credentialId }) },
  }) : {};
  return { target: config.target, valid: plan.ok, validationError: plan.ok ? null : plan.message,
    basePath: plan.ok ? (plan.basePath ?? null) : null, credentialsConfigured: credential.configured,
    credentialGuidance: credential.configured ? null : credential.reason,
    providerInspection: inspected.inspection };
}

/** The preview query's target + config, or the 400 message for whichever part is missing/invalid. */
export async function readPreviewTarget({ deps, query }: { deps: AdminPublishSiteDeps; query: Record<string, unknown> }): Promise<{ ok: true; read: Extract<Awaited<ReturnType<typeof readTargetConfig>>, { ok: true }> } | { ok: false; error: string }> {
  if (typeof query.target !== "string" || query.target.trim() === "") return { ok: false, error: "'target' query param (non-empty string) is required" };
  const read = await readTargetConfig({ deps, targetId: query.target, raw: query, blankAsAbsent: true });
  if (!read.ok) return { ok: false, error: read.error };
  // A required field that is absent is a malformed request (400); a present-but-invalid value is
  // an answer (200, `valid:false`) — the distinction the admin card renders.
  const missing = deps.missingRequiredFieldMessage({ target: read.target, config: read.config });
  return missing !== null ? { ok: false, error: missing } : { ok: true, read };
}

/**
 * The preview read the `publish/preview` spec (`@jini-ai/cms/admin-http/routes/system/publish-site/preview`)
 * is bound to: the same reads `deployment_preview_static_publish`'s handler performs (this file's
 * header) — the registry's plan (config check + base path) and local credential readiness. No export
 * runs. Authenticated provider inspection is separate from `isConfigured()` (2026-08-15 split, see
 * `static-publish/types.ts`'s `PublishCredentialSource` header) — a preview must never resolve a real
 * credential just to read a boolean off it. A `ToolInputError` from the inspection propagates: the spec
 * answers it `400 PROVIDER_INSPECTION_FAILED`.
 * @complexity One registry load plus the credential/inspection reads.
 */
export function publishPreviewFor({ context }: { context: PublishSiteContext }, _optional: Record<string, never> = {}) {
  const { deps, credentialSource } = context;
  return async ({ query }: { query: Readonly<Record<string, unknown>> }): Promise<{ ok: true; value: Awaited<ReturnType<typeof httpPublishPreview>> } | { ok: false; error: string }> => {
    const target = await readPreviewTarget({ deps, query: { ...query } });
    if (!target.ok) return { ok: false, error: target.error };
    return { ok: true, value: await httpPublishPreview({ deps, credentialSource, registry: target.read.registry, config: target.read.config, query: { ...query } }) };
  };
}

/** The registry's targets as the admin card's descriptors: ids, labels and field specs, never module paths. */
export function describePublishTargets({ registry }: { registry: DeployTargetRegistry }, _optional = {}) {
  return registry.list().map(({ descriptor }) => ({
    id: descriptor.id,
    label: descriptor.label,
    defaultForNewDestination: registry.get(descriptor.id)?.module.defaultForNewDestination === true,
    authenticatedPreview: registry.get(descriptor.id)?.module.preview !== undefined,
    configFields: descriptor.configFields,
    ...(descriptor.projectName !== undefined ? { projectName: descriptor.projectName } : {}),
    ...(descriptor.credential !== undefined ? { credential: publicCredentialSpec(descriptor.credential) } : {}),
    ...(descriptor.i18n !== undefined ? { i18n: descriptor.i18n } : {}),
  }));
}

