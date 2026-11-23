# screens/library

The Library screen's neutral pieces: document rules (`rules`), the `?tab=` tab helpers
(`Library.hooks`), the injectable `LibraryPort` (`hooks/library-port.hooks`) and the state hook
`useLibrary` (`hooks/use-library.hooks`). Rows are `AdminMedia` from
`@jini-ai/core/contracts/site/cms-admin-media`.

## Wiring

`useLibrary(deps)` takes every host collaborator as a REQUIRED field of `LibraryDependencies`:

- `port` — a `LibraryPort` bound to the host's media/users/auth API clients.
- `locale` and `t` — the admin locale and the host's Library dictionary lookup.
- `describeApiError` — the host's error-copy policy for a thrown request failure.
- `readFileAsBase64` — the host's browser `File` reader (base64, no data: URL prefix).

The host owns the wired variant (`useWiredLibrary`) that binds these, and passes it to the screen
component as its `useLibraryHook` prop.
