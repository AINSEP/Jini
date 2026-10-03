export interface RemoteToolAnnotations {
  readonly title?: string | undefined;
  readonly readOnlyHint?: boolean | undefined;
  readonly destructiveHint?: boolean | undefined;
  readonly idempotentHint?: boolean | undefined;
  readonly openWorldHint?: boolean | undefined;
}

/** One entry of a remote server's `tools/list` response. Every field is attacker-controlled. */
export interface RemoteToolDescriptor {
  readonly name: string;
  readonly description?: string | undefined;
  /** JSON Schema, as published by the remote. `trust.ts` refuses any tool whose schema is not a
   * JSON-Schema object — a schema-less tool is refused for federated tools for the same reason
   * `buildDomainRegistrations` refuses one for native tools. */
  readonly inputSchema?: unknown | undefined;
  readonly annotations?: RemoteToolAnnotations | undefined;
}

/** One `tools/call` response. `isError` is the remote's own claim about its own outcome. */
export interface RemoteToolResult {
  readonly content?: unknown | undefined;
  readonly structuredContent?: unknown | undefined;
  readonly isError?: boolean | undefined;
}

/**
 * An established MCP client session against one remote server.
 *
 * Intentionally three methods and no more: this is the entire surface federation needs. MCP's
 * resources/prompts/sampling/roots are all deliberately out of scope — sampling in particular would
 * let a remote server drive inference on host app's account, which is a far larger grant than "expose
 * some tools" and is not something this pass builds a trust story for.
 */
export interface McpSessionPort {
  /** The remote's advertised tool surface, already paginated to completion by the adapter. */
  listTools(): Promise<RemoteToolDescriptor[]>;
  callTool(request: McpToolCallRequiredArgs, options?: McpToolCallOptions): Promise<RemoteToolResult>;
  close(required: Record<string, never>): Promise<void>;
}

/**
 * The byte-level seam under `adapter.stdio.ts`: a bidirectional stream of newline-delimited
 * JSON-RPC 2.0 messages.
 *
 * Deliberately dumb — it knows about lines, not about MCP. All protocol knowledge (handshake
 * ordering, id correlation, pagination, timeouts) lives in the adapter above it, which is what
 * makes that knowledge testable without a child process.
 */
export interface McpStdioChannel {
  /** Writes one JSON-RPC message. Implementations append the framing newline themselves. */
  send({ message }: { message: string }): void;
  /** Registers the sink for inbound messages, one complete JSON value per call. */
  onMessage({ listener }: { listener: (required: { message: string }) => void }): void;
  /** Registers the sink for "this channel is gone" — process exit, stream error, explicit close. */
  onClose({ listener }: { listener: (required: { reason: string }) => void }): void;
  close(required: Record<string, never>): void;
}

/**
 * One site owner's configured federated connection.
 *
 * `allowedToolNames` is the load-bearing field and has NO safe default at this layer: an empty
 * allowlist yields zero federated tools, which is the correct behaviour for a misconfigured
 * connection. A DEFAULT is a per-vendor judgement and therefore belongs to a vendor preset, not
 * here — an Agent Plugin's `mcp.json` `defaultTools` is the current example, authored from the
 * server's real tool surface, which is what makes it an independent classification rather than a
 * restatement of the remote's own claims.
 */
/**
 * Where one connection's config came from — stamped once, at admission, and carried unchanged into
 * every later `tools/call`. `external-mcp-revocation.ts`'s per-call gate is the one consumer: a
 * preset gets only the legacy OAuth `needs_reauth` check (it has no roster row to compare against);
 * a roster connection is re-checked against its CURRENT row every call, keyed by
 * `admissionRevision` — see that file's `rosterRefusalFor`.
 */
export type FederatedConnectionOrigin =
  | { readonly kind: "preset" }
  | { readonly kind: "roster"; readonly admissionRevision: string };

