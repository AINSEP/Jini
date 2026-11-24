import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { parseImportUrl } from "../../media/import/index.js";
import type { RemoteImageImportCollaborators } from "./ports.js";

/** The server's own import contract (https, no embedded credentials), checked before submit. */
function isImportableUrl(raw: string): boolean {
  try {
    parseImportUrl({ raw });
    return true;
  } catch {
    return false;
  }
}

/** Quick wins A: retain failed drafts for retry; refresh the same list the upload hook reads.
 *  Dialog (owner item #9, 2026-10-13): closes only after a successful import, so a failure stays
 *  in the dialog beside the URL the operator can correct. */
export function useRemoteImageImport(
  required: RemoteImageImportCollaborators,
  _optional: Record<string, never> = {},
) {
  const { port } = required;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const inFlight = useRef(false);
  const mutation = required.useFetchMutation({
    run: ({ input }: { input: { url: string; alt?: string | undefined } }) => port.importFromUrl({ url: input.url }, { alt: input.alt }),
  }, {
    invalidates: [port.listKey],
  });
  const validUrl = isImportableUrl(url.trim());
  async function submit(event?: Pick<FormEvent, "preventDefault">) {
    event?.preventDefault();
    if (inFlight.current || !validUrl) return;
    inFlight.current = true;
    try {
      await mutation.mutate({ input: { url: url.trim(), alt: alt.trim() || undefined } });
      setUrl("");
      setAlt("");
      setOpen(false);
    } catch {
      // The mutation owns the visible error; keep the draft so the operator can correct it.
    } finally {
      inFlight.current = false;
    }
  }
  function openDialog(event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) {
    // Pointer clicks do not focus buttons in every browser; the dialog restores focus to the opener.
    event.currentTarget.focus({ preventScroll: true });
    mutation.reset();
    setOpen(true);
  }
  return {
    open, openDialog, close: () => setOpen(false),
    url, setUrl, alt, setAlt, submit,
    pending: mutation.status === "pending",
    canSubmit: validUrl && mutation.status !== "pending",
    /** Typed but not importable: shown inline so the disabled button is explained. */
    urlInvalid: url.trim() !== "" && !validUrl,
    error: mutation.error ? required.describeError({ e: mutation.error, fallback: required.t("Could not import media.") }) : null,
  };
}
