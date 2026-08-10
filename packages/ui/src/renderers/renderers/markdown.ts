/**
 * Markdown → sanitized HTML for artifact rendering. Verbatim port of
 * `apps/web/src/artifacts/markdown.ts` in the origin project — no
 * product-specific logic in the original, just table-pipe-escaping + a few HTML
 * post-processing passes (safe external links, table wrapper class,
 * alignment-attribute → CSS). See `source-map.md`.
 */
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { resolveArtifactManifest, type ArtifactRenderer } from '../registry.js';

export function renderMarkdownToSafeHtml(markdown: string): string {
  return postProcessMarkdownHtml(
    micromark(escapeTableCodePipes(markdown), {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    }),
  );
}

function escapeTableCodePipes(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  let inTable = false;

  return lines
    .map((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        inTable = false;
        return line;
      }

      if (inFence) return line;

      const startsTable = isLikelyTableHeader(line) && isTableDelimiter(lines[index + 1] ?? '');
      if (startsTable) {
        inTable = true;
        return escapeCodeSpanPipes(line);
      }

      if (!inTable) return line;

      if (!line.includes('|') || isTableDelimiter(line)) {
        if (!isTableDelimiter(line)) inTable = false;
        return line;
      }

      return escapeCodeSpanPipes(line);
    })
    .join('\n');
}

function isLikelyTableHeader(line: string): boolean {
  return line.includes('|') && line.trim().replace(/^\|/, '').replace(/\|$/, '').includes('|');
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-') || !trimmed.includes('|')) return false;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function escapeCodeSpanPipes(line: string): string {
  if (!line.includes('|') || !line.includes('`')) return line;
  return line.replace(/`([^`]*\|[^`]*)`/g, (_match, code: string) => `\`${code.replace(/\|/g, '\\|')}\``);
}

function postProcessMarkdownHtml(html: string): string {
  let out = html.trim();
  out = out.replace(/>\n+</g, '><');
  out = out.replace(/<pre><code([^>]*)>([\s\S]*?)\n<\/code><\/pre>/g, '<pre><code$1>$2</code></pre>');
  out = out.replace(/<blockquote><p>([\s\S]*?)<\/p><\/blockquote>/g, '<blockquote>$1</blockquote>');
  out = out.replace(/\salign="(left|center|right)"/g, ' style="text-align:$1"');
  out = out.replace(/<table>/g, '<div class="md-table-wrap"><table class="md-table">');
  out = out.replace(/<\/table>/g, '</table></div>');
  out = out.replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_match, rawHref: string, body: string) => {
    const href = normalizeSafeHref(rawHref);
    if (!href) return body;
    const safeHref = escapeHtmlAttribute(href);
    const rel = safeHref.startsWith('#') ? '' : ' rel="noreferrer noopener" target="_blank"';
    return `<a href="${safeHref}"${rel}>${body}</a>`;
  });
  return out;
}

function normalizeSafeHref(href: string): string | null {
  const decoded = decodeHref(href);
  const stripped = decoded.replace(/[!"')}\],.;:\s]+$/, '');
  if (
    stripped.startsWith('#') ||
    stripped.startsWith('/') ||
    stripped.startsWith('./') ||
    stripped.startsWith('../') ||
    /^https?:\/\//i.test(stripped) ||
    /^mailto:/i.test(stripped)
  ) {
    return stripped;
  }
  return null;
}

function decodeHref(href: string): string {
  const htmlDecoded = href
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  try {
    return decodeURIComponent(htmlDecoded);
  } catch {
    return htmlDecoded;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const MarkdownRenderer: ArtifactRenderer = {
  id: 'markdown',
  supportsStreaming: true,
  renderPartial: renderMarkdownToSafeHtml,
  canRender: ({ file }) => {
    const manifest = resolveArtifactManifest(file);
    if (!manifest) return false;
    if (manifest.renderer === 'markdown' || manifest.kind === 'markdown-document') return true;
    return file.kind === 'text' && /\.md$/i.test(file.name);
  },
};
