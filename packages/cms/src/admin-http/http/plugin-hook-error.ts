import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file P0c fix (hooks v2 plan, 2026-09-23) — a plugin hook's refusal has always been documented as
 * "caught by the caller, mapped to 500 `PLUGIN_HOOK_FAILED`", but before this envelope no route did
 * that: every content-save route's error mapper fell through to the generic `{error:"internal error"}`
 * 500 with no `code`, so a client could never tell a plugin's hook failure apart from any other
 * internal error. One shared envelope so every content-save route returns the SAME shape.
 *
 * The engine owns the envelope (status, code, which fields leave the server); the host injects what
 * is its own: which error class is a hook failure (the plugin host's class lives outside `cms`), the
 * public refusal text (product copy) and the secret redaction the log line goes through.
 */

/** What the envelope reads off a hook failure: the plugin's id and its (unsafe) diagnostic text. */
export interface PluginHookFailure { readonly pluginId: string; readonly message: string }

export interface PluginHookFailedBody {
  readonly error: string;
  readonly code: "PLUGIN_HOOK_FAILED";
  readonly pluginId: string;
}

/** The only part of a response `sendPluginHookFailedError` writes through (`status().json()`). */
export interface PluginHookErrorResponse {
  status(code: number): { json(body: unknown): unknown };
}

/** The host's half: class identity, public copy, redaction and the log sink. */
export interface PluginHookErrorDeps<E extends PluginHookFailure> {
  isPluginHookFailure: (err: unknown) => err is E;
  /** Fixed public text for a save refusal; never the error's own message. */
  refusalText: (err: E) => string;
  /** Strips secret shapes from the diagnostic line before it is logged. */
  redact: (text: string) => string;
  warn: (message: string) => void;
}

/** The bound envelope a host hands its routes. */
export interface PluginHookErrorEnvelope<E extends PluginHookFailure> {
  pluginHookFailedBody: (err: E, optional?: { publicText?: string }) => PluginHookFailedBody;
  sendPluginHookFailedError: (required: { res: PluginHookErrorResponse; err: unknown }, optional?: Record<string, never>) => boolean;
  rejectPluginHookFailure: (required: { err: unknown }, optional?: Record<string, never>) => void;
}

/**
 * Bind the `PLUGIN_HOOK_FAILED` envelope to the host's hook-failure class, copy and redaction.
 *
 * `error` is fixed text (`refusalText`, or `publicText` when the route is not a save), never
 * `err.message`: that quotes the plugin's own thrown error, which can carry a credential, SQL or a
 * path. The redacted message goes to the server log instead, the only place the cause survives.
 *
 * @complexity O(1) to bind; each body is O(n) in the diagnostic text scanned for secrets.
 */
export function createPluginHookErrorEnvelope<E extends PluginHookFailure>(
  deps: PluginHookErrorDeps<E>,
  _optional: Record<string, never> = {},
): PluginHookErrorEnvelope<E> {
  const pluginHookFailedBody = (err: E, optional: { publicText?: string } = {}): PluginHookFailedBody => {
    deps.warn(deps.redact(`[plugin-runtime] '${err.pluginId}' hook refused a request: ${err.message}`));
    return { error: optional.publicText ?? deps.refusalText(err), code: "PLUGIN_HOOK_FAILED", pluginId: err.pluginId };
  };
  return {
    pluginHookFailedBody,
    // Returns false (writes nothing) for any other error, so a route's own mapper falls through unchanged.
    sendPluginHookFailedError: ({ res, err }, _o = {}) => {
      if (!deps.isPluginHookFailure(err)) return false;
      res.status(500).json(pluginHookFailedBody(err));
      return true;
    },
    // Route specs: a thrown refusal keeps the flat body (with `pluginId`) through the host's error port.
    rejectPluginHookFailure: ({ err }, _o = {}) => {
      if (deps.isPluginHookFailure(err)) throw new RouteRefusalError({ status: 500, body: pluginHookFailedBody(err) });
    },
  };
}
