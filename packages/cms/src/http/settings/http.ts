import type { Request, Response } from "express";
import {
  AliasDepthExceededError, DefinitionInvalidError, DefinitionNotFoundError, DefinitionTombstonedError,
  ForbiddenError, PrincipalNotFoundError, RenameRetypeConflictError, ScopeNotAllowedError,
  SecretNotSupportedError, ValueValidationFailedError, type SettingScope,
} from "../../settings/index.js";
import type { JsonValue } from "@jini-ai/core/primitives";
import type { SettingsHttpRequired, SettingsHttpOptions } from "./contracts.js";
import { respondToSettingsError, resolveTargetWorkspaceId, resolveUserLayerReadTarget, settingsWritePermission,
  type SettingsErrorMapping } from "./shared.js";
import { openSettingsChangeStream } from "./stream.js";

const VALUE_ERRORS: readonly SettingsErrorMapping[] = [
  { matches: (e) => e instanceof PrincipalNotFoundError, status: 404, code: "PRINCIPAL_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionNotFoundError, status: 404, code: "DEFINITION_NOT_FOUND" },
  { matches: (e) => e instanceof DefinitionTombstonedError, status: 409, code: "DEFINITION_TOMBSTONED" },
  { matches: (e) => e instanceof ScopeNotAllowedError, status: 400, code: "SCOPE_NOT_ALLOWED" },
  { matches: (e) => e instanceof ValueValidationFailedError, status: 400, code: "VALUE_VALIDATION_FAILED" },
  { matches: (e) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" },
];
const DEFINITION_ERRORS: readonly SettingsErrorMapping[] = [
  { matches: (e) => e instanceof SecretNotSupportedError, status: 400, code: "SECRET_NOT_SUPPORTED" },
  { matches: (e) => e instanceof DefinitionInvalidError, status: 400, code: "DEFINITION_INVALID" },
  { matches: (e) => e instanceof RenameRetypeConflictError, status: 409, code: "RENAME_RETYPE_CONFLICT" },
  { matches: (e) => e instanceof AliasDepthExceededError, status: 409, code: "ALIAS_DEPTH_EXCEEDED" },
  { matches: (e) => e instanceof DefinitionTombstonedError, status: 409, code: "DEFINITION_TOMBSTONED" },
  { matches: (e) => e instanceof ForbiddenError, status: 403, code: "FORBIDDEN" },
];
const RESET_ERRORS = VALUE_ERRORS.filter((m) => m.code === "FORBIDDEN");
const scopes: readonly string[] = ["global", "workspace", "user"];
function validation(res: Response, error: string): void {
  res.status(400).json({ error, code: "VALIDATION_ERROR" });
}
function denied(res: Response, principalId: string, permission: string, reason: string): void {
  res.status(403).json({ error: `principal '${principalId}' is not authorized for '${permission}' (${reason})`,
    code: "FORBIDDEN", details: { permission, reason } });
}
function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
}

/** Mount all eight endpoints. The returned disposer closes active feeds and cancels their schedules. */
/** Injected policy and services preserve the settings HTTP response envelopes.
 * O(1) mounting; read/mutation work is delegated. Feed resources are bounded per connection.
 * @example registerSettingsRoutes({ app, workspaceId, ready, service, changeFeed, principalResolver, authorize, scheduler, routes, permissions });
 */
export function registerSettingsRoutes(required: SettingsHttpRequired, optional: SettingsHttpOptions = {}): { dispose(): void } {
  const { app, workspaceId, service, routes, permissions } = required;
  const streams = new Set<() => void>();
  let disposed = false;
  type Handler = (req: Request, res: Response, principalId: string) => Promise<void>;
  const wrap = (handler: Handler, mappings: readonly SettingsErrorMapping[] = []) => async (req: Request, res: Response): Promise<void> => {
    if (disposed) { res.status(503).json({ error: "settings routes are disposed", code: "UNAVAILABLE" }); return; }
    if (String(req.params[routes.workspaceParam] ?? "") !== workspaceId) {
      res.status(404).json({ error: "workspace was not found" }); return;
    }
    let principal: { id: string } | null;
    try {
      await required.ready;
      principal = await required.principalResolver({ request: req, response: res });
    } catch {
      // Readiness/principal failures preserve the authentication boundary's existing 401 envelope.
      res.status(401).json({ error: "unauthenticated", code: "UNAUTHENTICATED" }); return;
    }
    if (!principal) { res.status(401).json({ error: "unauthenticated", code: "UNAUTHENTICATED" }); return; }
    try {
      await handler(req, res, principal.id);
    } catch (error) {
      if (res.headersSent) {
        // Reporting cannot prevent ending a response whose headers have already been sent.
        try { optional.onError?.({ operation: "settings-request", error }); }
        catch { /* Host diagnostics are best-effort. */ }
        finally { res.end(); }
      } else respondToSettingsError({ response: res, error, mappings });
    }
  };
  const check = async (res: Response, principalId: string, permission: string, entityType: string): Promise<boolean> => {
    const result = await required.authorize({ principalId, permission, workspaceId, entityType });
    if (!result.allowed) denied(res, principalId, permission, result.reason);
    return result.allowed;
  };
  const readTarget = async (res: Response, principalId: string, requestedPrincipalId: string | undefined) => {
    const result = await resolveUserLayerReadTarget({ deps: { workspaceId, authorize: required.authorize, permission: permissions.readOtherUser },
      input: { callerPrincipalId: principalId, requestedPrincipalId } });
    if (!result.allowed) res.status(403).json({
      error: `principal '${principalId}' is not authorized to read another principal's user-layer value (${result.reason})`,
      code: "FORBIDDEN", details: { permission: permissions.readOtherUser, reason: result.reason },
    });
    return result;
  };
  app.get(routes.definitions, wrap(async (_req, res, principalId) => {
    if (!await check(res, principalId, permissions.readDefinitions, "setting-definition")) return;
    const definitions = await service.listDefinitions({ workspaceId });
    const data = definitions.map(({ namespace, key, ownerKind, scopes, status, version }) => ({ namespace, key, ownerKind, scopes, status, version }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));
    res.json({ data });
  }));
  app.get(routes.effective, wrap(async (req, res, principalId) => {
    if (!await check(res, principalId, permissions.read, "setting-value")) return;
    const namespace = String(req.query.namespace ?? "");
    if (!namespace) { validation(res, "'namespace' query param is required"); return; }
    const target = await readTarget(res, principalId, req.query.principalId ? String(req.query.principalId) : principalId);
    if (!target.allowed) return;
    res.json({ data: await service.effective({ namespace, workspaceId, principalId: target.principalId }) });
  }));
  app.get(routes.raw, wrap(async (req, res, principalId) => {
    if (!await check(res, principalId, permissions.readRaw, "setting-value")) return;
    const namespace = String(req.query.namespace ?? "");
    const key = String(req.query.key ?? "");
    if (!namespace || !key) { validation(res, "'namespace' and 'key' query params are required"); return; }
    const target = await readTarget(res, principalId, req.query.principalId ? String(req.query.principalId) : undefined);
    if (!target.allowed) return;
    const result = await service.raw({ namespace, key, workspaceId, principalId: target.principalId });
    if (!result) { res.status(404).json({ error: `definition '${namespace}.${key}' was not found`, code: "DEFINITION_NOT_FOUND" }); return; }
    res.json(result);
  }));
  app.post(routes.definitions, wrap(async (req, res, principalId) => {
    if (!await check(res, principalId, permissions.manageDefinitions, "setting-definition")) return;
    const items = bodyOf(req).definitions;
    if (!Array.isArray(items)) { validation(res, "'definitions' must be an array"); return; }
    const result = await service.definitions({ items, callerPrincipalId: principalId, authWorkspaceId: workspaceId });
    if ("unknownOp" in result) { validation(res, `unknown op '${result.unknownOp}'`); return; }
    res.json(result);
  }, DEFINITION_ERRORS));

  const mutate = (operation: "set" | "clear"): Handler => async (req, res, callerPrincipalId) => {
    const body = bodyOf(req);
    const namespace = String(body.namespace ?? "");
    const key = String(body.key ?? "");
    const scope = body.scope as SettingScope;
    if (!namespace || !key || !scopes.includes(scope) || (operation === "set" && !("valueJson" in body))) {
      validation(res, operation === "set" ? "namespace, key, scope (global|workspace|user), and valueJson are required" : "namespace, key, and scope (global|workspace|user) are required"); return;
    }
    const target = resolveTargetWorkspaceId({ workspaceId, input: { bodyWorkspaceId: body.workspaceId, scope } });
    if (!target.ok) { validation(res, target.error); return; }
    const principalId = body.principalId ? String(body.principalId) : undefined;
    const permission = settingsWritePermission({ permissions, scope, callerPrincipalId, targetPrincipalId: principalId });
    if (!await check(res, callerPrincipalId, permission, "setting-value")) return;
    const input = { namespace, key, scope, workspaceId: target.workspaceId, principalId, callerPrincipalId, authWorkspaceId: workspaceId };
    const result = operation === "set" ? await service.set({ ...input, value: body.valueJson as JsonValue }) : await service.clear(input);
    res.json({ key: `${namespace}.${key}`, scope, value: "value" in result ? result.value : null, revisionSeq: result.revisionSeq });
  };
  app.put(routes.value, wrap(mutate("set"), VALUE_ERRORS));
  app.delete(routes.value, wrap(mutate("clear"), VALUE_ERRORS.filter((m) => m.code !== "VALUE_VALIDATION_FAILED")));
  app.post(routes.reset, wrap(async (req, res, callerPrincipalId) => {
    const body = bodyOf(req);
    const namespace = String(body.namespace ?? "");
    const scope = body.scope as SettingScope;
    if (!namespace || !scopes.includes(scope)) { validation(res, "namespace and scope (global|workspace|user) are required"); return; }
    const target = resolveTargetWorkspaceId({ workspaceId, input: { bodyWorkspaceId: body.workspaceId, scope } });
    if (!target.ok) { validation(res, target.error); return; }
    if (!await check(res, callerPrincipalId, permissions.reset[scope], "setting-namespace")) return;
    const result = await service.reset({ namespace, scope, workspaceId: target.workspaceId, callerPrincipalId, authWorkspaceId: workspaceId });
    res.json({ namespace, ...result });
  }, RESET_ERRORS));
  app.get(routes.events, wrap(async (req, res, principalId) => {
    if (!await check(res, principalId, permissions.read, "setting-value")) return;
    const close = await openSettingsChangeStream({ request: req, response: res, workspaceId, principalId,
      changeFeed: required.changeFeed, authorize: required.authorize, permission: permissions.read, scheduler: required.scheduler,
      onClose: ({ close }) => { streams.delete(close); }, isDisposed: () => disposed }, optional);
    if (close) {
      if (disposed) close();
      else if (!res.destroyed && !res.writableEnded) streams.add(close);
    }
  }));
  return { dispose: () => { disposed = true; for (const close of streams) close(); streams.clear(); } };
}
