/**
 * Pure logic for the folder-path-drop feature: recover the absolute OS path of every FOLDER in a raw
 * drop and write those paths into a text target, instead of letting the drop upload the folder's
 * contents. No React, no DOM globals — every DOM-shaped value arrives as a parameter.
 *
 * Why the read has to happen in the capture phase: a bubble-phase drop handler that expands folders
 * (this package's `useFileDropTarget`, via `filesFromDataTransfer`) turns each dropped folder into
 * synthesized per-leaf `File`s through the `FileSystemEntry` API. Those are not the `File`s
 * `dataTransfer.files` handed the page, and a host lookup such as Electron's
 * `webUtils.getPathForFile` resolves `''` for them. So the folder's own path is only recoverable
 * synchronously, off the raw event, before that expansion runs.
 *
 * Consolidated from two identical host copies (a desktop chat pane and a web admin chat dock).
 */
import type { FolderPathDropPort } from './ports.js';
import type { CaptureFolderPathDropInput } from './types.js';

/** `webkitGetAsEntry` is non-standard, so a drag item may not define it at all. */
type DataTransferItemWithEntry = DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };

/**
 * Pairs each `kind === 'file'` item with the `File` at the matching position in `files`.
 *
 * `.items` and `.files` are NOT index-aligned: `.items` also holds `kind === 'string'` entries (a
 * macOS Finder drag commonly adds a `text/uri-list`/`text/plain` item beside a dropped folder),
 * while `.files` holds only the file-kind ones, in the same relative order. A separate counter,
 * advanced only for file-kind items, keeps the two aligned whatever else the drag carries.
 */
function pairFileItemsWithFiles(
  items: readonly DataTransferItem[],
  files: readonly File[],
): Array<{ item: DataTransferItem; file: File }> {
  const pairs: Array<{ item: DataTransferItem; file: File }> = [];
  let fileIndex = 0;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = files[fileIndex];
    fileIndex += 1;
    if (file !== undefined) pairs.push({ item, file });
  }
  return pairs;
}

/**
 * A pair's folder path, or `undefined` when the item is not a directory or its path is unrecoverable.
 * Chromium hands a dropped folder a file-kind item too; `webkitGetAsEntry().isDirectory` is what
 * tells it apart from a loose file.
 */
function folderPathForItem(item: DataTransferItem, file: File, port: FolderPathDropPort): string | undefined {
  const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
  if (entry?.isDirectory !== true) return undefined;
  const path = port.getPathForFile(file);
  return path === '' ? undefined : path;
}

/**
 * Recovers the absolute OS path of every FOLDER in a raw drop, in drop order.
 *
 * @param dataTransfer the raw `DragEvent.dataTransfer`, read before any folder expansion.
 * @param port the host's path lookup. Called as a method, so a class-based port keeps its `this`.
 * @returns every recovered folder path; `[]` when nothing dropped was a folder with a recoverable path.
 * @complexity Time: O(n) in the number of dragged items; space: O(n).
 */
export function folderPathsFromDataTransfer(dataTransfer: DataTransfer, port: FolderPathDropPort): string[] {
  const items = Array.from(dataTransfer.items ?? []);
  const files = Array.from(dataTransfer.files ?? []);
  const paths: string[] = [];
  for (const { item, file } of pairFileItemsWithFiles(items, files)) {
    const path = folderPathForItem(item, file, port);
    if (path !== undefined) paths.push(path);
  }
  return paths;
}

/**
 * The text a folder drop inserts: every path, space-joined, in drop order. The one place the format
 * lives — a path that itself contains a space is ambiguous in this format, so any change to quoting
 * or separators belongs here and nowhere else.
 *
 * @complexity Time/space: O(total path length).
 */
export function formatDroppedFolderPaths(paths: readonly string[]): string {
  return paths.join(' ');
}

/**
 * A capture-phase drop handler's whole decision. A drop carrying at least one folder with a
 * recoverable path is swallowed (`preventDefault` + `stopPropagation`, so no later handler uploads
 * the folder's contents) and its paths are inserted as text. Any other drop — no port, no folder, or
 * no recoverable path — is left untouched for the ordinary file handling.
 *
 * @returns the recovered paths when the drop was swallowed, `[]` when it passed through.
 * @complexity Time: O(n) in the number of dragged items; space: O(n).
 */
export function captureFolderPathDrop({ event, port, composer }: CaptureFolderPathDropInput): string[] {
  if (port === null || port === undefined) return [];
  const paths = folderPathsFromDataTransfer(event.dataTransfer, port);
  if (paths.length === 0) return [];
  event.preventDefault();
  event.stopPropagation();
  composer.current?.insertText(formatDroppedFolderPaths(paths));
  return paths;
}
