/**
 * @file The Deployments domain's agent-tool catalog (2026-08-15 — closes the "the owner can deploy
 * by typing CLI commands, but cannot ask the assistant to do it" gap: none of the 21 existing
 * `assistant/tool-registrations.ts` domains covered the Deployment panel's export and Dockerfile
 * actions at all).
 *
 * Purpose:
 * A static catalog describing every agent-callable tool this domain exposes and the permission each
 * one carries. All five entries here are wired (`tool-registrations.ts` in this directory) — unlike
 * `features/recovery/agent-tools.ts` or `features/database/agent-tools.ts`, this catalog has no
 * excluded, token-gated, or otherwise-dangerous entry: an export writes a static COPY (never touches
 * the running site's own database or content), and a Dockerfile edit writes one build file that
 * still needs a human to run `docker build`/`docker push` in a terminal — neither operation is the
 * kind of irreversible cross-domain mutation ADR-041/ADR-045 reserve for a human-only lever.
 *
 * How it relates to the project:
 * The server-side tool filter (ADR-014) consumes this catalog to decide which tool names an agent
 * session may see at all; `tool-registrations.ts`'s handlers, each wrapping an existing HTTP route's
 * own domain logic (`features/deployments/export-run.ts`, `features/deployments/dockerfile.ts`),
 * enforce the actual permission checks at call time — this module declares shape only, no I/O.
 *
 * Architectural role:
 * `features/deployments` domain logic. No dependencies.
 */

import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

/**
 * JSON Schema for this tool's `input`, published via `ToolDescriptor.inputSchema`
 * (`assistant/tool-registrations.ts`, which refuses to wire any tool lacking one).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** No arguments — shared by every parameterless read tool in this catalog. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/** `deployment_trigger_export`'s input. Both fields optional — omitting either reproduces the HTTP
 *  route's own defaults (`clean:false`, no base-path rewrite). Neither field is a filesystem path;
 *  `outputDir` is never caller-controllable (see `export-run.ts`'s `startExportRun`, which reads
 *  `RouteDeps.exportOutputRootDir` rather than accepting one). */
const TRIGGER_EXPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {
    basePath: {
      type: "string",
      description:
        "Set this ONLY when the destination host serves the site from a subpath (for example a repository-named path, host/reponame) — it must exactly match that subpath (e.g. \"/reponame\"), or every exported asset (CSS, JS, images) will 404 once served from it. Leave unset when the site is served from a domain root, including a custom domain — setting it then would incorrectly prefix every link.",
    },
    clean: {
      type: "boolean",
      description:
        "Set to true to wipe the export output directory before writing, when a previous export's leftover files would otherwise cause the run to be refused as 'not empty'. Defaults to false, which refuses to export into a non-empty directory rather than silently deleting unknown files.",
    },
  },
} as const;

/** `deployment_set_dockerfile`'s input. There is no path field: the write always targets the
 *  repo-root Dockerfile and nothing else (`dockerfile.ts`'s own path-safety argument).
 *
 *  `ifMatch` is REQUIRED, not optional (2026-08-15, Terra audit finding C5, owner-decided strict —
 *  see `writeDockerfileSourceWithIfMatch`'s own doc in `dockerfile.ts` for the full decision
 *  record). A human editing the same file in the admin UI's Dockerfile tab is a real, concurrent
 *  second writer this tool cannot see coming; requiring `ifMatch` in the schema itself — not just
 *  checking it at runtime — is what forces a model calling this tool to have called
 *  `deployment_get_dockerfile` first and to be reasoning from CURRENT contents, rather than
 *  silently overwriting whatever a human just saved. */
