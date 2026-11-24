# posts


## Wiring

Moved here from the host admin app:

- `post-editor-route-key` — no injection; module-level state is shared by every importer of the package, so the host must import it only from `@jini-ai/admin/posts/post-editor-route-key`.
- `Posts.hooks` — `createPostsTranslator` takes the host's dictionary lookup as required `translate({ locale, key })`.
