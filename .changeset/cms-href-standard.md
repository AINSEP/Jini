---
"@jini-ai/cms": minor
---

`@jini-ai/cms/navigation` is the single href standard. New `toAllowedHref({ rawHref })` returns the trimmed href when `isAllowedHref` allows it, else `"#"`, and accepts any input. `isAllowedHref` now refuses every protocol-relative href (including one aimed at its own former placeholder host, e.g. `//safehref.invalid/x`) and returns `false` for a non-string instead of throwing. The href standard is also the dependency-free leaf `@jini-ai/cms/navigation/href` (`isAllowedHref`, `toAllowedHref`, `ALLOWED_HREF_SHAPES_DESCRIPTION`), for a render worker whose import graph must not load the navigation barrel.
