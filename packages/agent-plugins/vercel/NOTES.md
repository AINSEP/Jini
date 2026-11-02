# Vercel — implementation notes

Host-specific notes moved out of the first host's core comments (2026-10-22, vendor-to-plugins). Core describes these
behaviours generically; the vendor detail lives here.

- **Account label.** The verified account label is the Vercel `username`.
- **Project name.** The publish label seeds the Vercel project name (sanitized by `safeVercelProjectName`).
- **Security headers.** Rendered into a root `vercel.json` from the publish's `responseHeaders`
  (`targets/vercel.mjs`).
- **Base path.** Served at the root, so no base path is set.
- **Deploy poll.** A publish blocks on Vercel's deployment poll (up to about a minute).
- **Errors.** No code path puts `credential.token` into a `DeployError` message (verified when core's
  adapter boundary was written); core's message-only boundary holds regardless.
- **Share links (Vercel Blob).** `object-stores/vercel-blob.mjs` is the plugin's artifact store for site
  export share links, registered through `tovu-object-stores.json` as provider `vercel` so the share path
  resolves the saved Vercel connection. It needs the optional `blobToken` credential field (a Blob
  store's read-write token); without it the share falls back to download-only. Wire format mirrors
  `@vercel/blob` 2.8.2 `put()`/`del()` (API version 13, `x-vercel-blob-access: public` on put) and has
  not been exercised against live Vercel yet. The store's binding is its Blob origin, so revoke only
  deletes through the store the share was put in.
  No random suffix: the `_share/<16-letter token>/` key is the unguessable part and `delete` only gets the key.
  Verify is an anonymous HEAD of `<store>.public.blob.vercel-storage.com/<key>?download=1` checking
  exact size and `application/zip`.
