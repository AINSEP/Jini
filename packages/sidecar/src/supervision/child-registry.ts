import fs from "node:fs";
import path from "node:path";
import { errorCodeOf } from "@jini-ai/core/primitives";
import { reconcileRows } from "./child-orphans.js";
import type { ChildRegistryProcesses } from "./child-orphans.js";

export type ChildRegistryRead<Row> = { state: "ok"; rows: Row[] } | { state: "missing" } | { state: "unreadable" };
export interface ChildRegistryStorage<Row> {
  instancePath(required: { registryDir: string; instanceId: string }): string;
  read(required: { filePath: string }): ChildRegistryRead<Row>;
  write(required: { filePath: string; rows: Row[] }): void;
  quarantine(required: { filePath: string }): boolean;
  removeDeadFile(required: { filePath: string; ownerPid: number }): void;
}
export type ChildRegistryReport =
  | { type: "list-failed"; registryDir: string }
  | { type: "live-owner-unreadable"; filePath: string; ownerPid: number };
interface InstanceFile { filePath: string; instanceId: string; ownerPid: number }
export interface ChildRegistryRequired<Row extends { pid: number }> {
  instanceId: string;
  legacyPath(required: { registryDir: string }): string;
  parseInstanceName(required: { name: string }): { instanceId: string; ownerPid: number } | null;
  keyOf(required: { row: Row }): string;
  storage: ChildRegistryStorage<Row>;
  processes: ChildRegistryProcesses<Row>;
  report(event: ChildRegistryReport): void;
}
export interface ChildRegistrySnapshot<Row> { rows: Row[]; unreadable: string[] }
export interface ChildRegistry<Row extends { pid: number }> {
  read(required: { registryDir: string }, optional?: Record<string, never>): ChildRegistrySnapshot<Row>;
  recordOpened(required: { registryDir: string; row: Row }, optional?: { instanceId?: string; isLiveRow?: (required: { row: Row }) => boolean }): void;
  recordClosed(required: { registryDir: string; key: string }, optional?: { pid?: number; instanceId?: string; quarantine?: ChildRegistryStorage<Row>["quarantine"] }): void;
  reconcileOrphans(required: { registryDir: string }, optional?: { instanceId?: string }): Promise<Row[]>;
}

/** One file per instance has one writer. The host supplies filename and codec policy.
 * Reconciliation never rewrites a sibling's file: a row recorded during a grace window must survive.
 * A recycled owner pid conservatively keeps the file, while per-row parentage still permits reaping.
 * The registry does not fabricate handles for recovered children: no pipe exists to supervise them. */
export function createChildRegistry<Row extends { pid: number }>(
  required: ChildRegistryRequired<Row>, _optional = {},
): ChildRegistry<Row> {
  return new ChildRegistryStore(required);
}

class ChildRegistryStore<Row extends { pid: number }> implements ChildRegistry<Row> {
  constructor(private readonly deps: ChildRegistryRequired<Row>) {}

  /** Missing is empty; a directory that cannot be listed contains UNKNOWN rows. */
  private listInstanceFiles({ registryDir }: { registryDir: string }, _optional = {}): InstanceFile[] | null {
    let names: string[];
    try { names = fs.readdirSync(registryDir); }
    catch (error) { return errorCodeOf({ error }) === "ENOENT" ? [] : null; }
    return names.flatMap(name => {
      const parsed = this.deps.parseInstanceName({ name });
      return parsed ? [{ filePath: path.join(registryDir, name), ...parsed }] : [];
    });
  }

  /** Include legacy rows: older hosts remain writers of that shared file.
   * Files that disappear after listing are absent; unreadable rows are unknown, never empty. */
  read({ registryDir }: { registryDir: string }, _optional = {}): ChildRegistrySnapshot<Row> {
    const files = this.listInstanceFiles({ registryDir });
    const snapshot: ChildRegistrySnapshot<Row> = { rows: [], unreadable: files === null ? [registryDir] : [] };
    for (const filePath of [...(files ?? []).map(file => file.filePath), this.deps.legacyPath({ registryDir })]) {
      const read = this.deps.storage.read({ filePath });
      if (read.state === "ok") snapshot.rows.push(...read.rows);
      if (read.state === "unreadable") snapshot.unreadable.push(filePath);
    }
    return snapshot;
  }

