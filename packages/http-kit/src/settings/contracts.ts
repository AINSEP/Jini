import type { Request, Response, Express } from "express";
import type { Authorize, SettingsPermissions, SettingsService, SettingsChangeFeed } from "@jini-ai/core/settings";

export type PrincipalResolver = (required: { request: Request; response: Response }) =>
  Promise<{ id: string } | null> | { id: string } | null;
export interface Scheduler {
  /** Return an idempotent cancellation callback. */
  every(required: { intervalMs: number; callback: () => void }): () => void;
}
export interface SettingsRoutes {
  definitions: string; effective: string; raw: string; value: string; reset: string; events: string;
  workspaceParam: string;
}
export interface SettingsHttpRequired {
  app: Pick<Express, "get" | "post" | "put" | "delete">;
  workspaceId: string;
  ready: Promise<void>;
  service: SettingsService;
  changeFeed: SettingsChangeFeed;
  principalResolver: PrincipalResolver;
  authorize: Authorize;
  scheduler: Scheduler;
  routes: SettingsRoutes;
  permissions: SettingsPermissions;
}
export interface SettingsHttpOptions {
  pollIntervalMs?: number;
  keepaliveIntervalMs?: number;
  reauthorizeIntervalMs?: number;
  revisionPageSize?: number;
  onError?: (required: { operation: string; error: unknown }) => void;
}
