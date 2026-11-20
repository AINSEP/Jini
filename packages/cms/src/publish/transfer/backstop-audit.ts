import type { PackedEntity } from "./packed-entity.js";

export type BackstopInverse =
  | { readonly entity: PackedEntity; readonly kind: "raw-row"; readonly before: RawRowSnapshot | null; readonly afterHash: string }
  | { readonly entity: PackedEntity; readonly kind: "raw-file"; readonly before: RawFileInverse; readonly afterHash: string };
export interface BackstopAuditRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly direction: "source" | "destination";
  readonly actorId: string;
  readonly destination: string;
  readonly reason: string;
  readonly at: string;
  readonly items: readonly { readonly entityType: string; readonly id: string; readonly beforeHash?: string | null; readonly afterHash: string }[];
  readonly gapLabels: readonly string[];
  readonly result: "pending" | "planned" | "success" | "failure" | "undone";
  readonly runId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly inverses: readonly BackstopInverse[];
}
export interface BackstopGap { readonly label: string; readonly count: number; readonly lastReason: string; readonly lastAt: string }
export interface BackstopAuditPort {
  ready(): Promise<boolean>;
  save(input: { record: BackstopAuditRecord }, optional?: {}): Promise<void>;
  get(input: { workspaceId: string; id: string }, optional?: {}): Promise<BackstopAuditRecord | null>;
  gaps(input: { workspaceId: string }, optional?: {}): Promise<readonly BackstopGap[]>;
}

/** The CMS backstop's ports. Schema discovery and writes stay in the site's storage adapter. */
export type RawValue = string | number | null | { readonly blobBase64: string };

export interface RawColumn { readonly name: string; readonly type: string; readonly pk: number; readonly notnull: number }

export interface RawRowSnapshot {
  readonly table: string;
  readonly columns: readonly RawColumn[];
  readonly pk: Readonly<Record<string, RawValue>>;
  readonly values: Readonly<Record<string, RawValue>>;
}

export interface RawFileInverse {
  readonly relPath: string;
  readonly backupName: string | null;
  readonly sha256: string | null;
  readonly size: number | null;
  readonly mode: number;
}
