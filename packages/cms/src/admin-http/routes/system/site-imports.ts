/**
 * @file The framework-neutral decisions behind the admin site-import routes: which step a request
 * belongs to, how a failed step maps to its HTTP answer, the fixed refusal bodies of the shared gate,
 * the owner-setup response contract and the owner-setup body check.
 *
 * Registration uses neutral request facts and injected socket/body-parser effects. This module sees plain values only. The host's refusal
 * class and byte formatter are injected as {@link SiteImportFailureCollaborators}.
 */

import { defineJsonRoute, err, ok, type Result } from '@jini-ai/core/contracts/server';
import type { SiteImportPage, SiteImportPageInput, SiteImportSource, SiteImportView } from '@jini-ai/core/contracts/site/site-import-history';

export type SiteImportListQuery = { cursor?: string };
export interface SiteImportListPrincipal { principalId: string }
export interface SiteImportListRouteDeps {
  listPage: (required: SiteImportPageInput, optional?: Record<string, never>) => Promise<SiteImportPage>;
}

export function parseSiteImportListQuery({ query }: { query: Record<string, unknown> }, _optional: Record<string, never> = {}): Result<{ cursor?: string }> {
  if (Object.keys(query).some(key => key !== 'cursor') || ('cursor' in query && (typeof query.cursor !== 'string' || query.cursor.length < 1 || query.cursor.length > 96 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)))) {
    return err({ error: { code: 'INVALID_CURSOR', message: 'This list of imports changed. Reload it to see the newest imports.' } });
  }
  return ok({ value: query.cursor === undefined ? {} : { cursor: query.cursor as string } });
}

export const siteImportListRouteSpec = defineJsonRoute<SiteImportListQuery, SiteImportPage, SiteImportListRouteDeps, SiteImportListPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/site-imports',
  parse: ({ query }) => parseSiteImportListQuery({ query }),
  async handle({ input, deps, context }) {
    if (!context?.principalId) return err({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
    return ok({ value: await deps.listPage({ ...input, principalId: context.principalId }, {}) });
  },
});

/** One HTTP answer: status plus the JSON body. */
export interface SiteImportReply {
  readonly status: number;
  readonly body: unknown;
}

/** What the host injects to classify and format a failed import step. Method syntax on purpose. */
export interface SiteImportFailureCollaborators {
  /** The host's own refusal (a deliberate, user-facing rejection), or `undefined` for anything else. */
  asRefusal(required: { error: unknown }): { readonly code: string; readonly message: string } | undefined;
  /** Human-readable byte size for the parser's limit (`300 MiB`). */
  formatByteSize(required: { bytes: number }): string;
}

/** The fields a host reports for an unexpected (non-refusal) failure of a step. */
export interface SiteImportIncident {
  readonly operation: string;
  readonly code: "IMPORT_FAILED";
  readonly message: string;
  readonly field: "message";
}

const STEPS: Readonly<Record<string, string>> = {
  "GET ": "Import history",
  "POST ": "Archive verification",
  "POST /uploads": "ZIP upload",
  "GET /:importId/owner": "Import owner setup",
  "POST /:importId/owner": "Imported site creation",
};

/** Body-parser refusals that are bad uploads (400), keyed by the parser's error `type`. */
const PARSER_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["encoding.unsupported", "send an uncompressed request body."],
  ["entity.parse.failed", "the request body could not be parsed."],
  ["request.aborted", "the request ended before the complete body arrived."],
  ["request.size.invalid", "the body size does not match the Content-Length header."],
]);

const OWNER_BODY_KEYS: readonly string[] = ["adminPassword", "savedKeysPassword"];

/**
 * Each import boundary reports its own step while keeping provider diagnostics private.
 *
 * @param method - the request's HTTP method.
 * @param routePath - the matched route's registered path (empty when none matched).
 * @complexity O(1).
 */
export function importStep({ method, routePath }: { method: string; routePath: string }, _optional = {}): string {
  const suffix = routePath.split("site-imports")[1] ?? "";
  return STEPS[`${method} ${suffix}`] ?? "Site import";
}

