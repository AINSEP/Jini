# browser

Small, generic browser-interaction hooks shared across features: outside-press/Escape dismissal
(`useDismissOnOutsideOrEscape`, `useDismissibleDropdown`), a menu's keyboard navigation
(`useMenuKeyboard`, `menuFocusIndex`), global keydown shortcuts, file drop targets and the modal
window-drag guard. Public entry: `@jini-ai/ui/browser`. Architecture:
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- **Needs injected:** nothing required. `useDismissOnOutsideOrEscape` takes an optional
  `subscription: DismissSubscriptionPort`; `useMenuKeyboard` an optional `doc: DocumentFocus`.
  `settingsControlHandlers` takes the dropdown's `setOpen`, `disabled`, and the host's
  `onThemeChange`/`onOpenAppearance` callbacks.
- **Provides:** `useDismissibleDropdown<T>()` → `{ open, setOpen, containerRef }` (listens only
  while open; Escape in the capture phase); `settingsControlHandlers` → `{ toggleOpen, chooseTheme,
  openAppearancePage }`.
- **Hooks reach Jini components as required props:** a host component (the composition root) may
  call these directly; a Jini component takes them as a required hook prop.
- **Must never import:** host bridges/IPC, host hooks, product copy, `console`.

```tsx
import { settingsControlHandlers, useDismissibleDropdown } from '@jini-ai/ui/browser';

function HostSettingsMenu({ onThemeChange, onOpenAppearance, useDropdown = useDismissibleDropdown }) {
  const { open, setOpen, containerRef } = useDropdown<HTMLDivElement>();
  const { toggleOpen, chooseTheme } = settingsControlHandlers({ disabled: false, setOpen, onThemeChange, onOpenAppearance });
  return <div ref={containerRef}><button aria-expanded={open} onClick={toggleOpen}>Settings</button>
    {open && <button onClick={() => chooseTheme({ next: 'dark' })}>Dark</button>}</div>;
}
```
