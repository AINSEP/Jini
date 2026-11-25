import type { BackstopAuditPort, BackstopAuditRecord, BackstopMetadata } from "../transfer/index.js";
import type { BackstopSelection } from "../transfer/index.js";
import type { PackedEntity } from "../transfer/index.js";

export const BACKSTOP_FORBIDDEN = "Only the owner and built-in admins can send items by hand.";

export async function mayUseBackstop(
  { actorId, ownerId, roles }: { actorId: string; ownerId: string; roles: { list(): Promise<readonly { name: string; isBuiltin: boolean }[]> } },
  _optional = {},
): Promise<boolean> {
  return actorId === ownerId || (await roles.list()).some((role) => role.isBuiltin && (role.name === "admin" || role.name === "owner"));
}

/** The host-owned rules the hand-send service runs on: the secret scan over free text, the gap label
 * a raw item reports, the immutable size caps and the exact refusal copy that names them. The caps
 * and their copy are one host decision, so both are injected together. */
export interface BackstopServicePolicy {
  checkRawValues(args: { values: Readonly<Record<string, unknown>> }, _optional?: object): string | null;
  gapLabelFor(
    args: { item: { entityType: "raw-row"; table: string } | { entityType: "raw-file"; relPath: string } },
    _optional?: object,
  ): string;
  limits: { readonly rows: number; readonly files: number; readonly bytes: number };
  copy: {
    /** Refusal for a selection with more rows or files than the caps allow. */
    readonly selectionLimit: string;
    /** Refusal for a received bundle over the row, file or total-size caps. */
    readonly bundleLimit: string;
  };
}

export interface BackstopService {
  validateBackstopRequest(
    args: { body: unknown; destinationHost: string },
    _optional?: object,
  ): { error: string } | { request: { reason: string; typedHost: string; selection: BackstopSelection } };
  runAuditedBackstop<T extends Record<string, unknown>>(
    args: { audit: BackstopAuditPort; record: BackstopAuditRecord; work: () => Promise<T>; successResult?: "success" | "planned" },
    _optional?: object,
  ): Promise<T>;
  readBackstopMetadata(args: { entities: readonly PackedEntity[] }, _optional?: object): BackstopMetadata | null;
}

/**
 * Binds the hand-send ("backstop") request validation, audited execution and destination-side
 * metadata check to the host's policy. `redact` strips credential-shaped text from a failure before
 * it is written to the audit sink; the host passes its own redactor.
 * @complexity O(1) to build; each bound function is as documented on it.
 */
export function createBackstopService(
  { policy, redact }: { policy: BackstopServicePolicy; redact: (args: { text: string }) => { text: string } },
  _optional = {},
): BackstopService {
  return {
    validateBackstopRequest: ({ body, destinationHost }, _optional = {}) => precheckBackstopRequest({ policy, body, destinationHost }),
    runAuditedBackstop: (args, _optional = {}) => executeAuditedBackstop({ redact, ...args }),
    readBackstopMetadata: ({ entities }, _optional = {}) => readAuthenticatedBackstopMetadata({ policy, entities }),
  };
}

function precheckBackstopRequest(
  { policy, body, destinationHost }: { policy: BackstopServicePolicy; body: unknown; destinationHost: string },
  _optional = {},
): { error: string } | { request: { reason: string; typedHost: string; selection: BackstopSelection } } {
  if (!isBackstopBody({ body })) return { error: "Choose items to send." };
  const b = body as Record<string, unknown>;
  if (!isBackstopReason({ reason: b.reason })) return { error: "Explain why you need this send in at least 10 characters." };
  if (b.typedHost !== destinationHost) return { error: `Type ${destinationHost} to confirm where this send will go.` };
  const rows = b.rows ?? [];
  const files = b.files ?? [];
  const selectionError = checkBackstopSelection({ rows, files, limits: policy.limits, copy: policy.copy });
  if (selectionError) return { error: selectionError };
  const reason = (b.reason as string).trim();
  const secret = policy.checkRawValues({ values: { reason } });
  if (secret) return { error: secret };
  return { request: { reason, typedHost: destinationHost, selection: { rows, files } as BackstopSelection } };
}

/** Persist a pending event BEFORE dialing live so failures leave a source-side record too. */
async function executeAuditedBackstop<T extends Record<string, unknown>>(
  { redact, audit, record, work, successResult = "success" }: {
    redact: (args: { text: string }) => { text: string };
    audit: BackstopAuditPort;
    record: BackstopAuditRecord;
    work: () => Promise<T>;
    successResult?: "success" | "planned";
  },
  _optional = {},
): Promise<T> {
  if (!(await audit.ready())) throw new Error("Send by hand needs its audit storage installed before it can send anything.");
  await audit.save({ record: { ...record, result: "pending" } });
  try {
    const result = await work();
    await audit.save({ record: { ...record, result: successResult, runId: typeof result.runId === "string" ? result.runId : record.runId, details: result } });
    return result;
  } catch (error) {
    // Audit storage is a diagnostic sink too: preserve useful text without persisting credentials.
    const diagnostic = redact({ text: error instanceof Error ? error.message : "This send failed." }).text;
    await audit.save({ record: { ...record, result: "failure", details: { error: diagnostic } } });
    throw error;
  }
}

