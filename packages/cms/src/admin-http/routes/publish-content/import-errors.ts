import { TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";

import { RestorePointUnavailableError } from "../../../publish/content/execute-import.js";
import { PublishContentBundleNotFoundError } from "../../../publish/content/gated-hooks.js";

/** The status and JSON body an import route sends for a thrown error. */
export interface ImportErrorResponse {
  status: number;
  body: { error: string; code: string; pluginId?: string; errorId?: string };
}

/**
 * The host's own classes behind the import refusals, injected because the gateway and plugin host are not the engine's.
 * `isStalePlan` is a plain boolean: a type predicate cannot name a destructured member, so the stale arm reads the
 * message only when the confirmed error is an `Error`.
 */
export interface ImportErrorHost {
  readForbiddenReason: (required: { error: unknown }) => { message: string; reasonCode: string } | undefined;
  isStalePlan: (required: { error: unknown }) => boolean;
  /** Answers only the fixed redacted plugin shape, never the plugin's own text. */
  pluginHookBody: (required: { error: unknown }) => ImportErrorResponse["body"] | undefined;
}

/** The typed message of a host-confirmed error; an unconfirmed value never renders. */
const typedMessage = ({ error }: { error: unknown }): string => (error instanceof Error ? error.message : "");

/**
 * The typed arms of an import route's error mapping; `undefined` for anything the host would answer as the redacted 500.
 * A recognised error keeps its own message; unknown failures never render exception text (it can quote a path, SQL or a credential).
 * @complexity O(1).
 */
export function knownImportErrorResponse({ err, host }: { err: unknown; host: ImportErrorHost }, _optional = {}): ImportErrorResponse | undefined {
  const forbidden = host.readForbiddenReason({ error: err });
  if (forbidden) return { status: 403, body: { error: forbidden.message, code: forbidden.reasonCode } };
  if (host.isStalePlan({ error: err })) return { status: 409, body: { error: typedMessage({ error: err }), code: "PLAN_STALE" } };
  if (err instanceof TokenExpiredError) return { status: 409, body: { error: err.message, code: "TOKEN_EXPIRED" } };
  if (err instanceof TokenAlreadyRedeemedError) return { status: 409, body: { error: err.message, code: "TOKEN_ALREADY_REDEEMED" } };
  if (err instanceof RestorePointUnavailableError) return { status: 409, body: { error: err.message, code: "RESTORE_POINT_UNAVAILABLE" } };
  if (err instanceof PublishContentBundleNotFoundError) return { status: 404, body: { error: err.message, code: "BUNDLE_NOT_FOUND" } };
  // Same envelope as the posts routes' plugin-hook failure, so a client tells a plugin's refusal apart from
  // any other internal error — and the same fixed text, never the plugin's own.
  const plugin = host.pluginHookBody({ error: err });
  return plugin ? { status: 500, body: plugin } : undefined;
}
