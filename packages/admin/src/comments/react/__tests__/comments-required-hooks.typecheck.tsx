/**
 * @file Type-level pin for the hook-injection rule on `CommentsPage`: its view-model hook is a
 * required prop, so a mount that names the real hook compiles and a mount that omits it does not.
 * If someone restores an optional default (`useCommentsPageHook = useCommentsPage`), the
 * `@ts-expect-error` below becomes unused and `tsc --noEmit` fails. Never executed; checked only by tsc.
 */
import { useCommentsPage } from '../hooks/CommentsPage.hooks.js';
import { CommentsPage } from '../pages/CommentsPage.js';

export const withHook = <CommentsPage useCommentsPageHook={useCommentsPage} />;
// @ts-expect-error -- the page hook is required; omitting it must not compile.
export const withoutHook = <CommentsPage />;