/**
 * Maps a failed import step onto its HTTP answer: refusals and parser errors are 4xx. `undefined`
 * means an internal incident, which the host reports through its own failure sink using
 * {@link importIncident} — never a 400.
 *
 * @complexity O(1).
 */
export function mapImportFailure(
  { step, error, collaborators }: { step: string; error: unknown; collaborators: SiteImportFailureCollaborators },
  _optional = {},
): SiteImportReply | undefined {
  const refusal = collaborators.asRefusal({ error });
  if (refusal) return { status: refusal.code === "NOT_FOUND" ? 404 : 400, body: { code: refusal.code, message: `${step} failed: ${refusal.message}` } };
  return parserFailureReply({ step, error, collaborators });
}

/** A body-parser error's 413/400 answer, or `undefined` for anything that is not a parser refusal. @complexity O(1). */
function parserFailureReply(
  { step, error, collaborators }: { step: string; error: unknown; collaborators: SiteImportFailureCollaborators },
): SiteImportReply | undefined {
  // entity.too.large carries the parser's configured byte limit, independent of the step label.
  const { type, limit } = (error ?? {}) as { type?: string; limit: number };
  const tooLarge = type === "entity.too.large";
  // Parser refusals are bad uploads; a backend failure is an internal incident, never a 400.
  const parserMessage = PARSER_MESSAGES.get(type ?? "");
  if (!tooLarge && !parserMessage) return undefined;
  return {
    status: tooLarge ? 413 : 400,
    body: { code: tooLarge ? "LIMIT_EXCEEDED" : "IMPORT_FAILED",
      message: `${step} failed: ${tooLarge ? `the request is over the ${collaborators.formatByteSize({ bytes: limit })} limit for this step.` : parserMessage}` },
  };
}

/** What a host reports when {@link mapImportFailure} has no answer for a step. @complexity O(1). */
export function importIncident({ step }: { step: string }, _optional = {}): SiteImportIncident {
  return { operation: `site-import:${step}`, code: "IMPORT_FAILED", message: `${step} failed. No existing site was changed.`, field: "message" };
}

/** The shared gate's answer when the URL's workspace is not this server's. @complexity O(1). */
export function workspaceUnavailableReply({ step }: { step: string }, _optional = {}): SiteImportReply {
  return { status: 404, body: { code: "NOT_FOUND", message: `${step} failed: this workspace is not available.` } };
}

/** The shared gate's answer when no import backend is configured. @complexity O(1). */
export function importUnavailableReply({ step }: { step: string }, _optional = {}): SiteImportReply {
  return { status: 503, body: { code: "UNAVAILABLE", message: `${step} requires local site creation and a configured sites home.` } };
}

/** The answer to a second ZIP upload while the single upload lane is held. @complexity O(1). */
export function uploadBusyReply(_required: Record<string, never> = {}, _optional = {}): SiteImportReply {
  return { status: 409, body: { code: "BUSY", message: "Another ZIP upload is running." } };
}

/**
 * The owner-setup contract `GET …/owner` returns beside the import view: how the separately-owned UI
 * must submit the new owner password. Saved keys get their own field only when the import has them.
 *
 * @complexity O(1) besides copying the view.
 */
export function ownerSetupBody<T extends { readonly hasEncryptedKeys?: boolean | undefined }>({ imported }: { imported: T }, _optional = {}): T & { readonly ownerSetup: Readonly<Record<string, unknown>> } {
  return { ...imported, ownerSetup: { method: "POST", field: "adminPassword", username: "admin", sessionRequired: true, ...(imported.hasEncryptedKeys ? { savedKeysPasswordField: "savedKeysPassword" } : {}) } };
}

/** The owner-setup request body once validated: only the two password fields are ever accepted. */
export interface OwnerSetupInput {
  readonly adminPassword: string;
  readonly savedKeysPassword?: string;
}

/**
 * Checks the owner-setup body carries no field beyond the new owner password and the optional saved
 * keys password. A refusal is returned as `{ refusal }` for the host to raise as its own refusal type.
 *
 * @complexity O(keys).
 */
