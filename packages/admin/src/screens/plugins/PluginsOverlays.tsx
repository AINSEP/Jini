import type { PluginsController } from "./hooks/use-plugins.hooks.js";
import type { PluginsProps } from "./Plugins.js";
/** The package-files viewer, provider settings dialog and its toast, and the Remove confirm dialog. */
export function PluginsOverlays({ kit, hooks, deps, controller, settingsHandle, removeHandle }: { controller: PluginsController; settingsHandle: string | undefined; removeHandle: string | undefined } & Pick<PluginsProps, "kit" | "hooks" | "deps">) {

  const { Toast, PluginProviderSettingsDialog, PluginPackageFilesModal, PluginRemoveConfirmDialog } = kit;
  const { useWiredPluginPackageFiles, useWiredPluginProviderSettings, useProviderSettingsFocus } = hooks;
  const { pluginRules } = deps;
  const { t, inspectedPlugin, pendingRemovePlugin, settingsPlugin } = controller;
  return (
    <>
      {/* Injectable seam for the listing. Defaults to the real {@link useWiredPluginPackageFiles}. */}
      {inspectedPlugin ? <PluginPackageFilesModal plugin={inspectedPlugin} onClose={controller.onCloseInspector} useFiles={useWiredPluginPackageFiles} /> : null}

      {settingsPlugin && settingsHandle !== undefined ? (
        <PluginProviderSettingsDialog useSettings={useWiredPluginProviderSettings} useProviderSettingsFocusHook={useProviderSettingsFocus} plugin={settingsPlugin} agentHandleBase={settingsHandle} onClose={controller.onCloseSettings} onSaved={controller.onSettingsSaved} />
      ) : null}
      {/* A toast, like Themes' and Library's: it confirms what the owner just did and clears itself. */}
      {controller.settingsNotice ? <Toast message={controller.settingsNotice} role="status" tone="success" ttlMs={6000} onDismiss={controller.dismissSettingsNotice} /> : null}

      {pendingRemovePlugin && removeHandle !== undefined ? (
        <PluginRemoveConfirmDialog
          rules={pluginRules}
          name={pendingRemovePlugin.name}
          agentHandleBase={removeHandle}
          onConfirm={() => controller.onConfirmRemove(pendingRemovePlugin)}
          onCancel={controller.onCancelRemove}
          t={t}
        />
      ) : null}
    </>
  );
}

