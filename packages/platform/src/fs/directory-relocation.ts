import fs from "node:fs";
import path from "node:path";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

export interface DirectoryRelocationSnapshot<Row> {
  state: "ok" | "missing" | "unreadable";
  rows: Row[];
  dismissed: string[];
}
export interface DirectoryRelocationWrite<WriteRow> { rows: WriteRow[]; dismissed: string[] }
export interface DirectoryRelocationReport { moved: Array<{ from: string; to: string }>; merged: string[] }
export interface DirectoryRelocationRequired<WriteRow, Row extends WriteRow> {
  read(required: Record<string, never>): DirectoryRelocationSnapshot<Row>;
  update(required: { change: (current: DirectoryRelocationSnapshot<Row>) => DirectoryRelocationWrite<WriteRow> | null }): unknown;
  directoryOf(required: { row: Row }): string;
  recordedIdentityOf(required: { row: Row }): string | null | undefined;
  relocationIdentityOf(required: { row: Row }): string | undefined;
  classifyDirectory(required: { directory: string }): string;
  eligibleClassification: string;
  readIdentity(required: { directory: string }): string | null;
  stamp(required: { row: Row; identity: string }): WriteRow;
  move(required: { row: Row; directory: string; identity: string }): WriteRow;
}
export interface DirectoryRelocationOptions {
  searchRoots?: string[];
  listChildren?: (required: { root: string }) => string[];
}
interface RelocationPlan<WriteRow> { rows: WriteRow[]; report: DirectoryRelocationReport; changed: boolean }
interface PlanContext<WriteRow, Row extends WriteRow> {
  ports: DirectoryRelocationRequired<WriteRow, Row>;
  claimed: Set<string>;
  dismissed: string[];
  searchRoots: string[];
  knownDirs: string[];
  listChildren: NonNullable<DirectoryRelocationOptions["listChildren"]>;
}

/** Only immediate children are searched; an unreadable root contributes none. */
function childPathsOf({ root }: { root: string }, _optional = {}): string[] {
  return orFallbackSync({ work: () => fs.readdirSync(root).map(name => path.join(root, name)), fallback: [], step: "relocation-list-children" });
}

/** Guessing between copies is forbidden. Determine ambiguity BEFORE filtering dismissals:
 * an operator removing one twin does not authorize choosing the other.
 * @complexity O(n + r*c) tracked directories and immediate children of deduplicated roots. */
function relocationTarget<WriteRow, Row extends WriteRow>(
  { row, context }: { row: Row; context: PlanContext<WriteRow, Row> }, _optional = {},
): { dir: string; id: string } | null {
  const { ports } = context;
  const directory = ports.directoryOf({ row });
  // Recorded identity predates relocation stamps. Never infer identity from a folder's name;
  // an invalid original folder can still retain a usable marker.
  const identity = ports.recordedIdentityOf({ row }) ?? ports.relocationIdentityOf({ row }) ?? ports.readIdentity({ directory });
  if (identity === null || identity === undefined) return null;
  const roots = new Set([path.dirname(directory), ...context.searchRoots]);
  const candidates = new Set([...context.knownDirs, ...[...roots].flatMap(root => context.listChildren({ root }))]);
  const matches = [...candidates].filter(dir => dir !== directory && ports.classifyDirectory({ directory: dir }) === ports.eligibleClassification && ports.readIdentity({ directory: dir }) === identity);
  const [match] = matches;
  if (matches.length !== 1 || match === undefined || context.dismissed.includes(match)) return null;
  // The matching id travels with the target instead of being read from disk again.
  return { dir: match, id: identity };
}

