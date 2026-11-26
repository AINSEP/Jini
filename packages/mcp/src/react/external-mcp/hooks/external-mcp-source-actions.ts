import type { useExternalMcp, ExternalMcpPort, ExternalMcpController } from "./use-external-mcp.hooks.js";
import { toItem, toWriteBody, fieldOrEmpty, expectedVersionOf } from "./external-mcp-form.rules.js";
import type { AdminExternalMcpServer } from "@jini-ai/core/contracts/site/cms-external-mcp";
type SourceConfigItem = Awaited<ReturnType<ExternalMcpController["dependencies"]["port"]["fetchSources"]>>[number];

export async function checkSavedServer({ item, server, locale, port, deps }: { item: SourceConfigItem; server: AdminExternalMcpServer; locale: string; port: ExternalMcpPort; deps: Parameters<typeof useExternalMcp>[0]["deps"] }): Promise<SourceConfigItem> {
  let message = deps.credentialText({ id: 'saved', locale });
  if (server.transport !== 'stdio' && server.enabled) {
    try { await port.probeExternalMcpServer({ serverId: server.serverId }); message = deps.credentialText({ id: 'connected', locale }); }
    catch (err) { message = deps.translateCredentialMessage({ message: deps.describeApiError({ e: err, fallback: deps.credentialText({ id: 'unreachable', locale }) }), locale }); }
  }
  return { ...item, statusMessage: [item.statusMessage, message].filter(Boolean).join(' · ') };
}

/** The plain-words reason a save failed: the stale-version copy for a lost compare-and-set, else the server's own. @complexity O(1). */
function describeSaveFailure({ err, t, deps }: { err: unknown; t: (key: string) => string; deps: Parameters<typeof useExternalMcp>[0]["deps"] }, _options = {}): string {
  return deps.isVersionConflict({ error: err }) ? t(deps.VERSION_CONFLICT_MESSAGE) : deps.describeApiError({ e: err, fallback: t('That server could not be saved.') });
}

export async function fetchSources({ deps, port, locale, lastKnown }: { deps: Parameters<typeof useExternalMcp>[0]["deps"]; port: ExternalMcpPort; locale: string; lastKnown: { current: Map<string, SourceConfigItem> }; }, _optional = {}): Promise<SourceConfigItem[]> {
  const { servers } = await port.listExternalMcpServers();
  const items = servers.map(server => toItem({ server, deps }, { locale }));
  lastKnown.current = new Map(items.map((item) => [item.id, item]));
  return items;
}

export async function addSource({ input, deps, port, locale, lastKnown, setRestartRequired, t }: { input: { fields: Record<string, string>; trust?: string }; deps: Parameters<typeof useExternalMcp>[0]["deps"]; port: ExternalMcpPort; locale: string; lastKnown: { current: Map<string, SourceConfigItem> }; setRestartRequired: (value: boolean) => void; t: (key: string) => string; }, _optional = {}): Promise<{ ok: boolean; source?: SourceConfigItem; message?: string }> {
  const serverId = (input.fields.id ?? "").trim();
  if (serverId === "") return { ok: false, message: t("An ID is required.") };
  // The write is a create-OR-replace PUT, so an id already on the list would silently
  // replace that server's command, tool allowlists and auth instead of adding a new one.
  if (lastKnown.current.has(serverId)) {
    return { ok: false, message: t("A server with this ID already exists. Edit that server instead.") };
  }
  // An untouched transport saves as STDIO; require a header token only for hosted rows.
  if (deps.resolveExternalMcpEffectiveAuthMode(input.fields) === 'static_env' && deps.resolveExternalMcpEffectiveTransport(input.fields) !== 'stdio') {
    const tokenIssue = deps.credentialDraftError({ value: fieldOrEmpty({ fields: input.fields, key: 'accessToken' }) }, { locale, required: true });
    if (tokenIssue) return { ok: false, message: tokenIssue };
  }
  const oauthIdentityIssue = deps.validateExternalMcpOAuthIdentity(input.fields, { t });
  if (oauthIdentityIssue) return { ok: false, message: oauthIdentityIssue };
  try {
    const { server } = await port.saveExternalMcpServer({
      serverId,
      body: toWriteBody({ fields: input.fields, enabled: true, deps }, { ...(input.fields.label !== undefined && { label: input.fields.label }) }),
    });
    setRestartRequired(true);
    const item = toItem({ server, deps }, { locale });
    const checked = await checkSavedServer({ item, server, locale, port, deps });
    lastKnown.current.set(item.id, checked);
    return { ok: true, source: checked };
  } catch (e) {
    return { ok: false, message: deps.translateCredentialMessage({ message: deps.describeApiError({ e, fallback: t("That server could not be saved.") }), locale }) };
  }
}

