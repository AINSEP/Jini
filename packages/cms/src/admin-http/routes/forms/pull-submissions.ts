import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { FormSubmissionsPullPort, FormSubmissionsPullResult } from "../../../forms/site/import-remote-submissions.js";
import { authorizeForms, FORMS_MANAGE, type FormsRoutePrincipal } from "./shared.js";

/** The deps this route reads. `formSubmissionsPull` is the same composed port as the
 *  `forms_pull_submissions` tool; a host that has not wired it answers the 503. */
export interface FormsPullSubmissionsRouteDeps {
  workspaceId: string;
  formSubmissionsPull?: FormSubmissionsPullPort | undefined;
}

/** The raw JSON body; `targetId` is validated after authorization, as the hand-written route did. */
export interface FormsPullSubmissionsInput { body: unknown }

/**
 * A pull that failed before any published host was read. The host's error port answers it with its
 * own pull-failure copy (operation, message, next step) around {@link FormsPullFailedError.cause},
 * instead of the route's generic failure copy; the cause never reaches the message.
 */
export class FormsPullFailedError extends Error {
  override readonly cause: unknown;
  constructor({ cause }: { cause: unknown }) {
    super("form submission pull failed before any published host was read");
    this.name = "FormsPullFailedError";
    this.cause = cause;
  }
}

/** The optional `targetId` from the JSON body, or the reason it was refused. @complexity O(1). */
function parseTargetId({ body }: { body: unknown }, _optional = {}): { ok: true; targetId?: string } | { ok: false } {
  const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>).targetId : undefined;
  if (raw === undefined) return { ok: true };
  return typeof raw === "string" && raw.length > 0 && raw.length <= 64 ? { ok: true, targetId: raw } : { ok: false };
}

/** Keep pull failures correlated with the server log, inside the route's outer fallback. */
async function pullReport(
  { pull, workspaceId, targetId }: { pull: FormSubmissionsPullPort; workspaceId: string; targetId?: string | undefined },
  _options = {},
): Promise<FormSubmissionsPullResult> {
  try {
    return await pull.pull({ workspaceId }, targetId ? { targetId } : {});
  } catch (error) {
    // One host's failure is already a per-destination report; this is a failure before any host
    // was read (the vault, the plugin registry). Log the cause under a reference the reply repeats.
    throw new FormsPullFailedError({ cause: error });
  }
}

/**
 * POST — pull the submissions published static sites stored at their hosts into this site
 * (`FormsPullSubmissionsRouteDeps.formSubmissionsPull`, the same composed port as the
 * `forms_pull_submissions` tool). Body: optional `{ targetId }` to pull from one hosting target only.
 */
export const formsPullSubmissionsRoute = defineJsonRoute<FormsPullSubmissionsInput, FormSubmissionsPullResult, FormsPullSubmissionsRouteDeps, FormsRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/forms/submissions/pull",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeForms({ authorize, permission: FORMS_MANAGE, entityType: "form_submission" });
    const parsed = parseTargetId({ body: input.body });
    if (!parsed.ok) {
      throw new RouteRefusalError({ status: 400, body: {
        error: "targetId must be a hosting target id of 1-64 characters, or omitted to pull from every published site", code: "FORMS_FIELD_VALIDATION_ERROR",
        details: { fieldErrors: [{ field: "targetId", reason: "must be 1-64 characters" }] },
      } });
    }
    if (!deps.formSubmissionsPull) {
      throw new RouteRefusalError({ status: 503, body: { error: "pulling form submissions is not available on this site's server; restart the site, then try again", code: "FORMS_PULL_UNAVAILABLE" } });
    }
    return ok({ value: await pullReport({ pull: deps.formSubmissionsPull, workspaceId: deps.workspaceId, targetId: parsed.targetId }) });
  },
});
