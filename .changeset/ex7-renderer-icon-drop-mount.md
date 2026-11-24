---
"@jini-ai/ui": patch
---

Add `IconFrame` (the shared 20-unit decorative line-icon frame, `jini-icon-frame` plus an optional host class) and `useClassifiedPathDrop` with its `ClassifiedPathDrop` type (a whole-page capture-phase drop target that routes each drop or picked file to a folder, archive or refusal handler as the host's injected classifiers decide) to the root entry, and `mountRenderer` (render an app into the page's host element, throwing when it is missing) to `./browser`.