export async function removeSource({ id, port, lastKnown, setRestartRequired }: { id: string; port: ExternalMcpPort; lastKnown: { current: Map<string, SourceConfigItem> }; setRestartRequired: (value: boolean) => void; }, _optional = {}): Promise<boolean> {
  try {
    await port.deleteExternalMcpServer({ serverId: id });
    setRestartRequired(true);
    lastKnown.current.delete(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the write behind whatever `updateSource` write for THIS SAME id is already in
 * flight (`writes.run(..., { key: id })`), so a second concurrent edit never reads
 * `lastKnown` until the first one has actually committed its own result there.
 *
 * The merge below is a read-then-write over `lastKnown` (see that ref's own doc), and
 * nothing else serializes two calls for the same id: `SourceConfigList` can fire a toggle
 * and a field-save close together (e.g. flipping "enabled" while a command edit is still
 * saving), and without this both reads see the SAME pre-write snapshot. Whichever write
 * then lands second wins outright — not merges — because it built its own full-row body
 * from a `previous` that never saw the first write's change, so the field the first write
 * touched (and the second's own patch never named) silently reverts the moment the second
 * write's response arrives. Keying the lane on `id` closes that: the second call's
 * `previous` read is delayed until the first call's `lastKnown.set` has actually run, so it
 * merges against the true current state instead of a stale one. Different ids are NOT
 * serialized against each other — they are independent rows with no shared merge base, and
 * each gets its own lane.
 */
export async function updateSource({ id, patch, deps, port, locale, lastKnown, setRestartRequired, writes, t }: { id: string; patch: { label?: string; enabled?: boolean; fields?: Record<string, string> }; deps: Parameters<typeof useExternalMcp>[0]["deps"]; port: ExternalMcpPort; locale: string;
  lastKnown: { current: Map<string, SourceConfigItem> }; setRestartRequired: (value: boolean) => void;
  writes: ReturnType<Parameters<typeof useExternalMcp>[0]["hooks"]["useSerialWrites"]>;
  t: (key: string) => string; }, _optional = {}): Promise<SourceConfigItem | null> {
  return writes.run({ task: async () => {
    const previous = lastKnown.current.get(id);
    const merged = deps.mergeSourceUpdate({ previous, patch });
    try {
      const { server } = await port.saveExternalMcpServer({ serverId: id, body: { ...toWriteBody({ fields: merged.fields, enabled: merged.enabled, deps }, { ...(merged.label !== undefined && { label: merged.label }) }), ...expectedVersionOf({ item: previous }) } });
      setRestartRequired(true);
      const item = toItem({ server, deps }, { locale });
      const changedToken = (merged.fields.accessToken ?? '') !== '';
      const checked = changedToken ? await checkSavedServer({ item, server, locale, port, deps }) : item;
      lastKnown.current.set(item.id, checked);
      return checked;
    } catch (err) {
      if (!previous) return null;
      return { ...previous, statusMessage: deps.translateCredentialMessage({ message: describeSaveFailure({ err, t, deps }), locale }) };
    }
  } }, { key: id });
}

/**
 * Wired to `probeExternalMcpServer` (C-007, outline §3.1 Source A / §3.5's D-5). Its only
 * effect is lighting up Jini's existing "Test" button — `useSourceConfigList.ts` derives
 * `capabilities.canTest` from `Boolean(port.testSource)`, so implementing this method is
 * what makes the button appear at all.
 *
 * `id` is `undefined` for the add-form's still-unsaved draft (Jini's generic "test before
 * save" case). The probe route addresses an already-persisted server by id, so there is
 * nothing to probe yet — this returns a failure rather than guessing at a URL/command the
 * operator has not saved.
 *
 * `SourceTestResult` cannot carry a tool list (`{ ok, message?, latencyMs? }`), so this is
 * a reachability check ONLY — it complements, and does not replace, the dedicated
 * `ExternalMcpToolPicker` (Phase 4), which reads `probeExternalMcpServer`'s full
 * `AdminRemoteToolSurfaceEntry[]` directly.
 *
 * The port's `draft` second parameter (unsaved field edits to test against, for an
 * already-persisted item) is deliberately not accepted: `probeExternalMcpServer` (C-007)
 * takes only a `serverId` path param and always connects using the server's LAST SAVED
 * `url`/`command`, so there is nothing here that could honor an edited-but-unsaved value —
 * testing an in-progress edit would require the probe route to accept a draft connection
 * target, which is out of this slice's scope.
 */
export async function testSource({ id, deps, port, locale, t }: { id: string | undefined; deps: Parameters<typeof useExternalMcp>[0]["deps"]; port: ExternalMcpPort; locale: string; t: (key: string) => string; }, _optional = {}): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
  if (id === undefined) {
    return { ok: false, message: t("Save this server before you can test it.") };
  }
  const startedAt = deps.now();
  try {
    const { tools } = await port.probeExternalMcpServer({ serverId: id });
    return {
      ok: true,
      message: `${tools.length} tool${tools.length === 1 ? "" : "s"} advertised.`,
      latencyMs: deps.now() - startedAt,
    };
  } catch (e) {
    return { ok: false, message: deps.translateCredentialMessage({ message: deps.describeApiError({ e, fallback: deps.credentialText({ id: "unreachable", locale }) }), locale }) };
  }
}

