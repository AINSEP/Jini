import type { Request, Response, Express } from "express";
import type {
  SettingScope, SettingDefinitionRecord, SetValueRequired, ClearValueRequired,
  ResetNamespaceRequired, ChangeFeedViewer, ChangeFeedBatch,
} from "../../settings/index.js";

export type Authorize = (required: {
  principalId: string; workspaceId: string; permission: string; entityType: string;
}) => Promise<{ allowed: boolean; reason: string }>;
export type PrincipalResolver = (required: { request: Request; response: Response }) =>
  Promise<{ id: string } | null> | { id: string } | null;
export interface Scheduler {
  /** Return an idempotent cancellation callback. */
  every(required: { intervalMs: number; callback: () => void }): () => void;
}
export interface SettingsPermissions {
  read: string;
  readRaw: string;
  readDefinitions: string;
  readOtherUser: string;
  manageDefinitions: string;
  writeGlobal: string;
  writeWorkspace: string;
  writeUserSelf: string;
  writeUserOther: string;
  reset: Record<SettingScope, string>;
}
export interface SettingsRoutes {
  definitions: string; effective: string; raw: string; value: string; reset: string; events: string;
  workspaceParam: string;
}
export type EffectiveSettingRow = { key: string; value: unknown; sourceLayer: string; defVersion: number };
export type RawSetting = { key: string; global: unknown; workspace: unknown; user: unknown; default: unknown };
export type DefinitionResult = { applied: Array<{ key: string; op: string; status: string }> } | { unknownOp: string };
export interface SettingsService {
  listDefinitions(required: { workspaceId: string }): Promise<SettingDefinitionRecord[]>;
  effective(required: { namespace: string; workspaceId: string; principalId: string | undefined }): Promise<EffectiveSettingRow[]>;
  raw(required: { namespace: string; key: string; workspaceId: string; principalId: string | undefined }): Promise<RawSetting | null>;
  set(required: SetValueRequired["input"]): Promise<{ value: unknown; revisionSeq: number }>;
  clear(required: ClearValueRequired["input"]): Promise<{ revisionSeq: number }>;
  reset(required: ResetNamespaceRequired["input"]): Promise<{ clearedCount: number; revisionSeqs: number[] }>;
  definitions(required: { items: readonly unknown[]; callerPrincipalId: string; authWorkspaceId: string }): Promise<DefinitionResult>;
}
export interface SettingsChangeFeed {
  head(required: Record<string, never>): Promise<number>;
  /** Cursor advances across invisible rows. The emitted id MUST use batch.cursor, never head. */
  collect(required: { sinceSeq: number; limit: number; viewer: ChangeFeedViewer }): Promise<ChangeFeedBatch & { examinedCount: number }>;
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