/** Destination trusts only authenticated bundle metadata, validates it again, and derives gaps
 * itself. Metadata lives outside state so an audit reason never changes content equality. */
function readAuthenticatedBackstopMetadata(
  { policy, entities }: { policy: BackstopServicePolicy; entities: readonly PackedEntity[] },
  _optional = {},
): BackstopMetadata | null {
  const raw = entities.filter((e) => e.entityType === "raw-row" || e.entityType === "raw-file");
  if (raw.length === 0) return null;
  if (raw.length !== entities.length) throw new Error("Send by hand cannot include normally published items.");
  if (new Set(raw.map((e) => `${e.entityType}:${e.id}`)).size !== raw.length) throw new Error("Choose each item once.");
  const first = raw[0]?.backstop;
  if (!first || !hasBackstopDetails({ metadata: first })) throw new Error("This send is missing its reason, destination confirmation or source actor.");
  checkBackstopDestination({ destinationHost: first.destinationHost });
  if (raw.some((e) => JSON.stringify(e.backstop) !== JSON.stringify(first))) throw new Error("Every item in this send must have the same audit details.");
  checkBackstopBundleLimits({ raw, limits: policy.limits, copy: policy.copy });
  const secret = policy.checkRawValues({ values: { reason: first.reason } });
  if (secret) throw new Error(secret);
  return { ...first, gapLabels: [...new Set(raw.map((e) => e.entityType === "raw-row"
    ? policy.gapLabelFor({ item: { entityType: "raw-row", table: String(e.state.table) } }) : policy.gapLabelFor({ item: { entityType: "raw-file", relPath: e.id } })))].sort() };
}

function checkBackstopSelection(
  { rows, files, limits, copy }: { rows: unknown; files: unknown; limits: BackstopServicePolicy["limits"]; copy: BackstopServicePolicy["copy"] },
  _optional = {},
): string | null {
  if (!Array.isArray(rows) || !Array.isArray(files) || rows.length > limits.rows || files.length > limits.files) return copy.selectionLimit;
  if (rows.some((row) => !isBackstopRow({ row })) || files.some((file) => typeof file !== "string") || rows.length + files.length === 0) return "Choose rows by their complete primary keys and files by their site-relative paths.";
  if (hasRepeatedBackstopItems({ rows, files })) return "Choose each item once.";
  return null;
}

function checkBackstopBundleLimits(
  { raw, limits, copy }: { raw: readonly PackedEntity[]; limits: BackstopServicePolicy["limits"]; copy: BackstopServicePolicy["copy"] },
  _optional = {},
): void {
  const rows = raw.filter((e) => e.entityType === "raw-row");
  const files = raw.filter((e) => e.entityType === "raw-file");
  if (rows.length > limits.rows || files.length > limits.files || files.reduce((n, e) => n + (typeof e.state.size === "number" ? e.state.size : Infinity), 0) > limits.bytes) throw new Error(copy.bundleLimit);
}

/** Keep the original untrimmed length cap while accepting surrounding whitespace. */
function isBackstopReason({ reason }: { reason: unknown }, _optional = {}): boolean {
  return typeof reason === "string" && reason.trim().length >= 10 && reason.length <= 2000;
}

function isBackstopRow({ row }: { row: unknown }, _optional = {}): boolean {
  if (!row || typeof row !== "object") return false;
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.table !== "string" || !candidate.pk || typeof candidate.pk !== "object") return false;
  return !Array.isArray(candidate.pk) && Object.keys(candidate.pk).length > 0;
}

function hasBackstopDetails({ metadata }: { metadata: BackstopMetadata | undefined }, _optional = {}): boolean {
  if (!metadata || metadata.mode !== "backstop" || !isBackstopReason({ reason: metadata.reason })) return false;
  if (typeof metadata.sourceActor !== "string" || metadata.sourceActor.length === 0 || metadata.sourceActor.length > 512) return false;
  return typeof metadata.destinationHost === "string" && metadata.destinationHost.length <= 512;
}

function isBackstopBody({ body }: { body: unknown }, _optional = {}): boolean {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

function hasRepeatedBackstopItems({ rows, files }: BackstopSelection, _optional = {}): boolean {
  if (!rows || !files) throw new Error("Send by hand selection has no rows or files");
  return new Set(files).size !== files.length || new Set(rows.map((row) => `${row.table}:${JSON.stringify(Object.fromEntries(Object.entries(row.pk).sort(([a], [b]) => a.localeCompare(b))))}`)).size !== rows.length;
}

function checkBackstopDestination({ destinationHost }: { destinationHost: string }, _optional = {}): void {
  try { if (new URL(`https://${destinationHost}`).host !== destinationHost) throw new Error(); }
  catch { throw new Error("This send has an invalid destination address."); }
}
