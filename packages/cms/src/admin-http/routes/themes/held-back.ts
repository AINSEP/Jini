import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { bodyRecord } from "./explore-shared.js";
import { authorizeThemes, type ThemeRoutePrincipal } from "./shared.js";

/**
 * @file The Themes screen's "Held back on import" section: list the themes site import left in a
 * quarantine folder, re-check one, and restore one the owner approved. Held-back ids carry a
 * slash (`static/foo`), so they travel in the body; the path is `held-back-themes`, not
 * `themes/...`, because `GET themes/:themeId` is registered earlier and would swallow it.
 *
 * Restore is the shared plan -> confirm -> execute ceremony: a passing `/check` returns a plan,
 * the approval card's click posts it to `/restore/approval` (which mints a single-use token only
 * for an explicit `"approve"`), and `/restore` redeems that token. The digest the check returned
 * still travels with the restore, but only as the version check — it is no longer the approval.
 *
 * The check, the plan/confirm/execute gateway, the file move and the preview refresh are the
 * host's, injected per route (one small deps type each); the specs keep the HTTP rules: the order
 * of the permission check, the body parse, the approval gate and the single-use token, plus the
 * status and flat body of every refusal.
 */

const BASE = "/api/admin/v1/workspaces/:workspaceId/held-back-themes";

/** Reading (list, check) is the themes list's own read gate. */
export const HELD_BACK_READ_PERMISSION = "theme.set";
/** Approving and restoring create live theme source, so they need the same permission as Duplicate. */
export const HELD_BACK_RESTORE_PERMISSION = "theme.edit";

/** Every refusal the host's held-back service raises. */
export type HeldBackErrorCode =
  | "INVALID_ID" | "APPROVAL_REQUIRED" | "HELD_BACK_NOT_FOUND" | "CHECK_FAILED" | "CHANGED_SINCE_CHECK" | "NAME_TAKEN" | "LIVE_FOLDER_UNSAFE";

/** HTTP status per service refusal: bad input 400, a missing folder 404, a state conflict 409. */
export const HELD_BACK_ERROR_STATUS: Readonly<Record<HeldBackErrorCode, number>> = {
  INVALID_ID: 400,
  APPROVAL_REQUIRED: 400,
  HELD_BACK_NOT_FOUND: 404,
  CHECK_FAILED: 409,
  CHANGED_SINCE_CHECK: 409,
  NAME_TAKEN: 409,
  LIVE_FOLDER_UNSAFE: 409,
};

/** A held-back service refusal as the host's recognizer reads it off the thrown error. */
export interface HeldBackServiceFailure { code: HeldBackErrorCode; message: string; problems?: readonly unknown[] | undefined }

/** One approval-gateway refusal (forbidden, stale plan, expired or spent token): the host picks the status and code. */
export interface HeldBackGatewayFailure { status: number; code: string; message: string }

/** How a route recognizes the host's two error families; anything neither claims is rethrown unchanged (an `ERR-` reference). */
export interface HeldBackFailureDeps {
  heldBackFailure: (required: { err: unknown }) => HeldBackServiceFailure | undefined;
  gatewayFailure: (required: { err: unknown }) => HeldBackGatewayFailure | undefined;
}

/** The host's re-check of one held-back theme; extra fields travel to the client as-is. */
export interface HeldBackCheckResult { themeId: string; passes: boolean; digest?: string | null; [field: string]: unknown }

/** The themes list: what site import held back, plus the notice when the chosen theme is among it. */
export interface HeldBackListing { themes: readonly unknown[]; chosenThemeHeldBack: unknown }

/** What the check's passing result offers the approval card to confirm. */
export interface HeldBackPlan { planId: string; planHash: string }

/** The error `/restore/approval` and `/restore` raise when the approval step was skipped. */
const APPROVAL_REQUIRED_MESSAGE = "Approve restoring this theme on the approval card first.";

