import { useCallback, useMemo, useState } from "react";

import { buildAgentListHandles } from "@jini-ai/core/agent-handles";

import { displayToolDescription, isToolRowLocked, type ToolPickerRow } from "@jini-ai/admin/screens/settings/external-mcp-tool-picker-rules";

import { type Translate, interpolate } from '@jini-ai/core/text';
/**
 * @file `ExternalMcpToolPicker.tsx`'s own derived-value logic, split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` pattern (admin TSX-logic-sweep, 2026-09-05) — this repo's rule
 * that a `.tsx` file carries no functions or derived logic of its own.
 *
 * Every string below is passed through `t` as its own key, against the dictionary Phase 2C already
 * translated into 21 locales for this exact component (`external-mcp-i18n.ts`). A string IS its key
 * in this codebase, so the wording here is not editorial — changing a character silently drops the
 * entry back to English everywhere.
 */

/** The picker's own agent-handle base for one card — `mcp-server-<id>-tools`, derived from the
 *  card's own base so the two never collide and an agent reading `page.find_elements` sees one
 *  obvious namespace per server. Mirrors `@jini-ai/ui`'s `sourceConfigActionHandle` scheme
 *  (`<base>-<action>`) without importing a function that package does not export to hosts. */
export function toolPickerHandle({ cardHandle }: { cardHandle: string }, _options = {}): string {
  return `${cardHandle}-tools`;
}

/**
 * One distinct, stable handle per rendered row, positionally aligned with `rows`.
 *
 * Keyed on each tool's own remote name rather than its index, so an agent addresses the same tool
 * after a re-probe reorders the list — the same policy `buildExternalMcpCardHandles` applies to the
 * cards themselves, delegated to the same `@jini-ai/agentic` implementation so the uniqueness rules
 * cannot drift apart. Memoized because a 101-row list rebuilds this on every keystroke otherwise.
 *
 * @complexity See `buildAgentListHandles`.
 */
export function useToolRowHandles({ base, rows }: { base: string; rows: readonly ToolPickerRow[] }, _options = {}): string[] {
  const names = rows.map((row) => row.remoteName);
  // `names` is rebuilt every render by design (the `.map()` above); the join is the stable
  // identity that should actually gate the recompute, so it — not the array itself — is the
  // dependency. No `eslint-disable` needed: this repo's config sets `noInlineConfig`, which makes
  // an inline disable comment silently ineffective (confirmed: `react-hooks/exhaustive-deps` does
  // not flag this line either way), so a disable comment here would only be misleading.
  return useMemo(() => buildAgentListHandles({ prefix: base, ids: names }), [base, names.join(" ")]);
}

/** One badge and how loudly it speaks (2026-10-13 redesign, owner: "the UI is ugly"). Every badge
 *  used to be the same alarm-red pill, so a plain "Writes" — true of most of a vendor's tools, and
 *  already answered by the row's own "Allow changes" control — shouted as loudly as "Destructive".
 *  `neutral` is a fact, `warning` is something unknown, `danger` is a refusal. */
export interface ToolRowBadge {
  label: string;
  tone: "neutral" | "warning" | "danger";
}

/** What the SERVER declared about one tool, as badges. Never a "safe" or "read-only" badge: the
 *  only positive thing a remote can say is silence-shaped, and `AdminRemoteToolSurfaceEntry`'s own
 *  doc makes "MUST NOT be rendered as read-only" a hard rule for `hintsAbsent`. So the three badges
 *  are the three things worth warning about, and a genuinely declared read-only tool gets none —
 *  its unremarkable row IS the statement.
 *
 *  @complexity O(1). */
export function describeToolRowBadges({ row, t }: { row: ToolPickerRow; t: Translate }, _optional: Record<string, never> = {}): ToolRowBadge[] {
  if (row.kind === "absent") return [{ label: t("This server does not offer a tool by that name."), tone: "warning" }];
  const badges: ToolRowBadge[] = [];
  if (row.destructiveDeclared) badges.push({ label: t("Destructive"), tone: "danger" });
  if (row.writeDeclared) badges.push({ label: t("Writes"), tone: "neutral" });
  if (row.hintsAbsent) badges.push({ label: t("The server does not say what this tool does."), tone: "warning" });
  return badges;
}