export function parseOwnerSetupBody({ body }: { body: unknown }, _optional = {}): { readonly input: OwnerSetupInput } | { readonly refusal: string } {
  if (!body || Object.keys(body).some(key => !OWNER_BODY_KEYS.includes(key))) return { refusal: "Only the new owner password and optional saved keys password are accepted." };
  const fields = body as { adminPassword: string; savedKeysPassword?: string };
  return { input: { adminPassword: fields.adminPassword, ...(fields.savedKeysPassword === undefined ? {} : { savedKeysPassword: fields.savedKeysPassword }) } };
}

export async function importSiteBackup({ backend, body, parseInput, principalId, signal }: {
  backend: { importBackup: (required: { principalId: string; source: SiteImportSource; displayName?: string; requestId?: string }, optional?: { signal?: AbortSignal }) => Promise<SiteImportView> };
  body: () => unknown;
  parseInput: (required: { input: unknown }, optional?: Record<string, never>) => { source: SiteImportSource; displayName?: string; requestId?: string };
  principalId: () => string;
  signal: () => AbortSignal;
}, _optional = {}) {
  const input = parseInput({ input: body() });
  const principal = principalId();
  return backend.importBackup({ ...input, principalId: principal }, { signal: signal() });
}

export function readSiteImportOwner({ backend, principalId, importId }: {
  backend: { get: (required: { principalId: string; importId: string }) => SiteImportView };
  principalId: () => string; importId: () => string;
}, _optional = {}) {
  const imported = backend.get({ principalId: principalId(), importId: importId() });
  return ownerSetupBody({ imported });
}

export async function completeSiteImportOwner({ body, backend: readBackend, principalId, importId, signal, refusal }: {
  body: () => unknown;
  backend: () => { completeOwner: (required: { principalId: string; importId: string; adminPassword: unknown; savedKeysPassword?: unknown }, optional?: { signal?: AbortSignal }) => Promise<SiteImportView> } | undefined;
  principalId: () => string; importId: () => string; signal: () => AbortSignal;
  refusal: (required: { code: 'INVALID_INPUT'; message: string }) => Error;
}, _optional = {}) {
  const parsed = parseOwnerSetupBody({ body: body() });
  if ('refusal' in parsed) throw refusal({ code: 'INVALID_INPUT', message: parsed.refusal });
  const backend = readBackend();
  if (!backend) throw new Error('site import owner setup has no import backend');
  return backend.completeOwner({ principalId: principalId(), importId: importId(), ...parsed.input }, { signal: signal() });
}

export function createSiteImportUploadLane(required: { uploadDeadlineMs: number; uploadIdleMs: number; setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout }, _optional = {}) {
  let uploadBusy = false;
  return {
    admit(request: { json: (body: unknown, status: number) => void; destroy: () => void; setIdleTimeout: (milliseconds: number, callback: () => void) => void; onClose: (callback: () => void) => void }): boolean {
      if (uploadBusy) { const reply = uploadBusyReply(); request.json(reply.body, reply.status); return false; }
      uploadBusy = true;
      const deadline = required.setTimeout(request.destroy, required.uploadDeadlineMs);
      deadline.unref();
      request.setIdleTimeout(required.uploadIdleMs, request.destroy);
      request.onClose(() => { required.clearTimeout(deadline); uploadBusy = false; });
      return true;
    },
  };
}

export function answerSiteImportFailure({ error: caught, step, request, required }: {
  error: unknown; step: string;
  request: Parameters<Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]["handle"]>[0];
  required: Parameters<typeof registerSiteImportRoutes>[0];
}, _optional = {}): void {
  let error = caught;
  try { required.mapHistoryError(error); }
  catch (mapped) { error = mapped; }
  if (error instanceof required.historyUnavailable) {
    request.failure(error, { code: error.code, message: error.message, status: error.status, field: "message" });
    return;
  }
  const mapped = mapImportFailure({ step, error, collaborators: required.failureCollaborators });
  if (mapped) { request.json(mapped.body, mapped.status); return; }
  request.failure(error, importIncident({ step }));
}

