# Source control

Headless source-control connection controller, its adapters and conformance suite, the React
binding, and the page's translation dictionary (`source-control-i18n.ts`). Port history and the
acceptance contract are in `PORT.md`; rationale in `SOURCE-RATIONALE.md`.

## Wiring

`createSourceControlTranslator({ hostDictionary }, { commonDictionary })` takes the host's own
per-locale entries — the strings that name its product — keyed by the exact English strings its
screens look up. They are laid over this package's dictionary per locale (host wins a collision),
then the common dictionary (default `ADMIN_COMMON_I18N`; a host that composes its own product words
over it passes that composition), then the English key. Build the translator once at module level in
the host and pass the bound `t` to the screen and hook; the two `{error}` templates
(`sourceControlCredentialsLoadErrorMessage`, `sourceControlCredentialSaveErrorMessage`) take `locale`
directly and need no host entries.
