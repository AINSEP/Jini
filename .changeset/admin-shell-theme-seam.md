---
"@jini-ai/admin": patch
---

`AdminShell`'s `useThemeHook` may return `undefined` for a host that owns its theme controller: the shell then writes no attribute to `themeEnvironment.target` and passes no `appearance` to the slots. No new prop or port method; the default (no `useThemeHook`) behaves as before. Documented on the prop and pinned by tests.
