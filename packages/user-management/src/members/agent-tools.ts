import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
/**
 * @file The Members agent-tool catalog (ADR-030/ADR-PIPE-013), instantiating SPEC-016 REQ-22's
 * naming/callability convention for this domain — the same shape `forms/agent-tools.ts` and
 * `Jini packages/user-management/src/server/agent-tools.ts` use, including the `inputSchema` contract.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real operation the admin HTTP surface
 * (`server/routes/admin/members/*.ts`) already exposes to a human operator — not merely onto a
 * `write-service.ts` export. That distinction matters here specifically: see the deliberate
 * absences below.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * Owner 2026-10-09 supersedes the profile/create exclusion below for this CRUD pass;
 * billing and authentication exclusions remain binding. Historical rationale is retained.
 * - `updateProfile`, `compSubscription`, `setSubscriptionStatus` (`write-service.ts`) have NO
 *   admin HTTP route at all today — `apps/website/src/server/runtime/composition/modules/members.ts` wires exactly 4 admin registrars
 *   (list/get/disable/request-magic-link) plus 2 public sign-in routes, nothing else. Wiring an
 *   agent tool for a write-service function the admin UI does not yet expose would give the
 *   assistant MORE capability than a human clicking through the admin screens has today — the
 *   opposite of this pattern's own premise (the tool is gated by "the SAME gate the human admin
 *   routes use," which presupposes a human admin route exists to share a gate with). Promoting
 *   these three to tools is a decision for whoever ships their admin routes, not this pass.
 * - `requestConsent`/`confirmConsent`/`revokeConsent`/`checkConsent` (`consent-service.ts`) are
 *   excluded for the same "no admin route" reason, with extra weight: these are the INV-NEW-02
 *   consent-ledger chokepoint (the ONLY path that may ever assert `status: 'granted'`), and the
 *   dispatch directive for this pass explicitly calls out consent/unsubscribe operations in
 *   Members as deserving "the same scrutiny as Identity's password reset." No admin surface
 *   reviews or exposes them today, so an agent must not gain a capability with no human-reachable
 *   equivalent to compare it against.
 * - `completeSignIn` is the MEMBER's own self-service session-mint (consumes a magic-link token,
 *   authenticates as that member) — never an operator action, and has no admin route. A tool that
 *   let an assistant complete a sign-in "on behalf of" a member would let it authenticate as an
 *   arbitrary member, which is an account-access primitive in the same family Identity's
 *   `resetUserPassword` exclusion warns about, just reached from the other side (session-minting
 *   instead of password-setting).
 * - No `members_comp_subscription`/`members_set_subscription_status`: see the write-service
 *   bullet above — these two also touch billing/entitlement state with no admin UI review path.
 *
 * How it relates to the project:
 * `assistant/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s.
 * Members' own `write-service.ts` does NOT call `authorize()` internally — `MembersWriteServiceDeps`
 * has no `authorize` field at all, and every admin route (`disable.ts`/`list.ts`/`get-by-id.ts`/
 * `request-magic-link.ts`) calls `deps.authorize()` itself, directly, before calling into the
 * write-service or repo. `tool-registrations.ts`'s handlers mirror that exact sequence rather than
 * relying on a self-enforcing domain function the way Forms/Identity do — see that file's Members
 * section header for the full disclosure.
 *
 * Architectural role:
 * `members` domain declaration. Performs no I/O and no enforcement itself.
 */

const MEMBER_MANAGE_PERMISSION = "member.manage" as const;

const DURABLE_MUTATION = "mutates-durable-state" as const;

export type AgentToolSideEffect = "none" | typeof DURABLE_MUTATION | "mints-token";

export type { AgentToolActorClassRule } from "@jini-ai/core";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`assistant/tool-registrations.ts`, which refuses to wire any tool lacking one).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** A member's id, as returned by `content_read.member` (the single card `members_list` and
 *  `members_get_by_id` collapsed into on 2026-09-08 — it dispatches on `memberId`'s presence). */
