/**
 * @file Pure rules behind `useFolderDrop` (`use-folder-drop.hooks.ts`): which drops carry a folder,
 * how a failed custom-root write is classified, and which confirmation a successful one shows.
 */

/** Mirrors `errors.spec.md`'s `FolderDropError.reason` enum exactly. */
export type FolderDropErrorReason = "not-a-directory" | "does-not-exist" | "endpoint-unreachable";

/** One notice shape at a time (`useState` holds at most one). `path-unavailable`: a folder was
 *  dropped but its OS path could not be read (a plain browser tab never exposes one), so the drop
 *  was swallowed and the operator is asked to paste the path instead. */
export type FolderDropNotice =
  | { readonly kind: "confirmation"; readonly path: string; readonly paths?: readonly string[]; readonly replacedPreviousPath: string | null }
  | { readonly kind: "error"; readonly path: string; readonly reason: FolderDropErrorReason }
  | { readonly kind: "path-unavailable" };

/** What the host could read off a failed custom-root write: its API error `code` and the server's
 *  own error message. `null` when the failure was not an API error at all (a network throw, etc.). */
export type CustomRootFailure = { readonly code: string | undefined; readonly message: string } | null;

/**
 * Classifies a failed `setCustomRoot` call into `errors.spec.md`'s three-way `FolderDropError`
 * reason. The server answers every custom-root validation error with the SAME
 * `code: "INVALID_PATH"` regardless of which of its three messages fired, so the two validation
 * reasons this feature can realistically hit (a path recovered from a live directory entry is always
 * absolute — see `@jini-ai/ui`'s `folderPathsFromDataTransfer` — so "not absolute" is not a
 * reachable case here) are told apart by the message text itself; anything else (network failure,
 * 500, a non-API-error throw) is reported as the endpoint being unreachable rather than guessed at.
 *
 * @param required.failure The host's reading of the error (`null` when it is not an API error).
 * @complexity Time/space: O(1).
 */
export function reasonForCustomRootFailure({ failure }: { failure: CustomRootFailure }, _optional: Record<string, never> = {}): FolderDropErrorReason {
  if (failure === null || failure.code !== "INVALID_PATH") return "endpoint-unreachable";
  return failure.message.includes("does not exist") ? "does-not-exist" : "not-a-directory";
}

/** `webkitGetAsEntry` is non-standard, so a drag item may not define it at all. */
type DataTransferItemWithEntry = DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };

/**
 * Whether a raw drop carries at least one folder, path or no path.
 *
 * @complexity Time: O(n) in the number of dragged items; space: O(n).
 */
export function dropHasFolder({ dataTransfer }: { dataTransfer: DataTransfer }, _optional: Record<string, never> = {}): boolean {
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && (item as DataTransferItemWithEntry).webkitGetAsEntry?.()?.isDirectory === true,
  );
}

/**
 * The notice a successful custom-root write shows.
 *
 * @param required.path The folder now set as the custom root.
 * @param required.previousPath The root it replaced (`null` when none or unreadable).
 * @param optional.paths Every folder in the drop; listed only when there was more than one.
 * @returns The confirmation notice; `replacedPreviousPath` is `null` when the root did not change.
 * @complexity O(1).
 */
export function confirmationNotice(
  required: { readonly path: string; readonly previousPath: string | null },
  optional: { readonly paths?: readonly string[] | undefined } = {},
): FolderDropNotice {
  const { path, previousPath } = required;
  return {
    kind: "confirmation",
    path,
    ...(optional.paths && optional.paths.length > 1 ? { paths: optional.paths } : {}),
    replacedPreviousPath: previousPath !== path ? previousPath : null,
  };
}
