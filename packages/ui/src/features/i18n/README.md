# features/i18n

Generic i18n: a React provider/context (`context.tsx`, exported from the `@jini-ai/ui` root) and
framework-free locale resolution (`locale.ts`). Hosts own their locale list and dictionaries.

## Wiring

- `@jini-ai/ui/i18n/locale` (runtime `universal`, no React) exposes `resolveSystemLocale`,
  `detectInitialLocale` and `defaultDetectSystemLocale`. React-free hosts (e.g. a vanilla embed bundle)
  import it instead of the root barrel: `resolveSystemLocale({ languages: [document.documentElement.lang], supportedLocales })`
  maps `pt` → `pt-BR`, `zh-Hant` → `zh-TW`, and returns `null` when nothing matches (host picks its fallback).
