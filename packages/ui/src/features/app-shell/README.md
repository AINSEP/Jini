# app-shell

Desktop-shell state a host's renderer wraps around its workspaces, exported from
`@jini-ai/ui/app-shell`. Architecture: [`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

- **Needs injected:**
  - `useExpandedMode({ showSiteTab }, { target? })` — `KeydownTarget` defaults to `window`.
  - `useDeleteConfirmation({ onDelete, describeError }, { doc? })` — the delete action, the
    `DescribeDeleteError` display policy (host copy, its own fallback included), `EscapeTarget`
    defaulting to `document`.
  - `useThemePreference(ports: ThemePreferencePorts)` — `storage` (`PreferenceStorage`),
    `storageKey`, `defaultPreference`, `matchMedia` (`ColorSchemeMediaPort`) and `root`
    (`ThemeRoot`). Pass stable references: every port is an effect dependency.
  - `useSiteToast({ lastCreated, copy }, { autoHideMs? })` — `SiteToastCopy` (`created`, `added`,
    `setAside`), a module-level constant. `<SiteToast toast onDismiss labels classNames? />` takes
    `SiteToastLabels` (`showList`, `dismiss`) and optional `SiteToastClassNames`
    (`root`, `message`, `note`, `items`, `dismiss`) added beside its `jini-site-toast*` classes.
- **Provides:** the pure rules `nextExpanded`, `expandedAfterKeyDown`, `expandedAfterWorkspaceChange`,
  `workspaceOnScreen`, `chromeVisibility`, `dismissOnEscape`, `readStoredPreference`, `toastLifetime`
  and `copyableDetails`; the four hooks; the stateless `SiteToast` (ships no stylesheet yet).
- **Must never import:** host bridges/IPC, host hooks, product copy or storage keys, `console`.

```tsx
import { SiteToast, useSiteToast, useThemePreference } from '@jini-ai/ui/app-shell';

const TOAST_COPY = { created: ({ displayName }) => `Created ${displayName}`, added: ({ displayName }) => `Added ${displayName}`, setAside: ({ count }) => `${count} set aside` };
function Shell({ lastCreated }) {
  const ports = useMemo(() => ({ storage: localStorage, storageKey: 'my-app.theme', defaultPreference: 'system', matchMedia: (q) => window.matchMedia(q), root: document.documentElement }), []);
  const [theme, setTheme] = useThemePreference(ports);
  const toast = useSiteToast({ lastCreated, copy: TOAST_COPY });
  return <SiteToast toast={toast.toast} onDismiss={toast.dismiss} labels={{ showList: 'Show list', dismiss: 'Dismiss' }} />;
}
```