/** Stamp, repoint, merge or retain one row. The host owns provenance when stamping/moving. */
function planRow<WriteRow, Row extends WriteRow>(
  { plan, row, context }: { plan: RelocationPlan<WriteRow>; row: Row; context: PlanContext<WriteRow, Row> }, _optional = {},
): void {
  const { ports } = context;
  const directory = ports.directoryOf({ row });
  if (ports.classifyDirectory({ directory }) === ports.eligibleClassification) {
    const identity = ports.relocationIdentityOf({ row }) === undefined ? ports.readIdentity({ directory }) : null;
    plan.changed ||= identity !== null;
    plan.rows.push(identity === null ? row : ports.stamp({ row, identity }));
    return;
  }
  const target = relocationTarget({ row, context });
  if (target === null) {
    plan.rows.push(row);
    return;
  }
  plan.changed = true;
  if (context.claimed.has(target.dir)) {
    plan.report.merged.push(directory);
    return;
  }
  context.claimed.add(target.dir);
  plan.report.moved.push({ from: directory, to: target.dir });
  plan.rows.push(ports.move({ row, directory: target.dir, identity: target.id }));
}

/** A damaged file stays untouched: a poll must never quarantine or overwrite its recovered rows. */
function planRelocations<WriteRow, Row extends WriteRow>(
  { current, ports, searchRoots, listChildren }: {
    current: DirectoryRelocationSnapshot<Row>; ports: DirectoryRelocationRequired<WriteRow, Row>;
    searchRoots: string[]; listChildren: NonNullable<DirectoryRelocationOptions["listChildren"]>;
  }, _optional = {},
): RelocationPlan<WriteRow> {
  const plan: RelocationPlan<WriteRow> = { rows: [], report: { moved: [], merged: [] }, changed: false };
  if (current.state !== "ok") return plan;
  const context: PlanContext<WriteRow, Row> = {
    ports, claimed: new Set(current.rows.map(row => ports.directoryOf({ row }))), dismissed: current.dismissed,
    searchRoots, knownDirs: current.rows.map(row => ports.directoryOf({ row })), listChildren,
  };
  for (const row of current.rows) planRow({ plan, row, context });
  return plan;
}

/** Probe without locking, then recompute inside the host's locked update. Ordinary unchanged polls
 * must not take a lock other instances would wait on. A concurrent adoption/heal must survive.
 * @returns Only relocations/merges from the locked snapshot, never the stale unlocked probe.
 * @complexity O(n*(n+r*c)) marker reads, O(n+r*c) space; no recursive enumeration. */
export function reconcileDirectoryRelocations<WriteRow, Row extends WriteRow>(
  ports: DirectoryRelocationRequired<WriteRow, Row>,
  { searchRoots = [], listChildren = childPathsOf }: DirectoryRelocationOptions = {},
): DirectoryRelocationReport {
  let report: DirectoryRelocationReport = { moved: [], merged: [] };
  if (!planRelocations({ current: ports.read({}), ports, searchRoots, listChildren }).changed) return report;
  ports.update({ change: current => {
    const plan = planRelocations({ current, ports, searchRoots, listChildren });
    report = plan.report;
    return plan.changed ? { rows: plan.rows, dismissed: current.dismissed } : null;
  } });
  return report;
}

export interface DirectoryRelocationGate<Row> {
  shouldRun(required: { file: { rows: Row[]; dismissed: string[] } }, optional?: Record<string, never>): boolean;
}

/** Rows, full admission classifications and dismissals describe when something could have moved.
 * The first poll runs; otherwise an idle minute still discovers a folder appearing elsewhere while
 * its old path remains missing. Every four-second poll must not rescan all sibling markers.
 * @complexity O(n) classifications per poll. */
export function createDirectoryRelocationGate<Row>(
  { directoryOf, classifyDirectory }: {
    directoryOf: (required: { row: Row }) => string;
    classifyDirectory: (required: { directory: string }) => string;
  }, { now = Date.now, maxIdleMs = 60_000 }: { now?: () => number; maxIdleMs?: number } = {},
): DirectoryRelocationGate<Row> {
  let lastPicture: string | null = null;
  let lastRunAt = 0;
  return {
    shouldRun({ file }, _options = {}) {
      const picture = [...file.rows.map(row => `${directoryOf({ row })}\u0000${classifyDirectory({ directory: directoryOf({ row }) })}`), "\u0000dismissed", ...file.dismissed].join("\n");
      const at = now();
      if (picture === lastPicture && at - lastRunAt < maxIdleMs) return false;
      lastPicture = picture;
      lastRunAt = at;
      return true;
    },
  };
}
