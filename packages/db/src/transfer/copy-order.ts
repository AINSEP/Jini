/**
 * @file Table copy ordering for a bulk database transfer: a deterministic topological order over
 * caller-supplied table names and foreign-key dependencies, so a copier does not have to invent one.
 * Plain metadata in, plain names out; the host derives the names and edges from its own schema.
 */

/** One foreign-key dependency between two tables. An "export name" is the caller's identifier for a
 * table (any unique string); extra fields on a caller's own edge type are ignored. */
export interface TableCopyDependency {
  /** The table that DECLARES the foreign key (must be copied AFTER `toExportName`). */
  readonly fromExportName: string;
  /** The table the foreign key POINTS AT (must be copied BEFORE `fromExportName`). */
  readonly toExportName: string;
  /** `true` when a table's own foreign key targets itself (a parent/child hierarchy stored in one
   * table). See `topologicalTableCopyOrder`'s doc for why this is excluded from the returned order
   * rather than resolved by it. */
  readonly selfReferencing: boolean;
}

/** Thrown by `topologicalTableCopyOrder` when the FK graph (excluding self-referencing edges) has a
 * cycle across two or more DIFFERENT tables — no single copy order can then satisfy every constraint,
 * and a copier must break the cycle explicitly (e.g. a deferred/dropped-and-revalidated constraint on
 * one edge of it) rather than have this function guess which edge to ignore. */
export class TableCopyOrderCycleError extends Error {
  constructor(readonly stuckExportNames: readonly string[]) {
    super(
      `foreign-key graph has a cycle across tables ${stuckExportNames.join(", ")} — no single copy order can ` +
        `satisfy every constraint. This is a schema fact a copier must resolve explicitly, not something this ` +
        `function can order its way out of.`
    );
    this.name = "TableCopyOrderCycleError";
  }
}

interface CopyOrderGraph {
  /** referenced table -> tables that depend on it */
  readonly dependents: Map<string, Set<string>>;
  readonly inDegree: Map<string, number>;
}

/**
 * Builds `topologicalTableCopyOrder`'s Kahn's-algorithm inputs from the FK edges: for each
 * non-self-referencing edge, records that `toExportName` has `fromExportName` as a dependent,
 * incrementing `fromExportName`'s in-degree once per distinct table it depends on (a table with
 * multiple FKs to the SAME target does not inflate its in-degree past 1 for that target — it only
 * needs that target copied before it once, not once per FK column pointing there).
 */
function buildCopyOrderGraph(allExportNames: readonly string[], edges: readonly TableCopyDependency[]): CopyOrderGraph {
  const dependents = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>(allExportNames.map((name) => [name, 0]));
  for (const edge of edges) {
    if (edge.selfReferencing) continue;
    if (!inDegree.has(edge.fromExportName) || !inDegree.has(edge.toExportName)) {
      throw new Error(
        `edge references "${edge.fromExportName}" -> "${edge.toExportName}", but allExportNames does not list ` +
          `both — topologicalTableCopyOrder() requires every edge endpoint to be one of the named tables.`
      );
    }
    let targets = dependents.get(edge.toExportName);
    if (!targets) {
      targets = new Set();
      dependents.set(edge.toExportName, targets);
    }
    if (!targets.has(edge.fromExportName)) {
      targets.add(edge.fromExportName);
      inDegree.set(edge.fromExportName, (inDegree.get(edge.fromExportName) ?? 0) + 1);
    }
  }
  return { dependents, inDegree };
}

/**
 * Inserts `name` into `ready` (kept sorted ascending) at the first position whose current entry
 * sorts after it — re-sorting on insert rather than sorting once at the end keeps the "process
 * alphabetically among currently-ready tables" tie-break correct at every step of
 * `topologicalTableCopyOrder`'s loop below, not just among the initial zero-in-degree set. Mutates
 * `ready` in place.
 */
function insertIntoReadyQueue({ ready, name }: { ready: string[]; name: string }, _optional: Record<string, never> = {}): void {
  const insertAt = ready.findIndex((n) => n > name);
  if (insertAt === -1) ready.push(name);
  else ready.splice(insertAt, 0, name);
}

/**
 * Kahn's-algorithm topological sort over an FK graph: table A is ordered before table B whenever B
 * declares a foreign key pointing at A ("referenced tables first"). Pure and synchronous over its
 * inputs — no import-time computation, no module-level constant — so a genuine cycle in a host schema
 * throws only for whichever caller actually asks for the order, never for every importer at import
 * time. Hosts keep their schema-derived wrapper next to their schema; this function stays testable
 * against synthetic edges so a cycle can be proven to throw without a real schema containing one.
 *
 * Self-referencing edges (`edge.selfReferencing`) are excluded from the ordering graph — a table
 * cannot be sequenced "before itself" — but that exclusion does NOT mean a self-referencing table
 * needs no special handling. It still appears exactly once in the returned order, and this function
 * says nothing about the ROW order WITHIN that one table's own copy: a copier must still insert that
 * table's rows in an order that satisfies its own FK (typically: parents before children, e.g. by
 * sorting on the referenced column), or defer/drop-and-revalidate just that one constraint for the
 * duration of that table's copy. That per-table obligation is real and is not discharged by this
 * function returning a table-level order at all.
 */
export function topologicalTableCopyOrder(
  { allExportNames, edges }: { readonly allExportNames: readonly string[]; readonly edges: readonly TableCopyDependency[] },
  _optional: Record<string, never> = {},
): string[] {
  const { dependents, inDegree } = buildCopyOrderGraph(allExportNames, edges);

  const ready = [...allExportNames].filter((name) => inDegree.get(name) === 0).sort();
  const order: string[] = [];
  const remaining = new Map(inDegree);
  while (ready.length) {
    const next = ready.shift(); // already sorted; shifting keeps output deterministic
    if (next === undefined) throw new Error("table copy order has an empty ready queue");
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const updated = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, updated);
      if (updated === 0) insertIntoReadyQueue({ ready, name: dependent });
    }
  }

  if (order.length !== allExportNames.length) {
    const stuck = allExportNames.filter((name) => !order.includes(name));
    throw new TableCopyOrderCycleError(stuck);
  }
  return order;
}
