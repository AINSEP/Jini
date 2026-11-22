/** The public byline contract, shared by all theme engines. Hidden credits never enter template data. */
export function postAuthorForDisplay(
  required: { post: { author?: string | null; showAuthor?: boolean } },
  _optional: Record<string, never> = {},
): string | null {
  return required.post.showAuthor === true ? required.post.author?.trim() || null : null;
}
