/** Triggers a browser file download of `contents` as `Dockerfile` — plain DOM manipulation with no
 *  state of its own to expose, so it stays a local function rather than living in the hook (see
 *  `use-dockerfile-source.hooks.ts`'s header for why `copy` DOES live there but this doesn't).
 *  `URL.revokeObjectURL` after the click so the blob URL doesn't leak for the rest of the page's
 *  lifetime — the anchor never needs to be appended to the document for `.click()` to fire it. */
export function downloadDockerfile({ contents, Blob, URL, document }: { contents: string; Blob: typeof globalThis.Blob; URL: Pick<typeof globalThis.URL, "createObjectURL" | "revokeObjectURL">; document: { createElement: (tag: "a") => Pick<HTMLAnchorElement, "href" | "download" | "click"> } }, _options = {}): void {
  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "Dockerfile";
  anchor.click();
  URL.revokeObjectURL(url);
}

