/** The list screen's two independent notices — a fetch/action error, and malformed widget records
 *  the server could not read — pulled out of `WidgetsLibrary`'s own render body as a top-level
 *  component under the tightened ≤9/≤9 pass. */
export function WidgetsLibraryNotices({
  error,
  skippedCount,
  skippedIds = [],
  t = (key: string) => key,
}: {
  error: string | null;
  skippedCount: number;
  skippedIds?: string[] | undefined;
  /** Translator closure — see `WidgetsLibrary()`'s own `t`. Optional (identity default) since this
   *  component is exported and unit-tested directly without one — same "default to the real thing,
   *  a stub renders English" convention every `use*Hook` prop in this app already follows. */
  t?: ((key: string) => string) | undefined;
}) {
  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}
      {skippedCount > 0 ? (
        <div className="notice">
          {skippedCount === 1
            ? t("1 widget record in this workspace could not be read.")
            : t("{n} widget records in this workspace could not be read.").replace("{n}", String(skippedCount))}
          {skippedIds.length > 0 ? (
            <details>
              <summary>{t("Show ids")}</summary>
              <ul>{skippedIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

