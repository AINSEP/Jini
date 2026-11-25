import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";

type UrlKind = "link" | "image" | "youtube";
type UrlError = "" | "Enter an HTTP or HTTPS URL." | "Enter a supported YouTube URL.";

/** Only the existing URL-insertion commands; real TipTap and test fakes share this port. */
interface UrlCommandChain {
  focus(): UrlCommandChain;
  extendMarkRange(name: string): UrlCommandChain;
  unsetLink(): UrlCommandChain;
  setLink(input: { href: string }): UrlCommandChain;
  setImage(input: { src: string; alt?: string }): UrlCommandChain;
  setYoutubeVideo(input: { src: string }): UrlCommandChain;
  run(): boolean;
}
export interface PostUrlEditorPort {
  isActive(name: string): boolean;
  chain(): UrlCommandChain;
}

const URL_TITLES: Record<UrlKind, string> = {
  link: "Link URL", image: "Image URL", youtube: "YouTube video URL",
};

/** Post command input policy: absolute HTTP(S), plus the installed embed parser for YouTube.
 * Returns inline copy, never fetches the URL. O(n) time/space for n URL characters.
 */
function urlError({ kind, url, getEmbedUrlFromYoutubeUrl }: { kind: UrlKind | null; url: string; getEmbedUrlFromYoutubeUrl: (input: { url: string }) => string | null }, _options: Record<string, never> = {}): UrlError {
  if (/\s/.test(url) || !/^https?:\/\//i.test(url)) return "Enter an HTTP or HTTPS URL.";
  // The regex above already pins the scheme to http(s); the WHATWG parser then rejects an empty
  // host for those special schemes, so a successful parse always has an http(s) protocol and a
  // non-empty hostname — only the throw needs handling.
  try {
    new URL(url);
  } catch {
    return "Enter an HTTP or HTTPS URL.";
  }
  if (kind === "youtube" && !getEmbedUrlFromYoutubeUrl({ url })) return "Enter a supported YouTube URL.";
  return "";
}

/** CMS command dialog state; Jini Dialog owns input focus, Escape and cancel return focus.
 * @param required The live editor command port, or null before TipTap mounts.
 * @param optional The after-focus scheduler; injectable to assert close ordering without timers.
 * @returns Bound toolbar, field, submit and cancel actions; invalid input never runs a command.
 * @complexity O(n) time/space for validation, with one fixed-size dialog state.
 */
export function usePostUrlDialog({ editor, getEmbedUrlFromYoutubeUrl }: { editor: PostUrlEditorPort | null; getEmbedUrlFromYoutubeUrl: (input: { url: string }) => string | null }, {
  afterEditorFocus,
}: { afterEditorFocus: (close: () => void) => void }) {
  const [kind, setKind] = useState<UrlKind | null>(null);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [pending, setPending] = useState(false);
  const [touched, setTouched] = useState(false);
  const focusAfterInsert = useRef(false);
  const errorId = useId();
  const validationError = urlError({ kind: kind, url: url, getEmbedUrlFromYoutubeUrl });
  const error = touched ? validationError : "";
  useEffect(() => {
    if (kind !== null || !focusAfterInsert.current) return;
    focusAfterInsert.current = false;
    // The dialog's layout cleanup restores the opener first; TipTap owns the final focus.
    editor?.chain().focus().run();
  }, [kind, editor]);
  const cancel = () => setKind(null);
  const open = (nextKind: UrlKind, event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) => {
    // Pointer clicks do not focus buttons in every browser. Give Jini the actual opener to restore.
    event.currentTarget.focus({ preventScroll: true });
    setUrl(nextKind === "link" ? "https://" : "");
    setAlt("");
    setTouched(false);
    setKind(nextKind);
  };
  const openLink = (event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    open("link", event);
  };
  const submit = (event: Pick<FormEvent<HTMLFormElement>, "preventDefault">) => {
    event.preventDefault();
    setTouched(true);
    if (!editor || !kind || validationError || pending) return;
    setPending(true);
    const chain = editor.chain().focus();
    switch (kind) {
      case "link": chain.extendMarkRange("link").setLink({ href: url }).run(); break;
      case "image": chain.setImage({ src: url, ...(alt ? { alt } : {}) }).run(); break;
      case "youtube": chain.setYoutubeVideo({ src: url }).run(); break;
    }
    // Close after the insertion focus frame; the effect above refocuses after dialog cleanup.
    afterEditorFocus(() => { focusAfterInsert.current = true; setPending(false); cancel(); });
  };
  return {
    open: kind !== null, title: kind ? URL_TITLES[kind] : "", image: kind === "image",
    url, alt, error, errorId, pending, invalid: !!error, disabled: !editor || (touched && !!validationError) || pending, cancel, submit, openLink,
    openImage: (event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) => open("image", event),
    openYoutube: (event: Pick<MouseEvent<HTMLButtonElement>, "currentTarget">) => open("youtube", event),
    changeUrl: ({ value }: { value: string }) => { setTouched(true); setUrl(value); },
    changeAlt: ({ value }: { value: string }) => setAlt(value),
  };
}

export type PostUrlDialogController = ReturnType<typeof usePostUrlDialog>;
