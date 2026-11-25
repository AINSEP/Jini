/**
 * @file The External MCP domain's agent-tool catalog (SPEC-016 REQ-22 naming/callability
 * convention — the same shape `features/site-inspection/agent-tools.ts` and every other domain
 * catalog already use).
 *
 * ## Why this domain exists
 *
 * The owner's ask: a non-technical site owner should be able to type "connect me to Higgsfield"
 * into the admin assistant chat and have the agent configure the external MCP server itself,
 * asking only for what it genuinely cannot know. The host's external MCP settings form (the admin form) already lets a human do this by
 * hand; these five tools are the same capability, reachable by the agent.
 *
 * ## Five tools, not one CRUD tool per field
 *
 * - `content_read.external_mcp` — read. What is configured, never a secret value.
 * - `external_mcp_save` — the ONE write tool for both "add a new server" and "update an existing
 *   one". Mirrors `saveExternalMcpServer`'s own idempotent-by-id PUT design (the host's
 *   external MCP store's own doc: "two routes would be two validators of one contract") — the
 *   same reasoning applies one layer up: two tools would be two validators of one contract, and an
 *   agent updating a server it just created would have to remember which tool it used the first
 *   time. HUMAN-CONFIRMED: this never writes silently. See the host's tool-registrations handler.
 * - `external_mcp_test_connection` — checks an ALREADY-SAVED server's configuration, and may
 *   refresh an OAuth grant. Reports whether its configuration resolves cleanly (decrypts, has everything its transport needs, isn't sitting on
 *   an expired OAuth grant) — see that tool's own description for exactly what it does and does not
 *   check.
 * - `external_mcp_oauth_connect` / `external_mcp_oauth_poll_device` — the two moves the hard
 *   constraint "the agent's job ends at handing over one link and then detecting completion"
 *   requires: start an authorization and hand back the one thing a human needs (a link, or a device
 *   code), and — for the device-code grant specifically, which has no callback of its own — poll it
 *   once per call so completion can be detected without inventing a script the model would loop on
 *   its own. For the browser-redirect grant, completion is detected simply by calling
 *   `content_read.external_mcp` again and reading `oauth.status`.
 *
 * ## What no tool here ever accepts as input
 *
 * `env` (the stdio credential block), `accessToken` and `oauthClientSecret` are absent from every input schema
 * below, on purpose, not by omission. A tool argument is text the model chose to write, and — same
 * as `deployment_propose_custom_provider_credential`'s identical rule — a secret typed into a tool
 * call is a secret written into the conversation transcript. Every secret field is entered by the
 * HUMAN directly into the confirmation form `external_mcp_save` renders; the agent never sees or
 * handles it (see the host's save form). `additionalProperties: false` on `external_mcp_save`'s schema
 * makes an attempt to pass one a loud, rejected call rather than a silently dropped field.
 */

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { ExternalMcpHostCopy } from "./external-mcp-host-copy.js";

/** Mirrors the `AgentToolSideEffect` union every domain declares its own copy of — see
 *  `WirableToolDefinition`'s doc in `@jini-ai/cms/core` for why a shared import is deliberately not
 *  used here. */
export type AgentToolSideEffect = "none" | "mutates-durable-state";

export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/**
 * The same site-owner-level permission the host's HTTP routes gate on (the host's external MCP route
 * guard) — restated rather than imported because that module lives in the host's routes, a
 * direction this domain does not import from (see the host's tool deps header). Reusing the STRING is
 * what keeps the two gates from drifting, which is the property that module's own doc calls
 * load-bearing: a stored row's `command` is spawned as a real child process at daemon boot, so
 * whoever can write here can execute arbitrary code as the host process — exactly as consequential
 * through a chat message as through a form submission, and the gate must not be weaker for one path
 * than the other.
 */
export const EXTERNAL_MCP_MANAGE_PERMISSION = "admin.integrations.manage";

const EXTERNAL_MCP_TRANSPORTS = ["stdio", "streamable_http"] as const;
const EXTERNAL_MCP_AUTH_MODES = ["none", "static_env", "oauth"] as const;
const EXTERNAL_MCP_OAUTH_GRANTS = ["authorization_code", "device_code"] as const;