const SET_DOCKERFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["contents", "ifMatch"],
  properties: {
    contents: {
      type: "string",
      description:
        "The full replacement contents of the repo-root Dockerfile. This REPLACES the entire file — call deployment_get_dockerfile first if you need to preserve or build on its current contents. Not validated as Dockerfile syntax; an invalid Dockerfile is written as-is.",
    },
    ifMatch: {
      type: "string",
      description:
        "The 'etag' from the most recent deployment_get_dockerfile call (or from this tool's own previous response). Required — proves this write is based on the file's CURRENT contents, not a stale copy a human may have since changed in the admin UI. If the Dockerfile changed since that etag was read, this call is refused with a conflict describing what changed; call deployment_get_dockerfile again, reconcile your intended edit against the NEW current contents, and retry with the fresh etag it returns.",
    },
  },
} as const;

/**
 * The Deployments domain's fixed agent-tool catalog.
 *
 * @complexity O(1) — a fixed, statically-defined list.
 * @overallScore 100
 */
export const deploymentsAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "deployment_trigger_export",
    description:
      "Starts a full static export of the site to disk: a self-contained, fully static COPY of every public page and asset, with NO checkout, admin UI, or assistant included in the output (those only exist in this running server — the exported copy is pure static HTML/CSS/JS/assets, suitable for any static host). This is slow — seconds to minutes, one HTTP fetch per route and asset — so this call returns immediately once the run STARTS, not once it finishes; call deployment_get_export_status afterward (poll it) to learn whether the export actually succeeded. Only one export can run at a time on this instance: calling this while one is already running fails outright rather than queuing or restarting it — check status first if unsure. Set basePath when the destination serves the site from a subpath; see that field's own description for exactly when.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "system.export" },
    inputSchema: TRIGGER_EXPORT_SCHEMA,
  },
  {
    name: "deployment_diagnose_static_export",
    description:
      "Reports what a static export/publish of this site would drop or fail, without publishing. Call before deployment_execute_static_publish or when a publish was refused; returns counts and full failure/drop diagnostics, or ALREADY_RUNNING while another export is running.",
    sideEffects: "none",
    authorization: { permission: "system.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "deployment_get_export_status",
    description:
      "Reports the status of the most recent (or currently running) static-site export started by deployment_trigger_export: 'idle' (never run in this process), 'running', 'completed', or 'errored'. Poll this after triggering an export, since the trigger itself returns before the export finishes. On 'completed', reports route/asset success and failure counts, every failed route/asset with its reason, and any base-path rewrite warning; ok is true only when every ROUTE exported successfully (asset failures are still reported but do not flip ok — check counts.assetsFailed separately).",
    sideEffects: "none",
    authorization: { permission: "system.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "deployment_get_dockerfile",
    description:
      "Returns the repo-root Dockerfile's current contents (exists:true/contents:'...'), or exists:false if none has been created yet, plus an 'etag' identifying exactly this version of the contents. This is the build file a human runs `docker build`/`docker push` against in a terminal — reading it does not build, validate, or deploy anything. ALWAYS call this immediately before deployment_set_dockerfile to get a fresh etag: a human can edit and save this same file in the admin UI's Dockerfile tab at any time, so an etag from long ago may already be stale.",
    sideEffects: "none",
    authorization: { permission: "system.read" },
    inputSchema: NO_INPUT_SCHEMA,
  },
  {
    name: "deployment_set_dockerfile",
    description:
      "Overwrites the repo-root Dockerfile with the given contents, creating it if it does not exist. Requires 'ifMatch' — the 'etag' from a just-prior deployment_get_dockerfile call — to prove the write is based on the file's CURRENT contents, since a human can edit and save the same file in the admin UI at any time; a stale or missing etag is refused with a conflict/error rather than silently overwriting whatever they saved (see the 'ifMatch' field's own description for the recovery steps). This ONLY writes bytes to disk — it does NOT build, validate as Dockerfile syntax, or trigger any build/deploy; nothing about the running container changes as a result of this call, and a human still has to run `docker build` themselves afterward. The previous contents are not backed up by this tool; call deployment_get_dockerfile first if you need them.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "system.write" },
    inputSchema: SET_DOCKERFILE_SCHEMA,
  },
];