/** A service or approval refusal as the route's own response, or the error unchanged. */
function refusalFor(deps: HeldBackFailureDeps, err: unknown): unknown {
  const service = deps.heldBackFailure({ err });
  if (service) {
    const problems = service.code === "CHECK_FAILED" ? { problems: service.problems } : {};
    return new RouteRefusalError({ status: HELD_BACK_ERROR_STATUS[service.code], body: { code: service.code, error: service.message, ...problems } });
  }
  const gateway = deps.gatewayFailure({ err });
  if (gateway) return new RouteRefusalError({ status: gateway.status, body: { code: gateway.code, error: gateway.message } });
  return err;
}

/** Runs one route's work; a known refusal leaves as its response, anything else as the original error. */
async function refusing<T>(deps: HeldBackFailureDeps, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (err) { throw refusalFor(deps, err); }
}

/** The approval step was skipped: the same 400 whether the plan or the token is missing. */
function approvalRequired(): never {
  throw new RouteRefusalError({ status: HELD_BACK_ERROR_STATUS.APPROVAL_REQUIRED, body: { code: "APPROVAL_REQUIRED", error: APPROVAL_REQUIRED_MESSAGE } });
}

/** The asker, needed only once the permission check passed; a mount without a session is a wiring bug. */
function requirePrincipal<TPrincipal>(context: TPrincipal | undefined): TPrincipal {
  if (!context) throw new Error("held-back route has no authenticated principal");
  return context;
}

function stringField(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? (body[key] as string) : "";
}

/** The deps `GET held-back-themes` reads. */
export interface HeldBackListRouteDeps extends HeldBackFailureDeps {
  /** Lists the held-back themes and whether the workspace's chosen theme is among them. */
  listHeldBack: () => Promise<HeldBackListing> | HeldBackListing;
}

/** The deps `POST held-back-themes/check` reads. */
export interface HeldBackCheckRouteDeps<TPrincipal extends ThemeRoutePrincipal> extends HeldBackFailureDeps {
  /** The fresh re-check of one held-back theme. */
  checkTheme: (required: { themeId: string }) => HeldBackCheckResult;
  /** Mints the plan the approval card confirms, for the asker; called only for a passing check. */
  planRestore: (required: { principal: TPrincipal; themeId: string; digest: string }) => Promise<HeldBackPlan>;
}

/** The deps `POST held-back-themes/restore/approval` reads. */
export interface HeldBackApprovalRouteDeps<TPrincipal extends ThemeRoutePrincipal> extends HeldBackFailureDeps {
  /** Confirms the plan for the asker (the gateway refuses an agent) and returns the single-use token. */
  confirmRestore: (required: { principal: TPrincipal; planId: string; planHash: string }) => Promise<{ confirmationToken: string }>;
}

/** The deps `POST held-back-themes/restore` reads. */
export interface HeldBackRestoreRouteDeps<TPrincipal extends ThemeRoutePrincipal> extends HeldBackFailureDeps {
  /** Redeems the token (spending it), then moves the theme; answers the move's result. */
  restoreTheme: (required: { principal: TPrincipal; themeId: string; approvedDigest: string; confirmationToken: string }) => Promise<unknown>;
  /** Asks the host's preview pipeline to re-capture card previews after a successful restore. */
  refreshPreviews: () => void;
}

/** The input `POST held-back-themes/check` parses. */
export interface HeldBackCheckInput { themeId: string }

/** The input `POST held-back-themes/restore/approval` parses; `decision` stays raw so only `"approve"` mints. */
export interface HeldBackApprovalInput { decision: unknown; planId: string; planHash: string }

/** The input `POST held-back-themes/restore` parses. */
export interface HeldBackRestoreInput { themeId: string; approvedDigest: string; confirmationToken: string }

/**
 * GET — the themes list: what site import held back. Gated on `theme.set`.
 * @complexity O(1) plus the injected listing.
 */
export const heldBackListRoute = defineJsonRoute<undefined, HeldBackListing, HeldBackListRouteDeps, ThemeRoutePrincipal>({
  method: "get",
  path: BASE,
  parse: () => ok({ value: undefined }),
  handle: ({ deps, authorize }) => refusing(deps, async () => {
    await authorizeThemes({ authorize, permission: HELD_BACK_READ_PERMISSION, entityType: "theme" });
    return ok({ value: await deps.listHeldBack() });
  }),
});

