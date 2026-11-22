import type { RawValue, RawColumn, RawRowSnapshot, RawFileInverse } from "./backstop-audit.js";
import type { BlobStorePort } from "../../media/ports.js";

export interface RawRowPort {
  columns(input: { table: string }, optional?: {}): Promise<readonly RawColumn[] | null>;
  read(input: { table: string; pk: Readonly<Record<string, RawValue>> }, optional?: {}): Promise<RawRowSnapshot | null>;
  upsert(input: { table: string; pk: Readonly<Record<string, RawValue>>; values: Readonly<Record<string, RawValue>> }, optional?: {}): Promise<void>;
  /** Only an inverse of a create may call this; normal apply is always upsert-only. */
  removeCreated(input: { table: string; pk: Readonly<Record<string, RawValue>> }, optional?: {}): Promise<void>;
  /** All raw rows in ONE push share this transaction. Check foreign keys after work, before commit. */
  transaction<T>(input: { work: () => Promise<T> }, optional?: {}): Promise<T>;
}
export interface BackstopSelection {
  readonly rows?: readonly { readonly table: string; readonly pk: Readonly<Record<string, RawValue>> }[];
  readonly files?: readonly string[];
}
export interface BackstopPorts {
  readonly audit?: import("./backstop-audit.js").BackstopAuditPort;
  readonly inverses?: import("./backstop-audit.js").BackstopInverse[];
  readonly rows?: RawRowPort;
  readonly files?: RawFilePort;
  readonly blobs?: BlobStorePort;
  readonly fileBlobIndex?: import("./file-blob-index.js").FileBlobIndexPort;
  /** Per-request compensation list, replayed if the push's DB transaction fails. */
  readonly fileRollbacks?: Array<() => Promise<void>>;
  readonly selection?: BackstopSelection;
  readonly coveredTables: readonly string[];
  readonly coveredRoots: readonly string[];
}

export interface RawFileSnapshot { readonly bytes: Uint8Array; readonly mode: number; readonly absPath: string }
export interface RawFilePort {
  check(input: { relPath: string }, optional?: {}): Promise<string | null>;
  read(input: { relPath: string }, optional?: {}): Promise<RawFileSnapshot | null>;
  capture(input: { relPath: string }, optional?: {}): Promise<RawFileInverse>;
  replace(input: { relPath: string; bytes: Uint8Array; mode: number }, optional?: {}): Promise<void>;
  restore(input: { inverse: RawFileInverse }, optional?: {}): Promise<void>;
}
