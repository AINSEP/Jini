import { useRef, useState } from "react";

export const FOLDER_TOO_MANY = "That folder has more than 4096 files.";

/** Why the folder zipper refused a folder (`FolderZipError.reason`). */
export type FolderZipRefusalReason = "empty" | "too-large" | "too-many" | "unreadable";

/**
 * The folder zipper the hook drives, injected by the host (the agent-plugins package's `folder-zip`
 * module satisfies it as is): its two refusal dictionary keys, its refusal error class, and the zipper.
 */
export interface FolderZipPort {
  readonly FOLDER_EMPTY: string;
  readonly FOLDER_UNREADABLE: string;
  readonly FolderZipError: abstract new (...args: never[]) => { readonly reason: FolderZipRefusalReason };
  readonly zipFolderFiles: (required: { files: readonly File[]; maxBytes: number }, optional?: Record<string, never>) => Promise<File>;
}

/** The only fields of the folder `<input>` the hook reads; a React change event's target satisfies it. */
export interface PickedFolderInput {
  readonly files: ArrayLike<File> | null;
  value: string;
}

/** Maps a refused folder to the dictionary key the page shows; anything that is not a FolderZipError reads as unreadable. */
function refusalKey({ error, tooLarge, folderZip }: { error: unknown; tooLarge: string; folderZip: FolderZipPort }): string {
  const { FOLDER_EMPTY, FOLDER_UNREADABLE, FolderZipError } = folderZip;
  if (!(error instanceof FolderZipError)) return FOLDER_UNREADABLE;
  const keys: Record<FolderZipRefusalReason, string> = {
    empty: FOLDER_EMPTY, "too-large": tooLarge, "too-many": FOLDER_TOO_MANY, unreadable: FOLDER_UNREADABLE,
  };
  return keys[error.reason];
}

/**
 * "Choose a folder" for an "Add a …" tab's {@link ZipDropZone}: opens the browser's folder picker,
 * zips what it returns (`folder-zip.ts`) and hands the result to the page as if that `.zip` had been
 * chosen, so the page's own size check, Preview and install run unchanged. Shared by Plugins and
 * Agent Plugins (owner, 2026-10-06: "Folder on this server" was a bare path with no button).
 *
 * @param required.maxBytes - The page's upload limit, checked before and after zipping.
 * @param required.tooLarge - The page's own "over the limit" dictionary key.
 * @param required.isLocked - True while the page is uploading; a pick is then ignored.
 * @param required.onZipped - Receives the `<folder>.zip` file.
 * @param required.onError - Receives a dictionary key for a refused folder.
 * @param required.folderZip - The folder zipper and its refusal keys/error (see {@link FolderZipPort}).
 */
export function useFolderUpload(
  required: { maxBytes: number; tooLarge: string; isLocked: () => boolean; onZipped: (file: File) => void; onError: (required: { key: string }, optional?: Record<string, never>) => void; folderZip: FolderZipPort },
  _optional: Record<string, never> = {},
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [zipping, setZipping] = useState(false);
  const zippingRef = useRef(false);

  async function zip({ files }: { files: File[] }, _options: Record<string, never> = {}): Promise<void> {
    if (zippingRef.current || required.isLocked()) return;
    zippingRef.current = true;
    setZipping(true);
    try {
      required.onZipped(await required.folderZip.zipFolderFiles({ files, maxBytes: required.maxBytes }));
    } catch (error) {
      required.onError({ key: refusalKey({ error, tooLarge: required.tooLarge, folderZip: required.folderZip }) });
    } finally {
      zippingRef.current = false;
      setZipping(false);
    }
  }

  return {
    inputRef,
    zipping,
    onChoose: () => inputRef.current?.click(),
    /** Snapshots the picked files, then clears the input so picking the same folder again (after
     *  editing it) still fires `change`. */
    onChange: (event: { target: PickedFolderInput }) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      return zip({ files });
    },
  };
}