const LIST_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

/** The id/transport/access-list half of `external_mcp_save`'s properties — the part whose text carries host copy. */
const saveConnectionProperties = ({ copy }: { copy: ExternalMcpHostCopy }) => ({
  id: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    description:
      `Lowercase letters, digits and dashes. An id that already names a configured server UPDATES it (replacing its stored row, the same PUT semantics ${copy.settingsLocation} itself uses); a new id creates one.`,
  },
  enabled: { type: "boolean", description: "For an existing source, approve turning its access on or off without changing its connection or stored credentials." },
  label: { type: "string", description: "Display name shown in Settings. Optional — defaults to the id." },
  transport: {
    type: "string",
    enum: [...EXTERNAL_MCP_TRANSPORTS],
    description:
      "Required for connection setup; omit for access-only changes to an existing source. 'stdio' launches a local command as a child process (e.g. an npx-installed MCP server) — for a hosted/remote service reachable over the network, this is almost always 'streamable_http' instead.",
  },
  command: { type: "string", description: "Required when transport is 'stdio'. e.g. 'npx'." },
  args: { type: "string", description: "Space-separated command-line arguments. Only meaningful for 'stdio'." },
  url: { type: "string", description: "Required when transport is 'streamable_http'. The server's absolute https:// URL." },
  allowedToolNames: {
    type: "string",
    description:
      "Comma-separated remote tool names this connection may call. Nothing runs unless it is listed here — an empty value is a legitimate, meaningful choice (contributes zero tools), not an oversight to flag back to the human.",
  },
  writeAllowedToolNames: {
    type: "string",
    description:
      `Comma-separated remote tool names SEPARATELY authorized to write (the remote's own readOnlyHint:false is otherwise refused elsewhere). A name here must also be in allowedToolNames, or the save is rejected. For an UPDATE, call ${copy.listToolName} first if you want to preserve an existing connection's write grants — an id that no longer names any row (e.g. recreating one that was deleted) has nothing to prefill from, so leaving this unset there means zero write access, not a carry-over of what used to be granted. An empty value is otherwise a legitimate, meaningful choice (no write access), not an oversight to flag back to the human.`,
  },
} as const);

/** The auth half of `external_mcp_save`'s properties: no `copy` wording, and no secret-valued field. */
const SAVE_AUTH_PROPERTIES = {
  authMode: {
    type: "string",
    enum: [...EXTERNAL_MCP_AUTH_MODES],
    description:
      "'none' for a server that needs no credentials at all. 'static_env' for one that takes a pasted API key or token (the human types it directly into the confirmation form — never pass a credential value as a tool argument). 'oauth' for a server whose credentials are obtained by a browser sign-in or device code — see external_mcp_oauth_connect.",
  },
  accessTokenEnvName: { type: "string", description: "For stdio + static_env: the environment variable NAME that receives the token entered by the human. Never a credential value." },
  oauthProviderId: {
    type: "string",
    description: "Only meaningful when authMode is 'oauth'. A registered OAuth provider id. Leave unset to instead supply this connection's own endpoints below.",
  },
  oauthGrant: {
    type: "string",
    enum: [...EXTERNAL_MCP_OAUTH_GRANTS],
    description: "Only meaningful when authMode is 'oauth'. 'authorization_code' is an ordinary browser sign-in; 'device_code' is for a server with no way to receive a redirect.",
  },
  oauthClientId: { type: "string", description: "Only meaningful when authMode is 'oauth'. Not secret — it travels in the authorization URL by design." },
  oauthScopes: { type: "string", description: "Only meaningful when authMode is 'oauth'. Space- or comma-separated." },
  oauthTokenEnvName: {
    type: "string",
    description: "Only meaningful when authMode is 'oauth' and transport is 'stdio' — the environment variable name the launched command reads its access token from.",
  },
  oauthAuthorizationEndpoint: { type: "string", description: "Only needed when authMode is 'oauth', the grant is 'authorization_code', and oauthProviderId is unset." },
  oauthTokenEndpoint: { type: "string", description: "Only needed when authMode is 'oauth' and oauthProviderId is unset." },
  oauthDeviceAuthorizationEndpoint: { type: "string", description: "Only needed when authMode is 'oauth', the grant is 'device_code', and oauthProviderId is unset." },
} as const;

