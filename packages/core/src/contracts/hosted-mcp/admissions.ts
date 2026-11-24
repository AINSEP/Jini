/** @agent-note Types only. The admin wire shape of the external-MCP admission report (a connection's advertised remote tools, which of them the admission gate admitted or refused, and saved rows that never connected), moved from the host admin so a Jini admin screen can type it. The runtime gate lives in `@jini-ai/mcp/federation`. */

/**
 * MCP's per-tool behaviour hints, exactly as a remote server declares them — mirrors
 * `packages/mcp/src/federation/ports.ts`'s `RemoteToolAnnotations` verbatim. Self-declared by the
 * thing being classified, so `mcp-federation/trust.ts` only ever lets these make a tool LESS
 * available, never more; see {@link AdminRemoteToolSurfaceEntry.hintsAbsent} for the gap that leaves.
 */
export interface AdminRemoteToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One of `packages/mcp/src/federation/trust.ts`'s `ToolRefusalReason` members — why the admission
 *  gate would not admit a given tool today. */
export type AdminToolRefusalReason =
  | "not-in-operator-allowlist"
  | "remote-declares-destructive"
  | "remote-declares-not-read-only"
  | "missing-or-invalid-input-schema"
  | "invalid-remote-tool-name"
  | "duplicate-remote-tool-name"
  | "connection-tool-cap-reached";

/**
 * One ADVERTISED remote tool, described as an operator-facing record for the (not-yet-built)
 * write-tool picker — mirrors `packages/mcp/src/federation/trust.ts`'s `RemoteToolSurfaceEntry` verbatim, field
 * names included, per `probeExternalMcpServer`'s response (C-007).
 *
 * Covers every tool the remote listed, admitted or not, so a future picker can show the operator
 * what they are choosing between rather than only what already cleared the gate.
 *
 * `hintsAbsent` MUST NOT be rendered as "read-only" by any consumer — it means the remote said
 * nothing about this tool, which is exactly the case a write can slip through unmarked today (see
 * `external-mcp-i18n.ts`'s header for the copy discipline this drives).
 */
export interface AdminRemoteToolSurfaceEntry {
  remoteName: string;
  description: string;
  declaredAnnotations?: AdminRemoteToolAnnotations;
  writeDeclared: boolean;
  destructiveDeclared: boolean;
  hintsAbsent: boolean;
  allowlisted: boolean;
  writeAllowed: boolean;
  admitted: boolean;
  refusalReason: AdminToolRefusalReason | null;
}

/** `POST .../mcp-servers/:serverId/probe`'s response shape (C-007) — a live, on-demand read of what
 *  the remote currently advertises. Never persisted server-side (a cache of third-party data does
 *  not belong on the security row — see `schema-decision.md` Part 1), so `probedAt` is this call's
 *  own timestamp, not a stored one. */
export interface AdminExternalMcpProbeResult {
  tools: AdminRemoteToolSurfaceEntry[];
  probedAt: string;
}

/**
 * One connection's live admission accounting from the RUNNING agent daemon — a subset of
 * `packages/mcp/src/federation/trust.ts`'s `FederatedAdmissionReport`, FLATTENED per connection by
 * `getExternalMcpAdmissions` (see {@link RawAdmissionConnection} for why that flattening
 * step exists and is not optional).
 *
 * `admitted` intentionally carries only what a drift banner needs (a name and whether it is
 * write-authorized), not the full `AdmittedFederatedTool` the daemon holds (which also carries a
 * `toolId` and the remote's raw input schema) — same "richer server shape, unread extra fields"
 * precedent {@link AdminMediaProviderCredentials} follows.
 */
export interface AdminFederatedAdmissionEntry {
  connectionId: string;
  admitted: { remoteName: string; writeAuthorized: boolean }[];
  refused: { remoteName: string; reason: AdminToolRefusalReason }[];
  /** Allowlisted names the remote never advertised — an operator's config drifting from the
   *  server's real surface. */
  allowlistedButAbsent: string[];
  /** Names write-authorized but not also allowlisted — a write grant that can never take effect. */
  writeAllowedButNotAllowlisted: string[];
  /**
   * Whether this connection came from a first-party plugin preset (`mcp-federation/presets.ts`)
   * rather than this workspace's editable roster — `AttachFederatedToolsResult.reports`'s own field,
   * relayed verbatim through two passthrough hops. `external-mcp-admissions-rules.ts` reads this to
   * tell "no roster card because this is a preset, by design" apart from "no roster card because the
   * operator deleted it" — both used to look identical (no roster card either way), which is why a
   * genuinely-deleted-but-still-live connection was silently reported as agreeing instead of as
   * drift (2026-09-07). Optional, not defaulted at this type's boundary: an older daemon build that
   * predates this field omits it, and `!entry.isPreset` already reads `undefined` the same as
   * `false` — the safe direction, since it means "warn about a live connection" rather than "stay
   * silent about one that might not be a preset".
   */
  isPreset?: boolean;
}

/**
 * One SAVED, enabled external-MCP row the daemon could not even attempt to connect — it never
 * reached `attachFederatedMcpTools` at all, so it has no matching {@link AdminFederatedAdmissionEntry}
 * either. Most commonly a sealed env block that failed to decrypt because the site key is not
 * available (`assistant/external-mcp-store.ts`'s `openExternalMcpEnv`).
 *
 * `reason` is the daemon's own operator-facing failure string
 * (`readEnabledExternalMcpConfigs`/`external-mcp-store.ts`) — already guaranteed secret-free by that
 * module's own contract (`admin-http/routes/external-mcp/probe.ts`'s INV-006 doc relays the
 * identical string to an operator today), never a raw stack trace or provider error. Even so,
 * `external-mcp-admissions-rules.ts` does not interpolate this string into the banner verbatim — it
 * classifies known reasons (today: a decrypt failure) into fixed, translated-or-English copy, and
 * falls back to the pre-existing generic message for anything it does not recognize, rather than
 * rendering server-authored text straight into UI copy.
 */
export interface AdminExternalMcpConfigFailure {
  connectionId: string;
  reason: string;
}

/** `GET .../mcp-servers/admissions`'s response shape (C-008), AFTER `getExternalMcpAdmissions`
 *  has flattened it — see {@link RawAdmissionConnection}. A down daemon is a 503 — see
 *  `getExternalMcpAdmissions`'s own doc — never an empty `connections` array, so "the
 *  assistant is not running" and "it is running with nothing admitted" stay distinguishable. */
export interface AdminExternalMcpAdmissionsSnapshot {
  connections: AdminFederatedAdmissionEntry[];
  /**
   * Optional and NOT defaulted to `[]` at this type's boundary — absent for an older daemon build
   * that predates this field (`federation-admissions-route.ts`'s own doc), the same "absent means
   * unknown, not zero" reasoning {@link AdminFederatedAdmissionEntry.isPreset} already uses one field
   * over. `external-mcp-admissions-rules.ts`'s `describeAdmissionDrift` treats a missing array the
   * same as an empty one (no known failures to report), so callers that never populate this — every
   * pre-existing test fixture included — keep behaving exactly as before.
   */
  configFailures?: AdminExternalMcpConfigFailure[];
}
