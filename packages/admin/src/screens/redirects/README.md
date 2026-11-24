# screens/redirects

The Redirects admin screen mount (`./screens/redirects`) and its dictionary (`./screens/redirects/redirects-i18n`).
The screen itself lives in `../../redirects/react`; this folder only mounts it through the host's module scope and
supplies its translated copy.

## Wiring

- **Needs injected:** `useModulePanel: RedirectsModulePanelHook` (the host's module-panel hook) and
  `ModuleLoading: ComponentType` (the host's loading view) — both required args of `Redirects`.
  The dictionary's `importRulesLabel` renders the kit's `InfoTip`, so an `<AdminKitProvider>` must be above it.
- **Provides:** `Redirects`; `t` (dictionary translator over `ADMIN_COMMON_I18N`), `importRulesLabel`,
  `importResultSummary`, `createdLabel`, `failedItemLabel`, `deleteRedirectBody`, `actionsForRedirectLabel`.

```tsx
import { Redirects } from '@jini-ai/admin/screens/redirects';
import { t, importRulesLabel } from '@jini-ai/admin/screens/redirects/redirects-i18n';
import { useModulePanel } from './modules.hooks';                  // host-owned
import { RedirectsModuleLoading } from './redirects-module.hooks'; // host-owned

const panel = { render: () => <Redirects useModulePanel={useModulePanel} ModuleLoading={RedirectsModuleLoading} /> };
const translateRedirects = t; // hand to the redirects module's ports
```

- **Must never import:** host modules (module-scope hooks, host dictionaries, host UI libraries); the InfoTip
  comes only through `../../react/kit.js`.

Boundary rationale: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