/**
 * `external_mcp_save`'s schema. Every property here is a NON-secret prefill hint — see this file's
 * header for why `env`/`oauthClientSecret` are not, and never will be, properties of this schema.
 *
 * `transport`/`authMode` are required rather than left to default, unlike the admin form (which can
 * default them because a human is looking at a live, reactive UI): the confirmation form this tool
 * renders is generated ONCE per call and cannot change shape after the fact, so the agent must have
 * already worked out which fields even apply — through ordinary conversation — before calling this.
 */
const saveInputSchema = ({ copy }: { copy: ExternalMcpHostCopy }) => ({
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { ...saveConnectionProperties({ copy }), ...SAVE_AUTH_PROPERTIES },
} as const);

const SERVER_ID_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64, description: "An already-configured server's id." },
  },
} as const;

const EXTERNAL_MCP_LIST_TOOL: AgentToolDefinition = {
  name: "external_mcp_list",
  description: [
    "Lists this workspace's configured external MCP servers: id, label, transport, auth mode, enabled state, allowed tool names, which environment variable NAMES are set (never their values), and — for an OAuth-authenticated connection — its status ('disconnected' | 'pending' | 'connected' | 'needs_reauth').",
    "Call this before external_mcp_save to check whether an id already exists (and see its current values before proposing an update), and after external_mcp_oauth_connect / external_mcp_oauth_poll_device to detect whether a browser sign-in the human completed has actually landed — that is the ENTIRE mechanism for detecting an authorization_code connect's completion; there is no separate 'wait for it' tool.",
    "Never contains a credential value, a client secret, or an access/refresh token. Has no side effects and can be safely repeated.",
  ].join(" "),
  sideEffects: "none",
  authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
  inputSchema: LIST_INPUT_SCHEMA,
};

const EXTERNAL_MCP_TEST_CONNECTION_TOOL: AgentToolDefinition = {
  name: "external_mcp_test_connection",
  description: [
    "Checks whether an ALREADY-SAVED external MCP server's configuration resolves cleanly (needs the full gateway: it can store data): its stored credentials decrypt, its transport has what it needs (a command for 'stdio', a URL for 'streamable_http'), and — for an OAuth connection — it is actually authorized rather than 'needs_reauth' or never connected.",
    "This does NOT launch the command or make a network call to the remote server — it reports the same readiness check the daemon itself performs at boot before federating a server, not a live reachability probe. A server that passes this can still fail to actually connect for reasons this call cannot see (a wrong command, a server that is down); a server that fails this is reported with the exact operator-actionable reason.",
    "Only works on a server that has already been saved (via external_mcp_save) — it takes an id, not a draft configuration, and cannot be used to test-run an arbitrary unsaved command.",
    "Returns { ok: true } or { ok: false, reason }. OAuth token resolution may contact the authorization provider and persist a refreshed grant. Use external_mcp_probe_connection to test a hosted endpoint live, or external_mcp_get_admissions to read the assistant's current tool roster.",
  ].join(" "),
  sideEffects: "mutates-durable-state",
  authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
  inputSchema: SERVER_ID_INPUT_SCHEMA,
};

const EXTERNAL_MCP_OAUTH_POLL_DEVICE_TOOL: AgentToolDefinition = {
  name: "external_mcp_oauth_poll_device",
  description: [
    "Polls a device-code authorization ONCE — call external_mcp_oauth_connect first to start one. Waits for exactly one HTTP round trip and returns immediately; it does not loop or block until the human finishes.",
    "Returns { status: 'connected' } once the human has entered the code and approved it — the connection is authorized and ready to use. Returns { status: 'pending', retryAfterSeconds } while still waiting; call this again after that many seconds, not sooner (the provider will otherwise slow you down further).",
    "Throws once the authorization is DECLINED, EXPIRED, or the provider fails — these are terminal; do not keep polling after one, tell the human and offer to start over with external_mcp_oauth_connect.",
  ].join(" "),
  sideEffects: "mutates-durable-state",
  authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
  inputSchema: SERVER_ID_INPUT_SCHEMA,
};

