export function pagePreviewYoutubeIds(
  { html, bodyJson }: { html: string; bodyJson?: Record<string, unknown> | undefined }, _optional = {}
): string[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const sources = Array.from(template.content.querySelectorAll("iframe[src]"), frame => ({ src: frame.getAttribute("src"), embedOnly: true }));
  const nodes: unknown[] = [bodyJson];
  while (nodes.length) {
    nodes.splice(0, 1).filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null).forEach(node => {
      if (Array.isArray(node.content)) nodes.unshift(...node.content);
      if (node.type !== "youtube") return;
      const attrs = node.attrs;
      if (typeof attrs === "object" && attrs !== null && "src" in attrs && typeof attrs.src === "string") sources.push({ src: attrs.src, embedOnly: false });
    });
  }
  const parsed = sources.flatMap(({ src, embedOnly }) => {
    if (src === null) return [];
    let url: URL;
    try { url = new URL(src); } catch { return []; }
    if (url.username || url.password) return [];
    return [{ url, embedOnly }];
  });
  const ids = parsed.filter(({ url, embedOnly }) => {
    const youtube = ["https://www.youtube.com", "https://youtube.com", "https://www.youtube-nocookie.com", "https://youtube-nocookie.com"].includes(url.origin);
    return youtube || (!embedOnly && url.origin === "https://youtu.be");
  }).map(({ url, embedOnly }) => {
    if (embedOnly) return url.pathname.match(/^\/embed\/([\w-]{1,32})$/)?.[1];
    if (url.origin === "https://youtu.be") return url.pathname.match(/^\/([\w-]{1,32})$/)?.[1];
    if (url.pathname === "/watch") return url.searchParams.get("v");
    return url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{1,32})$/)?.[1];
  }).filter((id): id is string => typeof id === "string" && /^[\w-]{1,32}$/.test(id));
  return [...new Set(ids)];
}
