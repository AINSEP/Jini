import { isSameOriginBrowserWrite } from "@jini-ai/core/contracts/server";

export function savedKeysSameOrigin({ origin, host, fetchSite, protocol }: { origin: string | undefined; host: string | undefined; fetchSite: string | undefined; protocol: string }, _optional = {}): boolean {
  return isSameOriginBrowserWrite({ origin, host, fetchSite }) && origin !== undefined && host !== undefined && origin === `${protocol}://${host}`;
}

export function savedShareRefusalStatus({ code }: { code: string }, _optional = {}): 400 | 403 | 404 {
  return code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 400;
}

/** Parser errors describe a failed upload, while unexpected storage faults remain incidents. */
export function savedShareUploadRefusal({ error }: { error: unknown }, _optional = {}): { status: 400 | 413; code: "INVALID_INPUT" | "LIMIT_EXCEEDED" } | undefined {
  const type = (error as { type?: string } | null)?.type;
  if (!type || !["entity.too.large", "encoding.unsupported", "entity.parse.failed", "request.aborted", "request.size.invalid"].includes(type)) return undefined;
  return { status: type === "entity.too.large" ? 413 : 400, code: type === "entity.too.large" ? "LIMIT_EXCEEDED" : "INVALID_INPUT" };
}

/** Shared by opt-in export and explicit reveal. Owner identity is stronger than general backup
 * permission; a connected-computer, tool or API credential must never reveal an archive password.
 * @complexity O(1) checks, before any share lookup or secret open.
 */
export async function requireSavedKeysOwnerSession({ deps }: { deps: {
  noStore: () => void;
  foreignWorkspace: () => boolean;
  requireSession: () => boolean;
  publishTrustContext: () => unknown;
  principalId: () => string;
  ownerPrincipalId: () => PromiseLike<string> | string;
  sameOrigin: () => boolean;
  json: (body: unknown, status: number) => void;
  ownerMessage: string;
} }, _optional = {}): Promise<boolean> {
  deps.noStore();
  if (deps.foreignWorkspace()) { deps.json({ code: "NOT_FOUND", message: "Saved keys access failed: this workspace is not available." }, 404); return false; }
  if (!deps.requireSession()) return false;
  if (deps.publishTrustContext() || deps.principalId() !== await deps.ownerPrincipalId()) { deps.json({ code: "FORBIDDEN", message: deps.ownerMessage }, 403); return false; }
  if (!deps.sameOrigin()) { deps.json({ code: "FORBIDDEN", message: deps.ownerMessage }, 403); return false; }
  return true;
}

const SITE_EXPORT_FAILURE_MESSAGES = {
  prepare: "The export stopped while preparing the site files.",
  archive: "The export stopped while building the ZIP.",
  delivery: "The export stopped while saving or delivering the ZIP.",
};

/** Share and password failures must remain diagnosable even when telemetry is disabled.
 * Expected refusals keep their safe public diagnosis. The authorized export pilot discloses its
 * redacted cause; other unexpected details stay in redacted logs.
 * @complexity The shared redaction cost, with one local log and one tracker report.
 */
export function sendSiteShareFailure({ error, deps }: { error: unknown; deps: {
  refusal: abstract new (...args: never[]) => Error & { code: string };
  exportFailure: abstract new (...args: never[]) => Error & { step: 'prepare' | 'archive' | 'delivery'; cause?: unknown; appVersion?: string | undefined; jiniVersion?: string | undefined; time?: string | undefined };
  json: (body: unknown, status: number) => void;
  failure: (error: unknown, options: { operation: string; code: string; field: 'message'; message: string; failure: { action: string; step: string; cause?: unknown; metadata?: Record<string, unknown> } }) => void;
} }, { password = false, step }: { password?: boolean; step?: string } = {}): void {
  if (sendShareRefusal({ error, deps }, { password, step })) return;
  if (sendShareUploadRefusal({ error, deps }, { step })) return;
  deps.failure(error, shareFailureOptions({ error, step, password, deps }));
}

function shareFailureMessage({ step, password }: { step: string | undefined; password: boolean }): string {
  if (step) return `${step} could not finish.`;
  return password ? "Export password is unavailable for this site." : "The share operation could not finish.";
}

/** Preserve safe refusals and their established status codes without generating an incident. */
function sendShareRefusal({ error, deps }: Parameters<typeof sendSiteShareFailure>[0], { password, step }: { password: boolean; step: string | undefined }): boolean {
  if (!(error instanceof deps.refusal)) return false;
  const status = savedShareRefusalStatus({ code: error.code });
  const message = password ? shareFailureMessage({ step, password }) : step ? `${step} failed: ${error.message}` : error.message;
  deps.json({ code: error.code, message }, status);
  return true;
}

/** Map only export-owned stages to public explanations; never guess a provider-specific remedy. */
function shareFailureOptions({ error, step, password, deps }: Parameters<typeof sendSiteShareFailure>[0] & { step: string | undefined; password: boolean }): Parameters<Parameters<typeof sendSiteShareFailure>[0]['deps']['failure']>[1] {
  const common = { operation: step ? `site-share:${step}` : "site-share", code: "SHARE_FAILED", field: "message" as const };
  const action = "Copy details and report this problem. Check export history before starting another export.";
  if (error instanceof deps.exportFailure) {
    const metadata = Object.fromEntries(Object.entries({ appVersion: error.appVersion, jiniVersion: error.jiniVersion, time: error.time }).filter(([, value]) => value !== undefined));
    return { ...common, message: SITE_EXPORT_FAILURE_MESSAGES[error.step], failure: { action, step: error.step, cause: error.cause, metadata } };
  }
  return { ...common, message: shareFailureMessage({ step, password }), failure: { action, step: step ?? "site-share" } };
}

/** Parser errors describe a failed upload, while unexpected storage faults remain incidents. */
function sendShareUploadRefusal({ error, deps }: Parameters<typeof sendSiteShareFailure>[0], { step = "Share artifact upload" }: { step?: string | undefined } = {}): boolean {
  const refusal = savedShareUploadRefusal({ error });
  if (!refusal) return false;
  deps.json({ code: refusal.code, message: `${step} failed: upload raw application/zip bytes within the 300 MiB cap.` }, refusal.status);
  return true;
}

/** Register on POST …/site-shares/:shareId/password after the existing session middleware.
 * The backend owns record/workspace lookup and password opening; this boundary adds browser-only
 * owner and CSRF checks. Every outcome, including denial, remains non-cacheable.
 */
export function createSiteSharePasswordHandler({ readBackend }: {
  readBackend: () => { revealPassword(required: { principalId: string; shareId: string }): Promise<unknown> } | undefined;
}, _optional = {}) {
  return async ({ owner, principalId, shareId, json, failure }: {
    owner: Parameters<typeof requireSavedKeysOwnerSession>[0]["deps"];
    principalId: () => string; shareId: () => string;
    json: (body: unknown, status: number) => void;
    failure: (error: unknown, options: { password: true }) => void;
  }): Promise<void> => {
    try {
      if (!await requireSavedKeysOwnerSession({ deps: owner })) return;
      const backend = readBackend();
      if (!backend) { json({ code: "UNAVAILABLE", message: "Export password lookup failed: saved keys are unavailable." }, 503); return; }
      json(await backend.revealPassword({ principalId: principalId(), shareId: shareId() }), 200);
    } catch (error) {
      failure(error, { password: true });
    }
  };
}