/** `external_mcp_save`: the one write tool; its text and schema name the host's settings screen and read tool. */
function externalMcpSaveTool({ copy }: { copy: ExternalMcpHostCopy }): AgentToolDefinition {
  return {
    name: "external_mcp_save",
    description: [
      `Proposes creating or updating one external MCP server. Existing-source access-only changes (enabled, allowedToolNames, writeAllowedToolNames) show one fixed approval card and preserve stored credentials. Connection setup shows the human a credential form before anything is written — THIS NEVER SAVES SILENTLY. Call ${copy.listToolName} first if you are updating an existing id, so the human sees accurate current values rather than blanks for anything you did not restate.`,
      "The form the human sees is generated from the fields YOU pass: decide transport and authMode through ordinary conversation before calling this (ask the human, or infer from what they already told you), because the form's shape is fixed once generated and cannot change after the fact.",
      "Never pass a credential, API key, token, or client secret as an argument to this tool — there are no such properties on this schema, and the human types any secret directly into the rendered form, never through you.",
      "Returns one of: { saved: true, server } once the human confirms and the write succeeds; { saved: false, cancelled: true } if the human declines; { saved: false, reason: 'expired' | 'abandoned', note } if nobody answered in time; { saved: false, reason: 'invalid', message, field } if the human's submitted form failed validation (tell them what to fix and call this again).",
    ].join(" "),
    sideEffects: "mutates-durable-state",
    authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
    inputSchema: saveInputSchema({ copy }),
  };
}

/** `external_mcp_oauth_connect`: its completion-detection guidance names the host's read tool. */
function externalMcpOauthConnectTool({ copy }: { copy: ExternalMcpHostCopy }): AgentToolDefinition {
  return {
    name: "external_mcp_oauth_connect",
    description: [
      "Starts an OAuth authorization for an already-saved, OAuth-authenticated server (authMode 'oauth' — save it with external_mcp_save first).",
      "Returns either { kind: 'redirect_required', authorizationUrl, expiresAt } — hand the human this exact URL to open in their own browser and tell them to sign in there; you cannot complete this step for them — or { kind: 'device_code', userCode, verificationUri, verificationUriComplete, expiresAt, intervalSeconds } — tell the human to open verificationUri (or verificationUriComplete directly) and enter userCode.",
      `Your job ends at handing over that one link or code. For 'redirect_required', detect completion by calling ${copy.listToolName} again after the human says they finished and reading oauth.status ('connected' means it worked). For 'device_code', call external_mcp_oauth_poll_device with the same id — once, not in a tight loop — no sooner than intervalSeconds after this call, and again after each 'pending' response.`,
      "Throws if the server does not exist, is not authMode 'oauth', or the provider could not be reached — these are real failures the human needs to know about, not something to retry silently.",
    ].join(" "),
    sideEffects: "mutates-durable-state",
    authorization: { permission: EXTERNAL_MCP_MANAGE_PERMISSION },
    inputSchema: SERVER_ID_INPUT_SCHEMA,
  };
}

/**
 * Every agent-callable tool this domain exposes. All five are wired — there is no `unwiredToolIds`
 * set in the host's tool registrations, which means any future catalog entry added without a handler is a
 * build failure.
 */
export function createExternalMcpAgentToolCatalog({ copy }: { copy: ExternalMcpHostCopy }, _optional = {}): readonly AgentToolDefinition[] {
  return [
    EXTERNAL_MCP_LIST_TOOL,
    externalMcpSaveTool({ copy }),
    EXTERNAL_MCP_TEST_CONNECTION_TOOL,
    externalMcpOauthConnectTool({ copy }),
    EXTERNAL_MCP_OAUTH_POLL_DEVICE_TOOL,
  ];
}
