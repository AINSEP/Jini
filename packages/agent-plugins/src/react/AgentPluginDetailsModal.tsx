import type { ComponentType, ReactNode, RefObject } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { AdminSurfaceBootstrap, AdminSurfaceActionOutcome } from "@jini-ai/core/contracts/site/agent-plugins-admin-surfaces";
import type { InspectedAgentPlugin } from "./use-agent-plugins.hooks.js";

type AgentPluginSurfaceSummary = NonNullable<InspectedAgentPlugin["surfaces"]>[number];
interface AgentPluginSurfacesPort {
  list(required: { readonly pluginId: string }, optional?: Record<string, never>): Promise<{ readonly surfaces: readonly AgentPluginSurfaceSummary[] }>;
  bootstrap(required: { readonly pluginId: string; readonly surfaceId: string }, optional?: Record<string, never>): Promise<AdminSurfaceBootstrap>;
  action(required: { readonly pluginId: string; readonly surfaceId: string; readonly action: string; readonly payload: unknown }, optional?: Record<string, never>): Promise<AdminSurfaceActionOutcome & { readonly hostSignIns?: readonly { readonly authorizationUrl: string; readonly expiresAt: string }[] }>;
}

export interface AgentPluginDetailsModalProps {
  readonly useAgentPluginMemoryHook: (required: { pluginId: string }, optional?: Record<string, never>) => {
    t: Translate;
    listing: { pluginId: string; learned: { relativePath: string; text: string }[]; notes: { relativePath: string; text: string }[]; limits: { learned: number; notes: number; files: number } } | null;
    entryPath: string; text: string;
    renamePath: (required: { entryPath: string }, optional?: {}) => void;
    openNote: (required: { entryPath: string }, optional?: {}) => void;
    setText: (required: { text: string }, optional?: {}) => void;
    save: () => Promise<void>;
    saving: boolean; status: string | null; editorDisabled: boolean;
    pathInputId: string; notesInputId: string; noteFilesHeadingId: string; learnedHeadingId: string;
    notesEmptyMessage: string | null; learnedEmptyMessage: string | null;
  };
  readonly useAgentPluginDetailsViewHook: (required: { displayName: string; t: Translate; memoryT: Translate }, optional?: {}) => { onView: (viewId: string) => void; title: string };
  readonly useAgentPluginSurfacesHook: (required: { readonly pluginId: string; readonly port: AgentPluginSurfacesPort }, optional?: Record<string, never>) => readonly AgentPluginSurfaceSummary[];
  readonly useHostAdminSurfaceFrame: (required: { readonly pluginId: string; readonly surface: AgentPluginSurfaceSummary; readonly port: AgentPluginSurfacesPort }, optional?: Record<string, never>) => {
    readonly attributes: { readonly src: string; readonly title: string; readonly sandbox: string; readonly referrerPolicy: "no-referrer" };
    readonly frameRef: RefObject<HTMLIFrameElement | null>;
    readonly status: "open" | "navigated" | "failed";
    readonly onLoad: () => void;
    readonly height: number | null;
    readonly signIns: readonly { readonly authorizationUrl: string; readonly expiresAt: string }[];
    readonly onSignInOpened: (link: { readonly authorizationUrl: string; readonly expiresAt: string }) => void;
  };
  readonly plugin: InspectedAgentPlugin;
  /** `AgentPlugins`' bound translator — the modal's title copy. */
  readonly t: Translate;
  readonly onClose: () => void;
  /** Injectable seam for the listing. Defaults to the real {@link useWiredAgentPluginDetailsModal};
   *  a test can pass a fake to exercise the modal's rendering with a fixed file list/selection. */
  readonly useDetails: (required: { pluginId: string }, optional?: Record<string, never>) => {
    files: readonly { readonly relativePath: string; readonly content: string | null; readonly unavailableReason?: string | null }[];
    selectedFile: { readonly relativePath: string; readonly content: string | null; readonly unavailableReason?: string | null } | null;
    selectFile: (relativePath: string) => void;
    status?: { readonly text: string; readonly role: "status" | "alert" } | null;
    listNotice?: string | null;
  };
  /** Plugin-owned admin surfaces (2026-10-20); a test passes a typed fake. */
  readonly surfacesPort: AgentPluginSurfacesPort;
  readonly kit: {
    AgentPluginMemoryPanel: ComponentType<{ controller: ReturnType<AgentPluginDetailsModalProps["useAgentPluginMemoryHook"]> }>;
    AgentPluginMaturity: ComponentType<{ maturity: InspectedAgentPlugin["maturity"]; t: Translate }>;
    AgentPluginSurfaceFrame: ComponentType<{ pluginId: string; surface: AgentPluginSurfaceSummary; port: AgentPluginSurfacesPort; t: Translate; useAdminSurfaceFrame: AgentPluginDetailsModalProps["useHostAdminSurfaceFrame"] }>;
    PackageFilesModal: ComponentType<{
      title: string; headerExtras: ReactNode; onView: (viewId: string) => void; initialViewId: string | undefined;
      files: ReturnType<AgentPluginDetailsModalProps["useDetails"]>["files"];
      selectedFile: ReturnType<AgentPluginDetailsModalProps["useDetails"]>["selectedFile"];
      onSelectFile: (relativePath: string) => void;
      status: { readonly text: string; readonly role: "status" | "alert" } | null;
      listNotice: string | null; handlePrefix: string; t: Translate;
      additionalViews: readonly { id: string; label: string; custom: ReactNode }[]; onClose: () => void;
    }>;
  };
}

