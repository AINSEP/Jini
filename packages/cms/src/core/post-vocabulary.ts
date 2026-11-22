/**
 * @file The post vocabulary every CMS capability shares: the publication states a post can hold and
 * the kinds a public reader (theme, SEO, widgets) may be handed. A leaf module with NO imports, on
 * purpose, so any domain entry can name these unions without reaching another domain.
 *
 * A host whose storage holds more kinds than the public ones (for example a kind that is stored
 * beside posts but only ever read by its own authoring surface) extends {@link PublicPostKind} in
 * its own code instead of widening the public union here.
 */

/** Publication state of a stored post or page. */
export type PostStatus = "draft" | "published";

/**
 * The kinds public readers accept. A post is a blog-style entry; a page is a standalone document
 * (About, Contact, …). They share one record shape, repository and editor, with separate admin
 * lists. Fixed at creation; there is no kind-conversion path.
 */
export type PublicPostKind = "post" | "page";
