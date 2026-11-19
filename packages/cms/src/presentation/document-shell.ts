import { escapeHtml } from "@jini-ai/core/text";
import { isFullHtmlDocument } from "./html.js";
import type { DocumentAssets } from "./document-assets.js";

const BASE_STYLE = `
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  img { max-width: 100%; height: auto; }
  a { color: inherit; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/**
 * Wraps a bare fragment with charset, viewport and the host's pre-built head fold, verbatim.
 * Suppress the fallback title when the fold supplies one, avoiding competing title elements.
 * Bare documents omit the reset, theme assets, theme attribute, site wrapper and leading assets:
 * only authored HTML, the head fold and explicit host assets belong here.
 * Classification uses the authored source before embed resolution, independent of resolved content.
 * Embed substitution only changes elements inside the document; selecting its prefix first keeps
 * classification independent of whether the host supplied resolved embed data.
 * A full authored document owns its head and receives no wrapping or injected assets.
 * @complexity O(n) for source classification and concatenation of inputs.
 */
export function renderBareDocument(
  { title, body }: { title: string; body: string },
  { authoredHtml, extraHead, documentAssets }: { authoredHtml?: string; extraHead?: string; documentAssets?: DocumentAssets } = {},
): string {
  if (authoredHtml !== undefined && isFullHtmlDocument({ html: authoredHtml })) return body;
  const assets = documentAssets ?? { head: "", body: "" };
  const foldHasTitle = extraHead?.includes("<title>") ?? false;
  const titleTag = foldHasTitle ? "" : `<title>${escapeHtml({ text: title })}</title>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>${titleTag}${extraHead ?? ""}${assets.head}` +
    `</head><body>${body}${assets.body}</body></html>`
  );
}

/**
 * The pre-built head fold is already escaped and inserted verbatim. Its title suppresses the
 * fallback title rather than emitting two competing tags. Leading assets precede host assets.
 * With no theme, theme contributions are absent: an empty data-theme attribute would still match
 * [data-theme] selectors. The reset belongs to every managed shell, even when there is no theme.
 */
export function renderDocumentShell(
  { title, body }: { title: string; body: string },
  { extraHead, documentAssets, leadingAssets, themeFontLink = "", themeStyle = "", themeId }: {
    extraHead?: string; documentAssets?: DocumentAssets; leadingAssets?: DocumentAssets;
    themeFontLink?: string; themeStyle?: string; themeId?: string;
  } = {},
): string {
  const assets = documentAssets ?? { head: "", body: "" };
  const leading = leadingAssets ?? { head: "", body: "" };
  const foldHasTitle = extraHead?.includes("<title>") ?? false;
  const titleTag = foldHasTitle ? "" : `<title>${escapeHtml({ text: title })}</title>`;
  const themeAttr = themeId !== undefined ? ` data-theme="${escapeHtml({ text: themeId })}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${titleTag}
${extraHead ?? ""}
${themeFontLink}
<style>${BASE_STYLE}${themeStyle}</style>
${leading.head}
${assets.head}
</head>
<body>
<div class="site"${themeAttr}>${body}</div>
${leading.body}
${assets.body}
</body>
</html>`;
}
