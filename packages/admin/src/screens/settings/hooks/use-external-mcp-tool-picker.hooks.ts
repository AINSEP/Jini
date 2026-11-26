import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdminRemoteToolSurfaceEntry } from "@jini-ai/core/contracts/hosted-mcp";

import { useFetchQuery } from "../../../react/kit.js";

import { countEnabledToolRows, describeProbeUnreachable, isToolPickerDirty, refreshToolRowDeclarations, seedToolPickerRows, setToolRowEnabled, setToolRowMayWrite, toolPickerFieldValues, type ToolPickerRow } from "../external-mcp-tool-picker-rules.js";

import { type Translate } from '@jini-ai/core/text';
import type { ExternalMcpProbeErrors } from "../external-mcp-tool-picker-rules.js";

/**
 * @file The transport and draft state behind `ExternalMcpToolPicker` — the `useX(deps)` /
 * `useWiredX()` pair this app uses everywhere, so the component composes the real port and a test
 * composes a plain fake (`use-external-mcp-admissions.hooks.ts` is the sibling precedent).
 *
 * ## The probe is gesture-gated, and that is a requirement rather than an optimisation
 *
 * `POST .../mcp-servers/:serverId/probe` (C-007) opens a real outbound MCP session on the operator's
 * own credentials and is rate-limited in front of its guard — the outline's W-001 records it as
 * "not idempotent (outbound call)". Probing every configured server on mount would therefore fire
 * one live third-party handshake per card every time anyone opened Settings. `enabled` keeps the
 * read gated on the operator actually opening this server's Tools tab, and `staleTime` keeps a tab
 * switch from re-probing a surface that has not changed.
 *
 * It is still a `useFetchQuery` rather than a `useFetchMutation` despite the POST: what it returns
 * is a READ of the vendor's advertised surface, it is cached per server, and the operator needs an
 * explicit re-read affordance (`refetch`) — all three of which are query semantics. The POST is a
 * transport detail of the route, not a statement that this call changes anything of ours. D-3 keeps
 * it out of the database entirely, so this cache is the only place a probe result lives.
 *
 * ## Why the draft is re-seeded from a signature rather than from object identity
 *
 * The panel re-renders on every roster poll, and an effect keyed on the probe's `tools` array or on
 * the row objects would re-seed the draft — silently discarding an operator's half-finished
 * selection across a 101-row list. {@link toolSurfaceSignature} reduces the inputs to the only thing
 * that should cause a re-seed: a genuinely different advertised surface, or a genuinely different
 * saved value. Re-rendering with the same server state leaves the draft alone.
 */

/** The one call this hook makes, injectable so a test composes it with a plain fake. */
export interface ExternalMcpToolPickerPort {
  probe(input: { serverId: string }, options?: Record<string, never>): Promise<{ tools: AdminRemoteToolSurfaceEntry[] }>;
}


export interface ExternalMcpToolPickerController {
  /** True only for the FIRST probe of this server — a later background re-read keeps the rows on
   *  screen rather than flashing the list back to a skeleton. */
  readonly loading: boolean;
  readonly refreshing: boolean;
  /** A sentence to render when the probe could not be made. The rows array is then empty, and the
   *  component says so rather than rendering an empty list that reads as "this server has no tools". */
  readonly unreachable: string | null;
  readonly rows: readonly ToolPickerRow[];
  /** How many advertised tools the server offers — the denominator of "N of M enabled". */
  readonly advertisedCount: number;
  readonly enabledCount: number;
  /** Whether the draft differs from what is saved. Save is offered only when this is true. */
  readonly dirty: boolean;
  setEnabled(remoteName: string, enabled: boolean): void;
  setMayWrite(remoteName: string, mayWrite: boolean): void;
  /** Throws away the draft and re-seeds from the saved fields. */
  reset(): void;
  /** Re-runs the probe against the live server. */
  refresh(): void;
  /** The draft as the two roster field values, for the caller's own `updateSource` patch. */
  fieldValues(): { allowedToolNames: string; writeAllowedToolNames: string };
}

/**
 * How long a probed surface is served without a background re-read. Long, and deliberately so: a
 * third-party server's advertised tool list changes on that vendor's release cadence, not on ours,
 * while every re-read is a live outbound handshake the operator is rate-limited on. The explicit
 * refresh affordance is what covers "it changed just now".
 */
const PROBE_STALE_TIME_MS = 5 * 60_000;

/** What a re-seed of the draft is allowed to key on — see this module's header on why object
 *  identity is the wrong trigger. Advertised names and the two saved field values, nothing else:
 *  a description change on a tool nobody has ticked must not discard a selection in progress. */
function toolSurfaceSignature(
  { tools, allowedToolNames, writeAllowedToolNames }: {
    tools: readonly AdminRemoteToolSurfaceEntry[];
    allowedToolNames: string | undefined;
    writeAllowedToolNames: string | undefined;
  },
  _options = {},
): string {
  return JSON.stringify([tools.map((tool) => tool.remoteName), allowedToolNames, writeAllowedToolNames]);
}