export function registerSiteImportRoutes(required: {
  workspaceId: string;
  mount(required: { method: "get" | "post"; path: string; handle: (request: {
    workspaceId: () => string; principalId: () => string;
    authorize: (params: { principalId: string; workspaceId: string; permission: string; entityType: string }) => Promise<boolean>;
    requireSession: (required: { message: string; permission: string }) => boolean;
    noStore: (headers: Readonly<Record<string, string>>) => void;
    json: (body: unknown, status: number) => void;
    failure: (error: unknown, options: SiteImportIncident | { code: string; message: string; status: number; field: "message" }) => void;
    body: () => unknown; query: () => Record<string, unknown>; importId: () => string;
    origin: () => string | undefined; protocol: () => string; host: () => string | undefined;
    parseZip: (options: { type: "application/zip"; limit: number; inflate: false }) => Promise<void>;
    parseForm: (options: { extended: false; limit: "8kb" }) => Promise<void>;
    isBuffer: (value: unknown) => value is Uint8Array;
    onClose: (callback: () => void) => void; onAborted: (callback: () => void) => void; writableEnded: () => boolean;
    destroy: () => void; setIdleTimeout: (milliseconds: number, callback: () => void) => void;
  }) => Promise<void> }): void;
  backend: () => (Parameters<typeof importSiteBackup>[0]["backend"] & Parameters<typeof readSiteImportOwner>[0]["backend"] & NonNullable<ReturnType<Parameters<typeof completeSiteImportOwner>[0]["backend"]>> & SiteImportListRouteDeps & { upload(required: { principalId: string; archive: Uint8Array }): Promise<unknown> }) | undefined;
  parseInput: Parameters<typeof importSiteBackup>[0]["parseInput"];
  refusal: Parameters<typeof completeSiteImportOwner>[0]["refusal"];
  mapHistoryError: (error: unknown) => void;
  historyUnavailable: abstract new (...args: never[]) => Error & { code: string; status: number };
  failureCollaborators: SiteImportFailureCollaborators;
  steps: { list: string; import: string; upload: string; ownerGet: string; ownerPost: string };
  ownerSessionMessage: string; originRefusalMessage: string;
  maxArchiveBytes: number; uploadDeadlineMs: number; uploadIdleMs: number;
  setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout;
}, _optional = {}): void {
  const lane = createSiteImportUploadLane(required);
  registerListAndImportRoutes(required);
  registerUploadRoute(required, lane);
  registerOwnerRoutes(required);
}