export interface FederatedMcpConnectionConfig {
  /** Operator-chosen, stable, `[a-z0-9-]`. Becomes part of every federated tool id, so renaming it
   * renames every tool the model sees — pick once. */
  readonly connectionId: string;
  /** Human-readable, shown to the model as provenance on every federated tool description. */
  readonly label: string;
  /** DEFAULT-DENY allowlist of REMOTE tool names (pre-namespacing). */
  readonly allowedToolNames: readonly string[];
  /** Remote names reviewed in a bundled plugin's mcp.json, independent of admission grants.
   * Remote readOnlyHint:false or destructiveHint:true vetoes each declaration. */
  readonly readOnlyRemoteNames?: ReadonlySet<string> | undefined;
  /**
   * SECOND list of REMOTE tool names (pre-namespacing) the operator has separately declared as
   * writes. Kept for configuration compatibility and admission reports, independently of
   * {@link allowedToolNames}. The allowlist alone gates admission; this list does not grant or
   * refuse calls. Descriptor read-only classification and host permissions remain separate gates.
   *
   * Same "no safe default at this layer" rule as {@link allowedToolNames}: every connection that has
   * never been told to allow a write must resolve to an empty list here, and a vendor preset that
   * wants a non-empty default authors it itself, on purpose, the same way
   * an Agent Plugin's `defaultTools.write` is authored rather than inherited from the remote.
   *
   * Destructive tools may be admitted from the allowlist, but protected actions still require
   * per-call confirmation. Ordinary writes and absent annotations do not require a card. See
   * `trust.ts` R3: hints cannot grant admission, and input names alone are not consent evidence.
   */
  readonly writeAllowedToolNames: readonly string[];
  /** How long the initialize+list handshake may take before federation is abandoned for this boot. */
  readonly connectTimeoutMs: number;
  /** Per-`tools/call` ceiling. */
  readonly callTimeoutMs: number;
  /** UTF-8 cap on the serialized text payload before wrapping, and separately on the aggregate
   * serialized image array per result. Wrapper text is outside these two budgets. */
  readonly maxResultBytes: number;
  /** Hard cap on how many tools this connection may contribute, whatever the remote advertises. */
  readonly maxTools: number;
  /** Stamped by `bootstrap.ts` (presets, via `withPresetOrigin`) or `external-mcp-store.ts`'s
   *  `toResolvedFederatedConnections` (roster rows) — never by anything else. Optional only so a
   *  fixture predating this field still type-checks; `external-mcp-revocation.ts`'s gate treats a
   *  non-preset call with no origin as `unverifiable` rather than assuming either source. */
  readonly origin?: FederatedConnectionOrigin | undefined;
}

/** One federated tool call's identity, as `mcp-federation/registrations.ts`'s handler hands it to
 *  `FederationDeps.assertConnectionUsable` — everything `external-mcp-revocation.ts`'s per-call gate
 *  needs to re-check an admitted tool against the connection's CURRENT row, without re-deriving any
 *  of it from the registry. Keys are required (may be `undefined`) rather than optional, so the
 *  shape is safe to build under `exactOptionalPropertyTypes`. */
export interface FederatedCallTarget {
  /** The remote's own tool name (pre-namespacing) — what the operator's allowlist and write list
   *  name. */
  readonly remoteName: string;
  /** Exactly what was recorded at admission (`AdmittedFederatedTool.declaredAnnotations`) — never
   *  re-read from the remote on this path. */
  readonly declaredAnnotations: RemoteToolDescriptor["annotations"] | undefined;
  readonly origin: FederatedConnectionOrigin | undefined;
}

/** How a locally-launched federated connection is started.
 *
 * See {@link McpHttpLaunchSpec} for the hosted counterpart, and {@link McpLaunchSpec} for why the
 * two are a union rather than one shape with optional halves. */
export interface McpStdioLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** Child-process-only environment. Secrets belong here and NOWHERE else — never in `args`, which
   * are world-readable in `/proc/<pid>/cmdline` on Linux and in `ps` output everywhere. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string | undefined;
}

/**
 * How a HOSTED federated connection is reached: one URL, plus the headers that authenticate to it.
 *
 * `headers` is where an OAuth access token arrives, as `Authorization: Bearer ...`, and it is the
 * hosted analogue of {@link McpStdioLaunchSpec.env}'s "secrets belong here and NOWHERE else" rule —
 * never in `url`, which is logged by proxies, kept in browser history when an operator pastes it,
 * and stored in plaintext on the connection row.
 *
 * Deliberately a plain header bag rather than a token field: this layer should not know that OAuth
 * exists. It is handed headers and sends them. Which credential produced them, whether it can be
 * refreshed, and what to do when it expires are all `assistant/external-mcp-oauth.ts`'s questions,
 * decided before a launch spec is ever built.
 */
