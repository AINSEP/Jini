---
"@jini-ai/admin": patch
---

Move the post editor's Content analysis card into `@jini-ai/admin`. New subpaths: `./screens/content-analysis/ContentAnalysisCard`, `./screens/content-analysis/rules`, `./screens/content-analysis/content-analysis-i18n`, `./screens/content-analysis/hooks/use-content-analysis.hooks`, `./screens/content-analysis/hooks/content-analysis-port.hooks`, `./screens/content-analysis/hooks/content-analysis-dependencies.hooks` (the fake port). Injected: `ContentAnalysisCard` requires `useContentAnalysisHook` (the host's wired hook); `useContentAnalysis`'s dependencies object requires `useFetchQuery` and `useFetchMutation`.