  /** Preserve damaged bytes before recording a just-started/stopped child. Refusal leaves that
   * child unrecorded, but throwing would strand its live handle; a failed quarantine forbids writing. */
  private readOwnRowsForUpdate(
    { filePath }: { filePath: string }, { quarantine = this.deps.storage.quarantine }: { quarantine?: ChildRegistryStorage<Row>["quarantine"] | undefined } = {},
  ): Row[] | null {
    const read = this.deps.storage.read({ filePath });
    if (read.state === "ok") return read.rows;
    if (read.state === "missing") return [];
    return quarantine({ filePath }) ? [] : null;
  }

  /** Refuse to replace a live same-key row: a closed window may still have a draining child.
   * Only proven-dead or recycled identities can be displaced, or a hard host kill would strand them. */
  recordOpened(
    { registryDir, row }: { registryDir: string; row: Row },
    { instanceId = this.deps.instanceId, isLiveRow = this.deps.processes.isLiveRow }: { instanceId?: string; isLiveRow?: (required: { row: Row }) => boolean } = {},
  ): void {
    const filePath = this.deps.storage.instancePath({ registryDir, instanceId });
    const rows = this.readOwnRowsForUpdate({ filePath });
    if (rows === null) return;
    const retained = rows.filter(existing => this.deps.keyOf({ row: existing }) !== this.deps.keyOf({ row }) || isLiveRow({ row: existing }));
    this.deps.storage.write({ filePath, rows: [row, ...retained] });
  }

  /** A replacement and its draining predecessor may share a key: close only the supplied pid.
   * Omitting pid retains the original forget-all-rows-for-this-key behavior. */
  recordClosed(
    { registryDir, key }: { registryDir: string; key: string },
    { pid, instanceId = this.deps.instanceId, quarantine }: { pid?: number; instanceId?: string; quarantine?: ChildRegistryStorage<Row>["quarantine"] } = {},
  ): void {
    const filePath = this.deps.storage.instancePath({ registryDir, instanceId });
    const rows = this.readOwnRowsForUpdate({ filePath }, { quarantine });
    if (rows === null) return;
    const isDoomed = (existing: Row) => this.deps.keyOf({ row: existing }) === key && (pid === undefined || existing.pid === pid);
    this.deps.storage.write({ filePath, rows: rows.filter(existing => !isDoomed(existing)) });
  }

  /** Run before creating host windows. Only dead owners permit file removal; own files are skipped.
   * Parentage is proved per row, since a live sibling's child exactly matches its own argv. */
  async reconcileOrphans(
    { registryDir }: { registryDir: string }, { instanceId = this.deps.instanceId }: { instanceId?: string } = {},
  ): Promise<Row[]> {
    const files = this.listInstanceFiles({ registryDir });
    if (files === null) this.deps.report({ type: "list-failed", registryDir });
    const reconciled: Row[] = [];
    for (const file of files ?? []) {
      if (file.instanceId === instanceId) continue;
      reconciled.push(...await this.reconcileInstanceFile({ file }));
    }
    reconciled.push(...await this.reconcileLegacyFile({ legacyPath: this.deps.legacyPath({ registryDir }) }));
    return reconciled;
  }

  /** Never touch a live owner's unreadable file; its own next write owns quarantine.
   * Native dead-file cleanup (including dangling links and owner-specific temp files) is host-owned. */
  private async reconcileInstanceFile({ file }: { file: InstanceFile }, _optional = {}): Promise<Row[]> {
    const ownerGone = !this.deps.processes.isAlive({ pid: file.ownerPid });
    const read = this.deps.storage.read({ filePath: file.filePath });
    if (read.state === "unreadable") {
      if (ownerGone) this.deps.storage.quarantine({ filePath: file.filePath });
      else this.deps.report({ type: "live-owner-unreadable", filePath: file.filePath, ownerPid: file.ownerPid });
      return [];
    }
    const reconciled = read.state === "ok" ? await reconcileRows({ rows: read.rows, processes: this.deps.processes }) : [];
    if (ownerGone) this.deps.storage.removeDeadFile({ filePath: file.filePath, ownerPid: file.ownerPid });
    return reconciled;
  }

  /** Legacy files remain read-only because older hosts still write them. Quarantine preserves torn
   * bytes and stops repeatedly processing the same damage. */
  private async reconcileLegacyFile({ legacyPath }: { legacyPath: string }, _optional = {}): Promise<Row[]> {
    const read = this.deps.storage.read({ filePath: legacyPath });
    if (read.state === "unreadable") {
      this.deps.storage.quarantine({ filePath: legacyPath });
      return [];
    }
    return read.state === "ok" ? reconcileRows({ rows: read.rows, processes: this.deps.processes }) : [];
  }
}
