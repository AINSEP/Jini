export interface JsonPanelProps {
  value: unknown;
  emptyLabel: string;
}

/** Renders `value` as pretty-printed JSON, or an empty-state message when
 *  `value` is nullish. Trivial, zero-dependency — ported verbatim. */
export function JsonPanel({ value, emptyLabel }: JsonPanelProps) {
  if (value == null) return <div className="viewer-empty">{emptyLabel}</div>;
  return <pre className="jini-viewer-source">{JSON.stringify(value, null, 2)}</pre>;
}