/** Common headers, workspace match, authorization and backend-availability gate; returns the backend or `false` after answering. */
async function gateImport({ required, request, step, permission }: {
  required: Parameters<typeof registerSiteImportRoutes>[0];
  request: Parameters<Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]["handle"]>[0];
  step: string; permission: string;
}, _optional = {}) {
  request.noStore({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
  if (request.workspaceId() !== required.workspaceId) { const reply = workspaceUnavailableReply({ step }); request.json(reply.body, reply.status); return false; }
  if (!await request.authorize({ principalId: request.principalId(), workspaceId: required.workspaceId, permission, entityType: "site-registry" })) return false;
  const backend = required.backend();
  if (!backend) { const reply = importUnavailableReply({ step }); request.json(reply.body, reply.status); return false; }
  return backend;
}

/** Owner-setup gate: a signed-in session only, then the normal write gate and an existing-import check. */
async function gateImportOwner(input: Omit<Parameters<typeof gateImport>[0], "permission">) {
  const { required, request } = input;
  if (!request.requireSession({ message: required.ownerSessionMessage, permission: "system.write" })) return false;
  const backend = await gateImport({ ...input, permission: "system.write" });
  if (!backend) return false;
  backend.get({ principalId: request.principalId(), importId: request.importId() });
  return backend;
}

function requestSignal(request: Parameters<Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]["handle"]>[0]) {
  const controller = new AbortController();
  request.onAborted(() => controller.abort());
  request.onClose(() => { if (!request.writableEnded()) controller.abort(); });
  return controller.signal;
}

function registerListAndImportRoutes(required: Parameters<typeof registerSiteImportRoutes>[0], _optional = {}): void {
  const root = siteImportListRouteSpec.path;
  required.mount({ method: "get", path: root, handle: async request => {
    try {
      const backend = await gateImport({ required, request, step: required.steps.list, permission: "system.read" });
      if (!backend) return;
      const principalId = request.principalId();
      // Authorization precedes query interpretation.
      const parsed = parseSiteImportListQuery({ query: request.query() });
      if (!parsed.ok) { request.json({ code: "INVALID_CURSOR", message: "Import history failed: This list of imports changed. Reload it to see the newest imports." }, 400); return; }
      const result = await siteImportListRouteSpec.handle({ input: parsed.value, deps: { listPage: input => backend.listPage(input) }, context: { principalId } });
      if (result.ok) request.json(result.value, 200);
      else request.json({ code: "INVALID_CURSOR", message: "Import history failed: This list of imports changed. Reload it to see the newest imports." }, 400);
    } catch (error) { answerSiteImportFailure({ required, request, error, step: required.steps.list }); }
  } });
  required.mount({ method: "post", path: root, handle: async request => {
    try {
      const backend = await gateImport({ required, request, step: required.steps.import, permission: "system.write" });
      if (!backend) return;
      const imported = await importSiteBackup({ backend, body: request.body, parseInput: required.parseInput, principalId: request.principalId, signal: () => requestSignal(request) });
      request.json(imported, 200);
    } catch (error) { answerSiteImportFailure({ required, request, error, step: required.steps.import }); }
  } });
}

function registerUploadRoute(required: Parameters<typeof registerSiteImportRoutes>[0], lane: ReturnType<typeof createSiteImportUploadLane>): void {
  required.mount({ method: "post", path: siteImportListRouteSpec.path + "/uploads", handle: async request => {
    try {
      if (!await gateImport({ required, request, step: required.steps.upload, permission: "system.write" })) return;
      if (!lane.admit(request)) return;
      await request.parseZip({ type: "application/zip", limit: required.maxArchiveBytes, inflate: false });
      if (!request.isBuffer(request.body())) throw required.refusal({ code: "INVALID_INPUT", message: "Upload raw application/zip bytes, not a filesystem path or base64 JSON." });
      const backend = required.backend();
      if (!backend) throw new Error("site import ZIP upload has no import backend");
      request.json(await backend.upload({ principalId: request.principalId(), archive: request.body() as Uint8Array }), 201);
    } catch (error) { answerSiteImportFailure({ required, request, error, step: required.steps.upload }); }
  } });
}

function registerOwnerRoutes(required: Parameters<typeof registerSiteImportRoutes>[0], _optional = {}): void {
  const path = siteImportListRouteSpec.path + "/:importId/owner";
  required.mount({ method: "get", path, handle: async request => {
    try {
      const backend = await gateImportOwner({ required, request, step: required.steps.ownerGet });
      if (!backend) return;
      request.json(readSiteImportOwner({ backend, principalId: request.principalId, importId: request.importId }), 200);
    } catch (error) { answerSiteImportFailure({ required, request, error, step: required.steps.ownerGet }); }
  } });
  required.mount({ method: "post", path, handle: async request => {
    try {
      if (!await gateImportOwner({ required, request, step: required.steps.ownerPost })) return;
      // Exact Origin prevents a sibling origin choosing a password with the owner's session.
      if (request.origin() !== request.protocol() + "://" + request.host()) { request.json({ code: "FORBIDDEN", message: required.originRefusalMessage }, 403); return; }
      await request.parseForm({ extended: false, limit: "8kb" });
      request.json(await completeSiteImportOwner({ body: request.body, backend: required.backend, principalId: request.principalId, importId: request.importId, signal: () => requestSignal(request), refusal: required.refusal }), 200);
    } catch (error) { answerSiteImportFailure({ required, request, error, step: required.steps.ownerPost }); }
  } });
}
