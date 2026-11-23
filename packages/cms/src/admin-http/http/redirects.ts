import type { RedirectHitStats, RedirectRecord } from "../../redirects/index.js";

/**
 * @file Response DTOs for the admin `redirects` HTTP surface (SPEC-009, api.spec.md).
 *
 * Purpose:
 * Serializes `redirects` library read models (`RedirectRecord`,
 * `RedirectHitStats`) into the stable admin JSON envelopes api.spec.md §5
 * defines (`{ data: ... }`, NOT the `{ menu: ... }`-style envelope
 * the Menus admin surface uses — this feature's own api.spec.md is
 * explicit about the `data` envelope key, so it is followed exactly rather
 * than copied from the Menus precedent).
 *
 * Architectural role:
 * HTTP-facing serialization only — no `redirects` business logic lives here
 * (that stays in `packages/cms/src/redirects/redirects.ts`). The host's route-dependency
 * shape and registrar type stay with the host that mounts these routes.
 */

export interface AdminRedirectDto {
  id: string;
  workspaceId: string;
  matchType: string;
  fromPattern: string;
  toTarget: string;
  statusCode: number;
  status: string;
  override: boolean;
  priority: number;
  source: string;
  sourceEntryId: string | null;
  fromPathAtCapture: string | null;
  toPathAtCapture: string | null;
  createdByPrincipal: string;
  createdByPluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AdminRedirectResponse {
  data: AdminRedirectDto;
}

export interface AdminRedirectListResponse {
  data: AdminRedirectDto[];
}

export interface AdminRedirectImportResponse {
  created: AdminRedirectDto[];
  failed: Array<{ index: number; code: string; message: string }>;
}

export interface AdminRedirectHitStatsDto {
  redirectId: string;
  workspaceId: string;
  hitCount: number;
  lastHitAt: string | null;
}

export interface AdminRedirectHitStatsResponse {
  data: AdminRedirectHitStatsDto;
}

export function toAdminRedirectDto(record: RedirectRecord): AdminRedirectDto {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    matchType: record.matchType,
    fromPattern: record.fromPattern,
    toTarget: record.toTarget,
    statusCode: record.statusCode,
    status: record.status,
    override: record.override,
    priority: record.priority,
    source: record.source,
    sourceEntryId: record.sourceEntryId ?? null,
    fromPathAtCapture: record.fromPathAtCapture ?? null,
    toPathAtCapture: record.toPathAtCapture ?? null,
    createdByPrincipal: record.createdByPrincipal,
    createdByPluginId: record.createdByPluginId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

export function toAdminRedirectResponse(record: RedirectRecord): AdminRedirectResponse {
  return { data: toAdminRedirectDto(record) };
}

export function toAdminRedirectListResponse({ records }: { records: RedirectRecord[] }, _optional = {}): AdminRedirectListResponse {
  return { data: records.map(toAdminRedirectDto) };
}

export function toAdminRedirectImportResponse(result: {
  created: RedirectRecord[];
  failed: Array<{ index: number; code: string; message: string }>;
}): AdminRedirectImportResponse {
  return { created: result.created.map(toAdminRedirectDto), failed: result.failed };
}

export function toAdminRedirectHitStatsDto(stats: RedirectHitStats): AdminRedirectHitStatsDto {
  return {
    redirectId: stats.redirectId,
    workspaceId: stats.workspaceId,
    hitCount: stats.hitCount,
    lastHitAt: stats.lastHitAt ?? null,
  };
}

export function toAdminRedirectHitStatsResponse(stats: RedirectHitStats): AdminRedirectHitStatsResponse {
  return { data: toAdminRedirectHitStatsDto(stats) };
}
