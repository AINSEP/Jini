/** Taxonomy has no slug column. Use a unique saved name, or its id when names collide. */
export function taxonomyHtmlEmbed(
  { taxonomy, taxonomies }: { taxonomy: { id: string; name: string }; taxonomies: readonly { id: string; name: string }[] },
  _optional = {},
): string {
  const uniqueName = taxonomies.filter((candidate) => candidate.name === taxonomy.name).length === 1
    && !taxonomies.some((candidate) => candidate.id === taxonomy.name && candidate.id !== taxonomy.id);
  const config = JSON.stringify({ type: "taxonomy", id: uniqueName ? taxonomy.name : taxonomy.id, mode: "html" }).replace(/'/g, "&#39;");
  return `<div data-embed-config='${config}'></div>`;
}
