---
"@jini-ai/ui": minor
---

`CommandPalette` now returns focus to the element that opened it when it closes, unless the host has already moved focus somewhere else on purpose (for example from `onClose`).

Consumer change: `useWiredCommandPalette`, `useTHook` and `useCommandPaletteViewHook` are now required props on `CommandPalette` (no built-in defaults). Pass `useWiredCommandPalette`, `useT` and the newly exported `useCommandPaletteView`, which are all available from `@jini-ai/ui`.

Source comments that pointed at the removed `packages/ui/source-map.md` now cite it by commit (`070311a07^:packages/ui/source-map.md`).