const MEMBER_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The member's id. Get it from content_read.member — omit memberId to list every member, or supply one to fetch that member.",
} as const;

/** The input shape shared by `members_get_by_id`/`members_disable` — exactly `{memberId}`. */
const MEMBER_ID_ONLY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memberId"],
  properties: { memberId: MEMBER_ID_SCHEMA },
} as const;

/** Members' fixed agent-tool catalog. */
export const membersAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "members_create",
    description: "Creates a pending site visitor member by email, with an optional name. Returns {member}. Use to add a member to the roster without sending mail. Does not verify their email, grant consent or a subscription, or issue a sign-in token/session. Existing email addresses and malformed input are refused. Requires member.manage; use members_request_magic_link separately to send a sign-in link.",
    sideEffects: DURABLE_MUTATION, authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, required: ["email"], properties: {
      email: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
    } },
  },
  {
    name: "members_update_profile",
    description: "Updates a site visitor member's public display name by memberId. Returns {member} with its new version. Leaves email, verification, status, subscriptions and operator-only notes unchanged. Call to edit a member profile; missing members, blank names and denied member.manage permission are refused.",
    sideEffects: DURABLE_MUTATION, authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, required: ["memberId", "name"], properties: {
      memberId: MEMBER_ID_SCHEMA, name: { type: "string", minLength: 1 },
    } },
  },
  {
    name: "members_list",
    description:
      "Lists the workspace's members (any status: pending/active/disabled), one page at a time. Read-only. Call this to find a member's id before getting details or disabling them. When more members exist the result has a non-null nextCursor and a `more` note: call again with cursor set to nextCursor.",
    sideEffects: "none",
    authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        cursor: { type: "string", description: "nextCursor from the previous call. Omit for the first page." },
        afterId: { type: "string", description: "Older form of cursor: a previously-seen member id; the page starts after it. Prefer cursor." },
        limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Max rows to return (1-100). Defaults to the repo's own default page size." },
      },
    },
  },
  {
    name: "members_get_by_id",
    description: "Fetches a single member's details by id. Read-only.",
    sideEffects: "none",
    authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: MEMBER_ID_ONLY_INPUT_SCHEMA,
  },
  {
    name: "members_delete",
    description: "Moves a member to Trash and revokes their sessions and sign-in links. Restore with trash_restore_item; permanent deletion uses the existing Trash confirmation flow.",
    sideEffects: DURABLE_MUTATION,
    authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: MEMBER_ID_ONLY_INPUT_SCHEMA,
  },
  {
    name: "members_disable",
    description:
      "Disables a member, revoking their access and every one of their live sessions. Use members_delete to move a member to Trash instead. Idempotent — disabling an already-disabled member is a no-op. There is no agent-callable re-enable tool for members (unlike identity users) because the admin UI does not expose one either.",
    sideEffects: DURABLE_MUTATION,
    authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: MEMBER_ID_ONLY_INPUT_SCHEMA,
  },
  {
    name: "members_request_magic_link",
    description:
      "Requests (or resends) a passwordless sign-in link for a member's email — the same 'resend sign-in link' action available in the admin UI. Returns {delivered, mailDeliveryAvailable:true}: delivered:true means the mail provider accepted the link, not that it reached the inbox; delivered:false means no provider accepted it (disabled member, test-mode capture or a provider failure). Refuses with MEMBERS_SIGN_IN_UNAVAILABLE when email or the site address is not set up; check system_get_mail_status. Rate-limited per email; malformed addresses and denied permission are refused.",
    sideEffects: DURABLE_MUTATION,
    authorization: { permission: MEMBER_MANAGE_PERMISSION },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["email"],
      properties: {
        email: { type: "string", description: "The member's email address." },
        redirectPath: { type: "string", description: "Optional relative path to redirect to after a successful sign-in." },
      },
    },
  },
];
