/**
 * @file The public post-kind vocabulary. Types only.
 *
 * Additive copy of `PublicPostKind` from `@jini-ai/cms/core` (`core/post-vocabulary.ts`). Cms keeps
 * its identical declaration and export until the paired cutover.
 *
 * A host whose storage holds more kinds than the public ones (for example a kind that is stored
 * beside posts but only ever read by its own authoring surface) extends {@link PublicPostKind} in
 * its own code instead of widening the public union here.
 */

/**
 * The kinds public readers accept. A post is a blog-style entry; a page is a standalone document
 * (About, Contact, …). They share one record shape, repository and editor, with separate admin
 * lists. Fixed at creation; there is no kind-conversion path.
 */
export type PublicPostKind = "post" | "page";
