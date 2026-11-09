import { adaptLegacyAuthorize, requireToolPermission, buildDomainRegistrations, indexCatalogById, ToolInputError, type DerivedRiskByToolId, type ToolRegistration } from '@jini-ai/core';
import { PluginInstallError } from '../plugin-tool-errors.js';
import type { PluginInstallerPort, PluginInstallInput, PluginInstallPreview } from '../node/install.js';
import type { PluginInstallToolsRequired } from './contract.js';


/** An installer refusal after the preview (lost race, busy lock, changed bytes) is relayable, not a crash. */
function refusedResult(error: PluginInstallError, pluginId: string, retryInstallHint: string): unknown {
  const retry = error.code === "PLUGIN_CHANGED_SINCE_PREVIEW" ? retryInstallHint : "";
  return { installed: false, pluginId, reason: error.code, note: `Nothing was installed: ${error.message}${retry}` };
}


/** Inspects the package before anything is written; an installer refusal is the caller's input problem. */
async function previewOrRefuse(required: {
  installer: PluginInstallerPort;
  input: PluginInstallInput }): Promise<PluginInstallPreview> {
  try { return await required.installer.preview(required.input); }
  catch (error) {
    if (error instanceof PluginInstallError) throw new ToolInputError({ message: `${error.code}: ${error.message}` });
    throw error;
  }
}


/** What the model relays after a successful install; the plugin always lands OFF. */
function installedResult<Request>(required: {
  plugin: PluginInstallPreview;
  deps: PluginInstallToolsRequired<Request> }): unknown {
  const { plugin } = required;
  return {
    installed: true, enabled: false,
    plugin: { id: plugin.id, name: plugin.name, version: plugin.version, tier: plugin.tier, ...(plugin.upgradeFrom ? { upgradeFrom: plugin.upgradeFrom } : {}) },
    warning: required.deps.riskSentence({ preview: plugin }),
    note: required.deps.messages.installedNote(plugin),
  };
}


/**
 * Order is load-bearing: authorize -> parse -> opt-in gate -> preview -> install with the previewed
 * digest. Preview runs first so an invalid package is refused before anything is written.
 * @complexity O(package bytes) twice (preview and install each inspect).
 */
export function buildPluginInstallRegistrations<Request>(deps: PluginInstallToolsRequired<Request>, _optional: Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ ...deps.registration,
    catalog: indexCatalogById({ catalog: deps.registration.catalog }),
    derivedRisk: pluginInstallDerivedRiskFor({ toolId: deps.toolId }),
    handlers: {
      [deps.toolId]: async (ctx) => {
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: deps.permission }, { entityType: deps.entityType });
        const request = deps.parseRequest({ input: ctx.input });
        const installer = deps.installer;
        if (!deps.localInstallEnabled() || !installer) {
          return { installed: false, reason: "PLUGIN_LOCAL_INSTALL_DISABLED", note: deps.messages.localInstallDisabledNote };
        }
        const input = await deps.installInput({ request, ownerId: ctx.principal.id, runId: ctx.run.id });
        const preview = await previewOrRefuse({ installer, input });
        try {
          const plugin = await installer.install({ ...input, expectedDigest: preview.digest });
          deps.telemetry?.installed({ principalId: ctx.principal.id, pluginId: plugin.id });
          return installedResult({ plugin, deps });
        } catch (error) {
          deps.telemetry?.installFailed({ principalId: ctx.principal.id, reasonClass: error instanceof PluginInstallError ? "refused" : "internal" });
          if (error instanceof PluginInstallError) return refusedResult(error, preview.id, deps.messages.retryInstallHint);
          throw error;
        }
      },
    },
  });
}


export function pluginInstallDerivedRiskFor({ toolId }: {
  toolId: string }, _optional = {}): DerivedRiskByToolId { return new Map([
  // -> pluginInstaller.install (installSitePlugin): copies the package into the site's plugin
  //    directory (replacing a version on replace:true). Durable file writes; nothing is executed and
  //    no network is used. Uninstalling (plugins_uninstall) is the inverse.
  [toolId, "mutates-durable-state"],
]); }