export interface McpHttpLaunchSpec {
  /** Absolute `https:` URL of the server's MCP endpoint (`http:` only for loopback — enforced at
   * save time by `external-mcp-store.ts`, not here). */
  readonly url: string;
  /** Sent on every request to the endpoint. Carries the bearer token, when there is one. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * How a federated connection is reached, whichever transport it uses.
 *
 * A union rather than one struct with optional `command`/`url`, because the two are genuinely
 * exclusive: a spec carrying both is not a degraded configuration to be tolerated, it is a bug, and
 * a union makes that unrepresentable instead of a runtime check somebody has to remember to write.
 *
 * Narrow with {@link isHttpLaunchSpec}.
 */
export type McpLaunchSpec = McpStdioLaunchSpec | McpHttpLaunchSpec;

/** Narrows a {@link McpLaunchSpec} to its hosted arm. */
export function isHttpLaunchSpec(input: { spec: McpLaunchSpec }): input is { spec: McpHttpLaunchSpec } {
  return "url" in input.spec;
}

/**
 * The byte-level seam under `adapter.http.ts`, and the hosted counterpart to
 * {@link McpStdioChannel}: one request/response exchange against the server's MCP endpoint.
 *
 * Deliberately narrower than `fetch`: a function that takes a body and returns a status, a content
 * type, a couple of named headers, and text. That is everything the Streamable HTTP transport
 * needs, and shrinking the seam is what lets the adapter's real protocol behaviour — handshake
 * ordering, session-id propagation, SSE framing, pagination, error mapping — be tested against a
 * scripted double instead of a live server, exactly as the stdio adapter's channel seam does.
 */
export interface McpHttpExchange {
  send(request: McpHttpRequestRequiredArgs, options?: McpHttpRequestOptions): Promise<McpHttpResponse>;
}

/** One response from an {@link McpHttpExchange}. */
export interface McpHttpResponse {
  readonly status: number;
  /** Lowercased `content-type`, value only — parameters such as `; charset=utf-8` may be present
   * and the adapter matches on the prefix. */
  readonly contentType: string;
  /** The server's `Mcp-Session-Id`, when it issued one. */
  readonly sessionId?: string | undefined;
  /** The full body. Bounded by the adapter's own cap before it is parsed. */
  readonly text: string;
  readonly wwwAuthenticate?: string | undefined;
}

/**
 * What a per-call confirmation card (G3, `trust.ts` R3) is asked to show, as
 * `mcp-federation/registrations.ts`'s handler hands it to `FederationDeps.confirmCall`.
 *
 * `arguments` is the exact, already-frozen object that will be sent on Confirm — the handler builds it
 * once, before the card is drawn, and sends that same object afterwards, so the card can never show
 * one thing while the remote receives another.
 */
export interface FederatedCallConfirmationRequest {
  /** The namespaced registry id (`mcp__<connection>__<name>`) — the card's clicks are routed back to it. */
  readonly toolId: string;
  readonly remoteName: string;
  readonly connectionId: string;
  /** The operator's label for the connection, e.g. "Supabase" — the "target" the card names. */
  readonly connectionLabel: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** The remote declared `destructiveHint: true` — the card carries the stronger, danger-styled warning. */
  readonly destructive: boolean;
  /**
   * The hints recorded when the tool was admitted, and where its connection came from — the tool
   * identity a remembered approval ("Allow for this chat", "Always allow") is pinned to
   * (`assistant/external-mcp-tool-approvals.ts`), so a changed server, name or hints asks again.
   */
  readonly declaredAnnotations: RemoteToolDescriptor["annotations"] | undefined;
  readonly origin: FederatedConnectionOrigin | undefined;
  /** The description the model reads (`AdmittedFederatedTool.description`) and the input schema, as
   *  admitted — also part of that identity, so a drifted description or schema asks again. */
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * Input names, in the schema or in this call's arguments, that look like writes (`trust.ts`
   * `WRITE_SHAPED_INPUT_WORDS`), sorted. These names describe an already-required protected-action
   * card; names alone do not require one. On such a card, non-empty names disable remembered
   * approval so the person reviews the actual input for that call.
   */
  readonly writeShapedInputs: readonly string[];
}

/**
 * The human's answer. Only an explicit Confirm is `{ confirmed: true }`; anything else carries the
 * model-facing result that replaces the call (cancelled, expired, or the run ended).
 */
export type FederatedCallConfirmationOutcome =
  | { readonly confirmed: true }
  | { readonly confirmed: false; readonly result: Readonly<Record<string, unknown>> };

/** Host identity sent during initialization; there is no product default. */
export interface McpClientInfo { readonly name: string; readonly version: string; }

export type RemoteToolDescriptorAnnotations = RemoteToolDescriptor["annotations"];

/** Required wire payload and optional per-call cancellation. */
export interface McpToolCallRequiredArgs { readonly name: string; readonly arguments: Record<string, unknown> }
export interface McpToolCallOptions { readonly signal?: AbortSignal | undefined }
export interface McpHttpRequestRequiredArgs {
  readonly url: string; readonly method: "POST" | "DELETE"; readonly headers: Readonly<Record<string, string>>;
}
export interface McpHttpRequestOptions { readonly body?: string | undefined; readonly signal?: AbortSignal | undefined }