/**
 * Inspection of one installed Agent Plugin's package files and editable project memory.
 *
 * Renders through the shared `PackageFilesModal` (2026-09-13), the same component the Plugins
 * screen's viewer uses. Since 2026-09-13 its content comes from `AGENT_PLUGIN_FILES` — the server
 * resolves the id against installed packages and reads inside that package root only, never
 * following a symlink — rather than a compile-time catalog that missed plugins nobody had listed.
 *
 * Since 2026-10-20 each admin surface the plugin contributes (for example its "Manage connection"
 * screen) is one more view after Memory, titled by the plugin and rendered sandboxed.
 */
export function AgentPluginDetailsModal({ plugin, t, onClose, useDetails, useAgentPluginMemoryHook, useAgentPluginDetailsViewHook, useAgentPluginSurfacesHook, surfacesPort, useHostAdminSurfaceFrame, kit: { AgentPluginMemoryPanel, AgentPluginMaturity, PackageFilesModal, AgentPluginSurfaceFrame } }: AgentPluginDetailsModalProps, _optional = {}) {
  const memory = useAgentPluginMemoryHook({ pluginId: plugin.id });
  const view = useAgentPluginDetailsViewHook({ displayName: plugin.displayName, t, memoryT: memory.t });
  const { files, selectedFile, selectFile, status = null, listNotice = null } = useDetails({ pluginId: plugin.id });
  const listed = useAgentPluginSurfacesHook({ pluginId: plugin.id, port: surfacesPort });
  // Opened from "Manage": the row already listed the screens, so the first render has their tabs
  // (the shell picks its starting view once, at mount).
  const surfaces = listed.length > 0 ? listed : plugin.surfaces ?? [];
  const firstSurface = plugin.surfaces?.[0];
  const surfaceViews = surfaces.map((surface) => ({
    id: `plugin-surface-${surface.id}`,
    label: surface.title,
    custom: <AgentPluginSurfaceFrame key={surface.id} pluginId={plugin.id} surface={surface} port={surfacesPort} t={t} useAdminSurfaceFrame={useHostAdminSurfaceFrame} />,
  }));

  return (
    <PackageFilesModal
      title={view.title}
      headerExtras={<AgentPluginMaturity maturity={plugin.maturity} t={t} />}
      onView={view.onView}
      initialViewId={firstSurface ? `plugin-surface-${firstSurface.id}` : undefined}
      files={files}
      selectedFile={selectedFile}
      onSelectFile={selectFile}
      status={status}
      listNotice={listNotice}
      handlePrefix="agent-plugin-file"
      t={t}
      additionalViews={[{ id: "plugin-memory", label: memory.t("Memory"), custom: <AgentPluginMemoryPanel controller={memory} /> }, ...surfaceViews]}
      onClose={onClose}
    />
  );
}
