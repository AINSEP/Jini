import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
/**
 * @file Publishing readiness, connection, and human-confirmed pulls from the live site.
 *
 * ## Why readiness and connection are separate
 *
 * The owner's requirement was "it should be automatic, discoverable by AI, and a regular user
 * doesn't have to think about it". "Discoverable" is the part a single tool cannot deliver: a model
 * that can only act has no way to answer "can I publish?" without attempting it, so the honest
 * answer to a person asking "is my site set up?" would be a failed attempt. So the read comes first
 * and stands alone, and the repair is its own verb.
 *
 * ## Why autonomous publishing returned
 *
 * The 2026-09-24 design removed the tool to avoid a second confirmation surface with duplicated
 * safety rules. Owner decision 2026-10-05 restored assistant publishing; 2026-10-07 requires human approval. The restored tool
 * shares the dialog's feature-side planning, selection and re-plan checks and the destination's
 * existing import gateway. The shared approval policy opens its MCP-UI card; overwrite still requires explicit input.
 *
 * ## The vocabulary rule
 *
 * The DESCRIPTIONS below are read by the model and may name mechanism. The status/connect tools'
 * returned sentences are read by a person and must avoid: no key, token, grant, principal, capability, workspace
 * id, installation id, generation, peer or bundle, and no error codes.
 * Pull tools return structured plan/report fields for the model.
 * `__tests__/publish-agent-tools.test.ts` asserts that over every reachable sentence rather
 * than trusting review — the same guard `publish-trust/__tests__/provisioning.test.ts` already
 * applies to its own refusals.
 */

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "deletes-durable-state" | "mints-token";

export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect; actorClassRule?: "confirmer-must-equal-own-delegatedBy" };

export const PUBLISH_CONTENT_PUBLISH_TOOL_ID = "publish_content_publish";
export const PUBLISH_CONTENT_STATUS_TOOL_ID = "publish_content_status";
export const PUBLISH_BACKSTOP_GAPS_TOOL_ID = "publish_backstop_gaps";
export const PUBLISH_CONTENT_CONNECT_TOOL_ID = "publish_content_connect";

export const PUBLISH_CONTENT_PLAN_PULL_TOOL_ID = "publish_content_plan_pull";
export const PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID = "publish_content_execute_pull";

const NO_ARGUMENTS_SCHEMA = { type: "object", additionalProperties: false, properties: {} } as const;