/** The sentence explaining why a row cannot be ticked, or `null` when it can. Only one case exists
 *  in this slice (INV-003 / D-1), and its copy is already translated — see
 *  `external-mcp-tool-picker-rules.ts`'s header for why this is a lock rather than a default.
 *
 *  @complexity O(1). */
export function describeToolRowLock({ row, t, productVars }: { row: ToolPickerRow; t: Translate; productVars: Readonly<{ productName: string }> }, _optional: Record<string, never> = {}): string | null {
  if (!isToolRowLocked(row)) return null;
  return interpolate({ template: t("The server marks this tool as destructive. {productName} does not enable destructive external tools."), vars: productVars });
}

/** The "N of M enabled" line, or the stronger zero-state sentence when this connection would
 *  contribute nothing at all. Both keys shipped in Phase 2C; the zero case is called out separately
 *  because a connection that is configured but grants nothing looks identical to a working one at a
 *  glance, which is the same class of quiet failure as an inert write grant.
 *
 *  @complexity O(1). */
export function describeToolCount({ enabled, total, t }: { enabled: number; total: number; t: Translate }, _options = {}): string {
  if (enabled === 0) return interpolate({ template: t("0 of {total} tools enabled — this connection contributes nothing"), vars: { total } });
  return interpolate({ template: t("{enabled} of {total} tools enabled"), vars: { enabled, total } });
}

/** One rendered row with the agent handle `useToolRowHandles` gave it, so filtering the list never
 *  shifts which handle addresses which tool. */
export interface VisibleToolRow {
  row: ToolPickerRow;
  handle: string;
}

export interface ToolPickerFilter {
  query: string;
  setQuery(query: string): void;
  /** The rows that match `query`, in list order. Every row when the query is blank. */
  visible: VisibleToolRow[];
  /** Whether "Select all" would tick anything — some visible, unlocked row is still unticked. */
  canSelectAll: boolean;
  /** Whether "Select none" would untick anything — some visible, unlocked row is ticked. */
  canSelectNone: boolean;
  /** Ticks or unticks every VISIBLE unlocked row, through the picker's own `setEnabled`, so the
   *  write-grant rules in `setToolRowEnabled` (unticking drops "Allow changes") still hold. */
  selectVisible(enabled: boolean): void;
}

/** Case-insensitive match on the tool's name or the description the row actually shows.
 *  @complexity O(n) in the name plus description length. */
export function matchesToolQuery({ row, needle }: { row: ToolPickerRow; needle: string }, _options = {}): boolean {
  if (!needle) return true;
  return row.remoteName.toLowerCase().includes(needle) || displayToolDescription({ description: row.description }).toLowerCase().includes(needle);
}

/**
 * The search box and "Select all / none" over a long tool list (157 on the live higgsfield
 * connection). The query is view state only: it hides rows, it never changes the draft, and
 * select all/none act on the visible rows alone so a filtered "Select all" cannot tick tools the
 * operator never saw.
 *
 * @complexity O(n) per render in row count; `selectVisible` is O(n·v) (one `setEnabled` per visible row).
 */
export function useToolPickerFilter(
  rows: readonly ToolPickerRow[],
  deps: { handles: readonly string[]; base: string; setEnabled: (remoteName: string, enabled: boolean) => void },
): ToolPickerFilter {
  const { handles, base, setEnabled } = deps;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const visible = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, handle: handles[index] ?? `${base}-tool-${index}` }))
        .filter(({ row }) => matchesToolQuery({ row, needle })),
    [rows, handles, base, needle],
  );
  const selectable = visible.filter(({ row }) => !isToolRowLocked(row));

  const selectVisible = useCallback(
    (enabled: boolean) => {
      for (const { row } of selectable) if (row.enabled !== enabled) setEnabled(row.remoteName, enabled);
    },
    [selectable, setEnabled],
  );

  return {
    query,
    setQuery,
    visible,
    canSelectAll: selectable.some(({ row }) => !row.enabled),
    canSelectNone: selectable.some(({ row }) => row.enabled),
    selectVisible,
  };
}
