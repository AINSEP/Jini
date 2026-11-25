export type AdminByokSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

/**
 * {@link AdminByokKeyFooter}'s status line, as a single string (or `null` to render nothing) — the
 * four mutually-exclusive `saveState.status` checks that used to sit directly in
 * `AdminByokKeyFooter`'s JSX (`components/AdminByokKeyPanel.tsx`), pulled out as a top-level pure
 * function per the complexity-ceiling brief. `isStored` takes the already-narrowed boolean rather
 * than the full `stored` record, so this function has no dependency on
 * `AdminExecutionCredentialController`'s shape beyond the one field it reads.
 *
 * @param optional.storedKeyIsForOtherEndpoint - The controller's flag of the same name. While idle, the line
 *   then asks for this provider's key instead of reporting a stored key this provider cannot use —
 *   the same ask, and the same dictionary key, as the visitor screen's key line.
 * @complexity O(1).
 */
export function resolveByokFooterStatusLine(
  { status, isStored, copy }: {
    status: AdminByokSaveState["status"];
    isStored: boolean;
    copy: { saving: string; saved: string; otherEndpoint: string; stored: string; enterKey: string };
  },
  { storedKeyIsForOtherEndpoint = false }: { storedKeyIsForOtherEndpoint?: boolean } = {},
): string | null {
  if (status === "saving") return copy.saving;
  if (status === "saved") return copy.saved;
  if (status !== "idle") return null;
  if (storedKeyIsForOtherEndpoint) return copy.otherEndpoint;
  return isStored ? copy.stored : copy.enterKey;
}