/** What the declarations pass keys on: every server-declared field of every advertised tool, so a
 *  vendor flipping `destructiveHint` on an existing name is seen even though {@link
 *  toolSurfaceSignature} (names only, on purpose) does not change. */
function toolDeclarationsSignature(tools: readonly AdminRemoteToolSurfaceEntry[]): string {
  return JSON.stringify(tools.map((tool) => [tool.remoteName, tool.description, tool.writeDeclared, tool.destructiveDeclared, tool.hintsAbsent]));
}

/**
 * @param deps.port - See {@link ExternalMcpToolPickerPort}.
 * @param deps.serverId - The roster row's own id, as the probe route's path parameter.
 * @param deps.active - Whether the operator is looking at this server's Tools tab. The probe does
 *   not run while this is false — see this module's header.
 * @param deps.allowedToolNames - The roster card's own field value, verbatim.
 * @param deps.writeAllowedToolNames - The roster card's own field value, verbatim.
 * @param deps.t - The picker's own drift-copy translator (`useExternalMcpDriftCopy`), threaded
 *   through so the `unreachable` message this hook derives is translated at the source rather than
 *   left to the component to re-wrap — see `describeProbeUnreachable`'s own doc.
 * @complexity O(t) per render in the server's advertised tool count.
 */
export function useExternalMcpToolPicker(deps: {
  port: ExternalMcpToolPickerPort;
  serverId: string;
  active: boolean;
  allowedToolNames: string | undefined;
  writeAllowedToolNames: string | undefined;
  t: Translate;
  /** The host's request-error vocabulary handed to the generic probe-failure wording. */
  errors: ExternalMcpProbeErrors;
}): ExternalMcpToolPickerController {
  const { port, serverId, active, allowedToolNames, writeAllowedToolNames, t, errors } = deps;

  const probe = useFetchQuery({
    key: ["external-mcp", "probe", serverId],
    fetch: () => port.probe({ serverId }),
  }, {
    enabled: active,
    staleTime: PROBE_STALE_TIME_MS,
  });

  const tools = useMemo(() => probe.data?.tools ?? [], [probe.data]);
  const signature = toolSurfaceSignature({ tools, allowedToolNames, writeAllowedToolNames });

  const [rows, setRows] = useState<ToolPickerRow[]>([]);
  // Read through a ref so the re-seed effect depends on the SIGNATURE alone. Depending on `tools`
  // or on the two field values directly would re-run it on every render that rebuilt the array,
  // which is the draft-clobbering this hook's header describes.
  const seedRef = useRef({ tools, allowedToolNames, writeAllowedToolNames });
  seedRef.current = { tools, allowedToolNames, writeAllowedToolNames };

  useEffect(() => {
    const seed = seedRef.current;
    setRows(seedToolPickerRows({ tools: seed.tools, allowedToolNames: seed.allowedToolNames, writeAllowedToolNames: seed.writeAllowedToolNames }));
  }, [signature]);

  // A refresh that changes a tool's annotations but not its name leaves `signature` alone, so the
  // draft is not re-seeded — but the rows must still pick up the new declarations, or a tool that
  // turns destructive keeps a stale unlocked row (`refreshToolRowDeclarations`'s doc). Declared after
  // the seed effect so, when both fire in one commit, this runs on the freshly seeded rows.
  const declarations = toolDeclarationsSignature(tools);
  useEffect(() => {
    const seed = seedRef.current;
    setRows((current) => refreshToolRowDeclarations({ rows: current, tools: seed.tools, allowedToolNames: seed.allowedToolNames, writeAllowedToolNames: seed.writeAllowedToolNames }));
  }, [declarations]);

  const reset = useCallback(() => {
    const seed = seedRef.current;
    setRows(seedToolPickerRows({ tools: seed.tools, allowedToolNames: seed.allowedToolNames, writeAllowedToolNames: seed.writeAllowedToolNames }));
  }, []);

  const setEnabled = useCallback((remoteName: string, enabled: boolean) => {
    setRows((current) => setToolRowEnabled({ rows: current, remoteName, enabled }));
  }, []);

  const setMayWrite = useCallback((remoteName: string, mayWrite: boolean) => {
    setRows((current) => setToolRowMayWrite({ rows: current, remoteName, mayWrite }));
  }, []);

  const fieldValues = useCallback(() => toolPickerFieldValues({ rows }), [rows]);

  return {
    loading: active && probe.status === "loading",
    refreshing: probe.isFetching,
    unreachable: probe.error ? describeProbeUnreachable({ error: probe.error, t, errors }) : null,
    rows,
    advertisedCount: tools.length,
    enabledCount: countEnabledToolRows({ rows }),
    dirty: isToolPickerDirty({ rows, allowedToolNames, writeAllowedToolNames }),
    setEnabled,
    setMayWrite,
    reset,
    refresh: probe.refetch,
    fieldValues,
  };
}

/** The signature the picker component takes as a required prop; the host binds `port` and `errors`. */
export type UseWiredExternalMcpToolPicker = (deps: {
  serverId: string;
  active: boolean;
  allowedToolNames: string | undefined;
  writeAllowedToolNames: string | undefined;
  t: Translate;
}) => ExternalMcpToolPickerController;
