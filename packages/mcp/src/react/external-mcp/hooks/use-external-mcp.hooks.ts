import { useCallback, useMemo, useRef, useState } from "react";
import type { AdminExternalMcpServer, AdminExternalMcpServerInput } from "@jini-ai/core/contracts/site/cms-external-mcp";
import { fetchSources, addSource, removeSource, updateSource, testSource } from "./external-mcp-source-actions.js";
export { describeStoredCredentials, toAccessTokenWriteBody } from "./external-mcp-form.rules.js";

export interface ExternalMcpController {
  dependencies: { port: {
    fetchSources: () => Promise<{ id: string; label?: string; trust?: string; enabled?: boolean; fields: Record<string, string>; status?: "idle" | "testing" | "connected" | "error"; statusMessage?: string }[]>;
    addSource: (input: { fields: Record<string, string>; trust?: string }) => Promise<{ ok: boolean; source?: Awaited<ReturnType<ExternalMcpController["dependencies"]["port"]["fetchSources"]>>[number]; message?: string }>;
    removeSource: (id: string) => Promise<boolean>;
    updateSource: (id: string, patch: { label?: string; enabled?: boolean; fields?: Record<string, string> }) => Promise<Awaited<ReturnType<ExternalMcpController["dependencies"]["port"]["fetchSources"]>>[number] | null>;
    testSource: (id: string | undefined) => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  } };
  /** Set once any write succeeds — federation only re-reads the roster at daemon boot. */
  restartRequired: boolean;
}

export interface ExternalMcpPort {
  listExternalMcpServers: () => Promise<{ servers: AdminExternalMcpServer[] }>;
  saveExternalMcpServer: (required: { serverId: string; body: AdminExternalMcpServerInput & { expectedVersion?: number } }) => Promise<{ server: AdminExternalMcpServer }>;
  deleteExternalMcpServer: (required: { serverId: string }) => Promise<{ removed: true; restartRequired: true }>;
  probeExternalMcpServer: (required: { serverId: string }) => Promise<{ tools: readonly unknown[] }>;
}

type SourceConfigItem = Awaited<ReturnType<ExternalMcpController["dependencies"]["port"]["fetchSources"]>>[number];

export async function checkSavedServer({ item, server, locale, port, deps }: { item: SourceConfigItem; server: AdminExternalMcpServer; locale: string; port: ExternalMcpPort; deps: Parameters<typeof useExternalMcp>[0]["deps"] }): Promise<SourceConfigItem> {
  let message = deps.credentialText({ id: 'saved', locale });
  if (server.transport !== 'stdio' && server.enabled) {
    try { await port.probeExternalMcpServer({ serverId: server.serverId }); message = deps.credentialText({ id: 'connected', locale }); }
    catch (err) { message = deps.translateCredentialMessage({ message: deps.describeApiError({ e: err, fallback: deps.credentialText({ id: 'unreachable', locale }) }), locale }); }
  }
  return { ...item, statusMessage: [item.statusMessage, message].filter(Boolean).join(' · ') };
}

export function useExternalMcp({ hooks, deps }: {
  hooks: {
    useAdminLocaleHook: () => string;
    useSerialWrites: () => { run: <T>(required: { task: () => Promise<T> }, optional?: { key?: string }) => Promise<T> };
  };
  deps: {
    port: ExternalMcpPort;
    credentialText: (required: { id: "set" | "saved" | "connected" | "unreachable"; locale: string }) => string;
    formatCredentialHint: (required: { hint: NonNullable<AdminExternalMcpServer["accessTokenHint"]>; locale: string }) => string;
    formatCredentialHints: (required: { hints: AdminExternalMcpServer["envTokenHints"]; locale: string }) => string;
    translateCredentialMessage: (required: { message: string; locale: string }) => string;
    credentialDraftError: (required: { value: string }, optional: { locale: string; required: boolean }) => string | null;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    VERSION_CONFLICT_MESSAGE: string;
    isVersionConflict: (required: { error: unknown }) => boolean;
    translate: (required: { locale: string; key: string }) => string;
    mergeSourceUpdate: (required: { previous: SourceConfigItem | undefined; patch: { label?: string; enabled?: boolean; fields?: Record<string, string> } }) => { fields: Record<string, string>; enabled: boolean; label?: string };
    resolveExternalMcpEffectiveAuthMode: (fields: Record<string, string>) => string;
    resolveExternalMcpEffectiveTransport: (fields: Record<string, string>) => string;
    validateExternalMcpOAuthIdentity: (fields: Record<string, string>, optional: { t: (key: string) => string }) => string | null;
    now: () => number;
  };
}, _optional = {}): ExternalMcpController {
  const { port } = deps;
  const { useAdminLocaleHook, useSerialWrites } = hooks;
  const [restartRequired, setRestartRequired] = useState(false);
  // `updateSource` receives a PARTIAL patch, but the write route replaces the whole row, so the
  // last-known field values are kept here to merge against. Without this, toggling `enabled` would
  // blank out `command` and the allowlist.
  const lastKnown = useRef(new Map<string, SourceConfigItem>());
  // Serializes `updateSource` writes per id, through `useSerialWrites`' keyed lanes — see that
  // method's own doc for the race this closes.
  const writes = useSerialWrites();
  // Same bound translator `ExternalMcpToolPicker.tsx` uses for this dictionary (Phase 2C) — reused
  // here rather than re-resolving the locale a second way, so `testSource`'s unreachable-server
  // fallback below stays word-for-word identical to the picker's own copy in every locale, not just
  // English.
  // The credential-safety contract now owns probe fallback copy; other tab copy still uses
  // the same dictionary translator as the picker, with the injected locale resolved once.
  const locale = useAdminLocaleHook();
  const t = useCallback((key: string) => deps.translate({ locale: locale, key: key }), [locale]);

  const dependencies = useMemo<ExternalMcpController["dependencies"]>(
    () => ({ port: {
      fetchSources: () => fetchSources({ deps, port, locale, lastKnown }),
      addSource: input => addSource({ input, deps, port, locale, lastKnown, setRestartRequired, t }),
      removeSource: id => removeSource({ id, port, lastKnown, setRestartRequired }),
      updateSource: (id, patch) => updateSource({ id, patch, deps, port, locale, lastKnown, setRestartRequired, writes, t }),
      testSource: id => testSource({ id, deps, port, locale, t }),
    } }),
    [t, writes, locale, port]
  );

  return { dependencies, restartRequired };
}

export function bindExternalMcp({ hooks, deps }: Parameters<typeof useExternalMcp>[0], _optional = {}) {
  return function useBoundExternalMcp(_required: Record<string, never>, _optional = {}): ExternalMcpController {
    return useExternalMcp({ hooks, deps });
  };
}