/**
 * POST `/check` — the fresh re-check, plus, only when it passes, the plan the approval card confirms.
 * Gated on `theme.set`; nothing is planned for a failing check.
 * @complexity O(1) plus the injected check and plan.
 */
export function heldBackCheckRoute<TPrincipal extends ThemeRoutePrincipal>() {
  return defineJsonRoute<HeldBackCheckInput, HeldBackCheckResult & { approval: HeldBackPlan | null }, HeldBackCheckRouteDeps<TPrincipal>, TPrincipal>({
    method: "post",
    path: BASE + "/check",
    parse: (raw) => ok({ value: { themeId: String(bodyRecord({ body: raw.body }).themeId ?? "") } }),
    handle: ({ input, deps, context, authorize }) => refusing(deps, async () => {
      await authorizeThemes({ authorize, permission: HELD_BACK_READ_PERMISSION, entityType: "theme" });
      const check = deps.checkTheme({ themeId: input.themeId });
      const planned = check.passes && check.digest
        ? await deps.planRestore({ principal: requirePrincipal(context), themeId: check.themeId, digest: check.digest })
        : null;
      return ok({ value: { ...check, approval: planned ? { planId: planned.planId, planHash: planned.planHash } : null } });
    }),
  });
}

/**
 * POST `/restore/approval` — the approval card's answer. Only an explicit `"approve"` mints a token;
 * a decline, or any other value, mints nothing, so there is nothing a later restore could redeem.
 * Gated on `theme.edit`, before the decision is read.
 * @complexity O(1) plus the injected confirmation.
 */
export function heldBackApprovalRoute<TPrincipal extends ThemeRoutePrincipal>() {
  return defineJsonRoute<HeldBackApprovalInput, { approved: boolean; confirmationToken?: string }, HeldBackApprovalRouteDeps<TPrincipal>, TPrincipal>({
    method: "post",
    path: BASE + "/restore/approval",
    parse: (raw) => {
      const body = bodyRecord({ body: raw.body });
      return ok({ value: { decision: body.decision, planId: stringField(body, "planId"), planHash: stringField(body, "planHash") } });
    },
    handle: ({ input, deps, context, authorize }) => refusing(deps, async () => {
      await authorizeThemes({ authorize, permission: HELD_BACK_RESTORE_PERMISSION, entityType: "theme" });
      if (input.decision !== "approve") return ok({ value: { approved: false } });
      if (!input.planId || !input.planHash) return approvalRequired();
      const record = await deps.confirmRestore({ principal: requirePrincipal(context), planId: input.planId, planHash: input.planHash });
      return ok({ value: { approved: true, confirmationToken: record.confirmationToken } });
    }),
  });
}

/**
 * POST `/restore` — redeems the approval, then moves the theme. The host's gateway re-authorizes,
 * checks the token is unspent and was confirmed by this actor in this workspace, and re-derives the
 * plan for this theme at the echoed digest; the move itself then re-checks the files against that
 * digest. The token is spent before the move, so a move refused for changed files needs a fresh
 * approval, and previews refresh only after a move that succeeded. Gated on `theme.edit`, before
 * the body's digest or token is read.
 * @complexity O(1) plus the injected restore.
 */
export function heldBackRestoreRoute<TPrincipal extends ThemeRoutePrincipal>() {
  return defineJsonRoute<HeldBackRestoreInput, unknown, HeldBackRestoreRouteDeps<TPrincipal>, TPrincipal>({
    method: "post",
    path: BASE + "/restore",
    parse: (raw) => {
      const body = bodyRecord({ body: raw.body });
      return ok({ value: { themeId: String(body.themeId ?? ""), approvedDigest: stringField(body, "approvedDigest"), confirmationToken: stringField(body, "confirmationToken") } });
    },
    handle: ({ input, deps, context, authorize }) => refusing(deps, async () => {
      await authorizeThemes({ authorize, permission: HELD_BACK_RESTORE_PERMISSION, entityType: "theme" });
      if (!input.approvedDigest || !input.confirmationToken) return approvalRequired();
      const result = await deps.restoreTheme({ principal: requirePrincipal(context), ...input });
      deps.refreshPreviews();
      return ok({ value: result });
    }),
  }, { successStatus: 201 });
}
