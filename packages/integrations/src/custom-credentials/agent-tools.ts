import type { AgentToolDefinition } from "@jini-ai/core";

/**
 * @file Custom-credential read, verification, request, username and file-write tool catalog.
 * The host's credential_save tool owns creation/rotation schemas; the host's tool registrations own
 * the wiring and its authorization, human-input and write-freshness rationale.
 *
 * content_read.custom_credential returns saved labels, hosts, account identifiers and timestamps,
 * using the non-decrypting store read model. CustomCredentialSummary cannot carry a token and
 * listing must not depend on a working site key. Labels let callers reuse saved credentials
 * without asking the human to retype identifiers the system already knows.
 * verify and make_request return authDiagnostic for 401/403; set_username repairs the non-secret
 * account identifier without accepting or touching a token. credential_save distinguishes new
 * API rows from existing-label rotation and refuses duplicate-label creation.
 *
 * DELETE requests require human confirmation; GET/POST/PUT/PATCH and named file creation/editing
 * run directly under the owner's policy. File writes use a validated provider plan and one atomic
 * commit; see the host's tool registrations for the unchanged branch-freshness boundary.
 * No schema here carries a token. credentialed-request.ts owns the saved-origin allowlist and
 * server-side Authorization injection, so a caller-supplied URL cannot redirect a credential.
 *
 * Every tool name, permission and description sentence is a host input; this module owns only the
 * input-schema shapes the credential handlers validate against.
 */

/** The host's tool names, matching its handler ids and reviewed metadata. */
export interface CustomCredentialsAgentToolIds {
  readonly list: string;
  readonly verify: string;
  readonly makeRequest: string;
  readonly setUsername: string;
  readonly writeFiles: string;
}

/** The host's model-facing sentences for each tool and input field. */
export interface CustomCredentialsAgentToolCopy {
  /** The shared `label` field description every label-taking tool uses. */
  readonly labelField: string;
  readonly tools: { readonly list: string; readonly verify: string; readonly makeRequest: string; readonly setUsername: string; readonly writeFiles: string };
  readonly makeRequestFields: { readonly method: string; readonly url: string; readonly headers: string; readonly body: string };
  readonly setUsernameFields: { readonly username: string };
  readonly writeFilesFields: {
    readonly owner: string; readonly repo: string; readonly branch: string; readonly commitMessage: string;
    readonly path: string; readonly content: string; readonly files: string;
  };
}

/** No arguments — parameterless read tool. Same shape every other domain's own `NO_INPUT_SCHEMA`
 *  declares — declared locally rather than shared, per this codebase's "duplicate the tiny type,
 *  never share across features/files" convention. */
const LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

function verifySchema({ copy }: { copy: CustomCredentialsAgentToolCopy }) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: {
      label: { type: "string", description: copy.labelField },
    },
  } as const;
}

function makeRequestSchema({ copy }: { copy: CustomCredentialsAgentToolCopy }) {
  const fields = copy.makeRequestFields;
  return {
    type: "object",
    additionalProperties: false,
    required: ["label", "method", "url"],
    properties: {
      label: { type: "string", description: copy.labelField },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: fields.method },
      url: { type: "string", description: fields.url },
      headers: { type: "object", additionalProperties: { type: "string" }, description: fields.headers },
      body: { type: "string", description: fields.body },
    },
  } as const;
}

function setUsernameSchema({ copy }: { copy: CustomCredentialsAgentToolCopy }) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["label", "username"],
    properties: {
      label: { type: "string", description: copy.labelField },
      username: { type: ["string", "null"], description: copy.setUsernameFields.username },
    },
  } as const;
}

/** `custom_credential_write_files`'s entire input shape. `files.maxItems` is bound to the SAME
 *  `maxFiles` cap the host's write-files validation actually enforces, so the schema the
 *  model sees can never silently drift from the real cap. */
function writeFilesSchema({ copy, maxFiles }: { copy: CustomCredentialsAgentToolCopy; maxFiles: number }) {
  const fields = copy.writeFilesFields;
  return {
    type: "object",
    additionalProperties: false,
    required: ["label", "owner", "repo", "branch", "commitMessage", "files"],
    properties: {
      label: { type: "string", description: copy.labelField },
      owner: { type: "string", description: fields.owner },
      repo: { type: "string", description: fields.repo },
      branch: { type: "string", description: fields.branch },
      commitMessage: { type: "string", description: fields.commitMessage },
      files: {
        type: "array",
        minItems: 1,
        maxItems: maxFiles,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: {
            path: { type: "string", description: fields.path },
            content: { type: "string", description: fields.content },
          },
        },
        description: fields.files,
      },
    },
  } as const;
}

/**
 * This domain's fixed agent-tool catalog, in the host's names, permissions and words.
 *
 * @param required.writeFilesLimits - The host's enforced write-files caps; `maxFiles` bounds `files`.
 * @complexity O(1) — a fixed, statically-shaped list.
 */
export function buildCustomCredentialsAgentToolCatalog(
  required: {
    readonly ids: CustomCredentialsAgentToolIds;
    readonly permissions: { readonly read: string; readonly write: string };
    readonly copy: CustomCredentialsAgentToolCopy;
    readonly writeFilesLimits: { readonly maxFiles: number };
  },
  _optional: Record<string, never> = {},
): AgentToolDefinition[] {
  const { ids, permissions, copy } = required;
  return [
    { name: ids.list, description: copy.tools.list, sideEffects: "none", authorization: { permission: permissions.read }, inputSchema: LIST_SCHEMA },
    { name: ids.verify, description: copy.tools.verify, sideEffects: "none", authorization: { permission: permissions.read }, inputSchema: verifySchema({ copy }) },
    { name: ids.makeRequest, description: copy.tools.makeRequest, sideEffects: "mutates-durable-state", authorization: { permission: permissions.write }, inputSchema: makeRequestSchema({ copy }) },
    { name: ids.setUsername, description: copy.tools.setUsername, sideEffects: "mutates-durable-state", authorization: { permission: permissions.write }, inputSchema: setUsernameSchema({ copy }) },
    {
      name: ids.writeFiles, description: copy.tools.writeFiles, sideEffects: "mutates-durable-state", authorization: { permission: permissions.write },
      inputSchema: writeFilesSchema({ copy, maxFiles: required.writeFilesLimits.maxFiles }),
    },
  ];
}
