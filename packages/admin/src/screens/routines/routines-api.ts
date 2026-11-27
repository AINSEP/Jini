import type { RoutineRow, RoutineSchedule } from "@jini-ai/core/contracts/site/routines";

/**
 * @file Browser client for `/api/admin/assistant/routines`. Why: the screen must never confuse a
 * refusal (desktop-only, assistant off, other window, store error) with an empty ready list, and a
 * stale write must be a distinct, recognisable outcome so the controller reloads instead of retrying.
 * The request function is injected (session-aware, cookie-bound) so this module does no `fetch` itself.
 */
export type RoutineAvailabilityState = "ready" | "desktop-only" | "assistant-off" | "other-window" | "error";
export type RoutineRefusalReason = "ROUTINES_UNAVAILABLE" | "ROUTINES_ASSISTANT_OFF" | "ROUTINES_LEASE_HELD" | "ROUTINES_STORE_OPEN_FAILED";

/** What a list call resolves to: rows only when ready, otherwise the plain reason it is not. */
export type RoutinesListResult =
  | Readonly<{ state: "ready"; routines: readonly RoutineRow[] }>
  | Readonly<{ state: Exclude<RoutineAvailabilityState, "ready">; reason: RoutineRefusalReason | null; errorId: string | null }>;

export type RoutineDraft = Readonly<{ name: string; prompt: string; schedule: RoutineSchedule; agentId: string | null; model: string | null }>;

export type RoutineRequest = Readonly<{ path: string; method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }>;
export type RequestAdminJson = (required: RoutineRequest, optional: { basePath: string }) => Promise<unknown>;

/** A failed routines call; `stale` means the row's revision moved (409 `ROUTINE_CHANGED`). */
export class RoutinesApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  readonly errorId: string | null;
  readonly stale: boolean;
  constructor({ message, status, reason, errorId }: { message: string; status: number; reason: string | null; errorId: string | null }, _optional: Record<string, never> = {}) {
    super(message);
    this.name = "RoutinesApiError";
    this.status = status;
    this.reason = reason;
    this.errorId = errorId;
    this.stale = reason === "ROUTINE_CHANGED";
  }
}

const REASON_TO_STATE: Readonly<Record<RoutineRefusalReason, Exclude<RoutineAvailabilityState, "ready">>> = {
  ROUTINES_UNAVAILABLE: "desktop-only",
  ROUTINES_ASSISTANT_OFF: "assistant-off",
  ROUTINES_LEASE_HELD: "other-window",
  ROUTINES_STORE_OPEN_FAILED: "error",
};

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** Reads status/body off whatever the injected request threw, without importing the host's error class. */
function describeFailure(error: unknown): RoutinesApiError {
  const failure = record(error);
  const body = record(failure["body"]);
  const nested = record(body["error"]);
  const details = record(body["details"] ?? nested["details"]);
  const reason = typeof details["reason"] === "string" ? details["reason"] : null;
  const rawId = body["errorId"] ?? nested["errorId"];
  const errorId = typeof rawId === "string" ? rawId : null;
  const status = typeof failure["status"] === "number" ? failure["status"] : 0;
  return new RoutinesApiError({ message: error instanceof Error ? error.message : "Request failed", status, reason, errorId });
}

function refusalOf(failure: RoutinesApiError): RoutinesListResult | null {
  if (failure.status !== 503 || failure.reason === null || !Object.hasOwn(REASON_TO_STATE, failure.reason)) return null;
  const reason = failure.reason as RoutineRefusalReason;
  return { state: REASON_TO_STATE[reason], reason, errorId: failure.errorId };
}

export type RoutinesApi = Readonly<{
  list: () => Promise<RoutinesListResult>;
  create: (required: { draft: RoutineDraft }) => Promise<RoutineRow>;
  update: (required: { id: string; patch: Partial<RoutineDraft> & { enabled?: boolean }; expectedRevision: number }) => Promise<RoutineRow>;
  remove: (required: { id: string; revision: number }) => Promise<void>;
}>;

/** One method per route; writes send `expectedRevision` (PATCH) or `revision` (DELETE) so the server can refuse a stale row. */
export function createRoutinesApi({ requestAdminJson, basePath }: { requestAdminJson: RequestAdminJson; basePath: string }, _optional: Record<string, never> = {}): RoutinesApi {
  const send = async (request: RoutineRequest): Promise<unknown> => {
    try { return await requestAdminJson(request, { basePath }); } catch (error) { throw describeFailure(error); }
  };
  const rowOf = (value: unknown): RoutineRow => record(value)["routine"] as RoutineRow;
  return {
    async list() {
      try {
        const body = record(await send({ path: "", method: "GET" }));
        return { state: "ready", routines: Array.isArray(body["routines"]) ? (body["routines"] as RoutineRow[]) : [] };
      } catch (error) {
        const refusal = error instanceof RoutinesApiError ? refusalOf(error) : null;
        if (refusal === null) throw error;
        return refusal;
      }
    },
    async create({ draft }) { return rowOf(await send({ path: "", method: "POST", body: draft })); },
    async update({ id, patch, expectedRevision }) {
      return rowOf(await send({ path: `/${encodeURIComponent(id)}`, method: "PATCH", body: { ...patch, expectedRevision } }));
    },
    async remove({ id, revision }) { await send({ path: `/${encodeURIComponent(id)}?revision=${revision}`, method: "DELETE" }); },
  };
}