export const publishContentAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: PUBLISH_CONTENT_PUBLISH_TOOL_ID,
    description: "Publishes pending local content to the connected live site immediately, through the same plan/confirm/execute gateway as the Publish dialog. " +
      "Omit peerId for the connected destination; several destinations require choosing a saved peerId. " +
      "Omit filters to publish everything pending. Use types and items (exact title, slug, id or type:id) to select only named items; excludeItems removes named items. " +
      "Set overwrite:true ONLY when the user explicitly asks to replace conflicting live content; defaults to skipping conflicts and reporting why. " +
      "Waits for a human confirmation card (owner 2026-10-07). Returns published items with live publicUrl, skipped items with reasons, unchanged items, and verification problems. " +
      "Give the live publicUrl first in your reply; an admin edit link is secondary. Never invent a live link or claim unverified items landed.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "publish_content.apply" },
    inputSchema: { type: "object", additionalProperties: false, properties: {
      peerId: { type: "string", minLength: 1 },
      types: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1 } },
      items: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1 } },
      excludeItems: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1 } },
      overwrite: { type: "boolean", description: "Only true when the user explicitly requested overwriting live conflicts." },
    } },
  },
  { name: PUBLISH_BACKSTOP_GAPS_TOOL_ID,
    description: "Read which kinds of site items people have sent by hand because normal publishing does not cover them yet. Returns gap labels, send counts and the last reason. Use this to suggest new normal publish types. The assistant can only read this history. A person must confirm every manual send; never fill their live-address confirmation.",
    sideEffects: "none", authorization: { permission: "publish_content.read" }, inputSchema: NO_ARGUMENTS_SCHEMA },
  {
    name: PUBLISH_CONTENT_PLAN_PULL_TOOL_ID,
    description: "Fetches the live site's content and shows what pulling it down would change here; changes no content yet. " +
      "Call to pull, download or sync live content back to this computer. Omit peerId for the connected destination; " +
      "several destinations require choosing a saved peerId. Returns bundleId, expiresAt, peerLabel, create/update/unchanged/blocked counts, " +
      "up to 50 conflicts with entityKey/title/reason, and unavailable/deferred blobs. Stages an expiring bundle and stores verified blob bytes. " +
      "Use publish_content_execute_pull to apply it. To push local changes live, use publish_content_publish.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "publish_content.apply" },
    inputSchema: { type: "object", additionalProperties: false, properties: { peerId: { type: "string", minLength: 1 } } },
  },
  {
    name: PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID,
    description: "Applies a planned pull after the owner confirms in a dialog; overwrites the listed local items. " +
      "Call after publish_content_plan_pull, with its bundleId and optional overwriteEntityKeys chosen from its conflicts. " +
      "Shows a fresh summary and overwritten titles; an expired plan, changed local content or unavailable backup refuses apply. " +
      "Nothing in tool input confirms. Decline or no answer returns executed:false; success returns executed:true, counts and per-entity outcomes. " +
      "To push local changes live, use publish_content_publish.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "publish_content.apply" },
    actorClassRule: "confirmer-must-equal-own-delegatedBy",
    inputSchema: { type: "object", additionalProperties: false, required: ["bundleId"], properties: {
      bundleId: { type: "string", minLength: 1 },
      overwriteEntityKeys: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1 } },
    } },
  },
  {
    name: PUBLISH_CONTENT_STATUS_TOOL_ID,
    description:
      "Reports whether THIS installation can copy its content to the site's live, public deployment, " +
      "and if not, what is missing — in plain sentences meant to be repeated to a non-technical " +
      "person verbatim. Call this before publishing, and whenever someone asks whether publishing is " +
      "set up, why publishing is not working, or where this site publishes to. " +
      "It distinguishes four situations: publishing works; there is a live site but this computer has " +
      "never been connected to it; this site has never been put online at all; and this site has " +
      "nothing publishable yet. " +
      "READS ONLY — it changes nothing, contacts no other site, and never reveals or produces any " +
      "credential. Its `summary`/`missing`/`nextStep` strings are already written for a person; do " +
      "not translate them into technical terms.",
    sideEffects: "none",
    authorization: { permission: "publish_content.read" },
    inputSchema: NO_ARGUMENTS_SCHEMA,
  },
  {
    name: PUBLISH_CONTENT_CONNECT_TOOL_ID,
    description:
      "Sets up — or repairs — this installation's ability to publish to the site's live deployment. " +
      "Call it when `publish_content_status` reports that this computer is not connected, or when a " +
      "publish fails because the live site does not recognise this computer. " +
      "With no argument it uses the address already written in this repository's own deployment " +
      "configuration, which is the normal case; pass `siteUrl` only when the person names a different " +
      "site. It is SAFE TO REPEAT: running it again replaces this computer's own entry and leaves " +
      "every other computer's alone, so 'try connecting again' is always a valid suggestion. " +
      "It mints nothing a person has to keep, shows no secret, and asks for no identifier. " +
      "It does NOT publish anything, and it does NOT take effect on the live site until this " +
      "repository is deployed once more — the returned `nextStep` says so in one sentence; relay it.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "publish_content.apply" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        siteUrl: {
          type: "string",
          description:
            "Optional. The live site's address, e.g. 'https://example.com'. Omit it to use the address " +
            "this repository's deployment configuration already names, which is what the person almost " +
            "always means. Only pass it when they explicitly name a different site.",
        },
      },
    },
  },
];
