/**
 * @file Keeps the post editor mounted when its own save renames the slug in the URL.
 *
 * An untitled post's slug follows its title until first publish, so the first save usually moves the
 * post from `/posts/untitled-6` to `/posts/my-title`. The editor replace-navigates to the new slug so
 * a reload, a new tab, or a shared link still finds the post — the old slug 404s. The host keys
 * `<PostEditor>` by the URL segment (a remount per record), so without this the rename would remount
 * the editor right after the save: the "Saved" message, undo history and anything typed while the
 * save was in flight would be thrown away. A rename records `to → key of from`, so the host keeps the
 * same key for the same record.
 *
 * A new post's working copy has the empty segment (`?create=1`). Each one gets its own draft key, kept
 * through its first Save and then retired, so the next new post gets another. One shared key let two
 * new posts reuse a single editor: after saving A then B, navigating A→B kept A on screen under B's URL.
 *
 * The state is owned by the instance, not the module: the host creates ONE at its composition point and
 * hands it to both the keying site and the save site, so two hosts (or two tests) never share renames.
 */

/** The two operations the keying site and the save site share. */
export interface PostEditorRouteKeys {
  /** The `key` the host gives `<PostEditor>` for this URL segment. */
  keyFor(required: { segment: string }, _options?: Record<string, never>): string;
  /** Records that the editor at `from` is now addressed by `to` (its own save renamed the slug). A
   *  first Save (`from` empty) hands the draft key to the saved slug and starts a fresh one. */
  remember(required: { from: string; to: string }, _options?: Record<string, never>): void;
}

/** A fresh, empty route-key store. */
export function createPostEditorRouteKeys(_options: Record<string, never> = {}): PostEditorRouteKeys {
  const renamedRouteKeys = new Map<string, string>();
  let draftCount = 1;
  function keyFor({ segment }: { segment: string }, _keyOptions: Record<string, never> = {}): string {
    if (segment === '') return `new-post-draft:${draftCount}`;
    return renamedRouteKeys.get(segment) ?? segment;
  }
  function remember({ from, to }: { from: string; to: string }, _rememberOptions: Record<string, never> = {}): void {
    if (from === to) return;
    renamedRouteKeys.set(to, keyFor({ segment: from }));
    if (from === '') draftCount += 1;
  }
  return { keyFor, remember };
}
