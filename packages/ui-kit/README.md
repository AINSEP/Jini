# @jini-ai/ui-kit

A UI storefront: a screen asks for a Button, and the host supplies its chosen implementation. Every v1 component has a native default and can be overridden. No consumer needs an admin package or another UI package to obtain primitives.

Package version: `0.1.0`. UI contract: `KIT_CONTRACT.version === '1.0.0'`. These versions have separate meanings: the contract governs component compatibility.

## Entry points

| Import | Purpose |
|---|---|
| `@jini-ai/ui-kit` | Framework-free spec, requirements, attrs, confirmation rules/controller, toast service |
| `@jini-ai/ui-kit/react` | Provider, facades, kit factories, hooks, overlays, toast region |
| `@jini-ai/ui-kit/react/native` | Concrete `nativeKit` with all 16 components |
| `@jini-ai/ui-kit/react/native/styles.css` | Optional native styling in `@layer jini.kit` |
| `@jini-ai/ui-kit/react/testing` | Conformance scenario data and React driver |

The root has no dependencies and imports no React, React DOM, or Vue. Those frameworks are optional peers and development dependencies; a headless consumer can import the root without installing them. React consumers install React and React DOM. Vue and Angular adapters are future subpaths; v1 does not implement them.

## Inject a partial kit

```tsx
import { forwardRef } from 'react';
import { needs } from '@jini-ai/ui-kit';
import {
  Button, ConfirmDialog, KitProvider, ToastRegion, createKit,
  type ButtonProps,
} from '@jini-ai/ui-kit/react';
import '@jini-ai/ui-kit/react/native/styles.css';

const CustomButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function CustomButton(props, ref) {
    return (
      <button
        {...props.attrs}
        ref={ref}
        type={props.type ?? 'button'}
        disabled={props.disabled || props.pending}
        className={props.className}
        onClick={() => props.onPress?.({})}
      >
        {props.children}
      </button>
    );
  },
);

const kit = createKit({ components: { Button: CustomButton } }, { id: 'house' });
const requirements = needs({ id: 'settings', components: ['Button', 'ConfirmDialog'] });

function Settings(props: { open: boolean; save: () => Promise<void>; close: () => void }) {
  return (
    <KitProvider kit={kit} needs={[requirements]}>
      <Button onPress={props.close}>Back</Button>
      <ConfirmDialog
        open={props.open}
        title="Replace settings"
        body="Existing values will be replaced."
        confirmLabel="Replace"
        tone="warning"
        agentMayConfirm={false}
        onConfirm={props.save}
        onCancel={props.close}
      />
      <ToastRegion />
    </KitProvider>
  );
}
```

The custom Button also supplies the native ConfirmDialog's actions. Forward the ref and opaque `attrs` to the actual button. Preserve disabled/pending semantics. With no provider, facades render native defaults.

```ts
import { createStrictKit, extendKit, describeKit } from '@jini-ai/ui-kit/react';
import { nativeKit } from '@jini-ai/ui-kit/react/native';

const full = createStrictKit({ components: nativeKit }, { id: 'complete' });
const variant = extendKit({ base: full, components: {} }, { id: 'variant' });
const report = describeKit({ kit: variant });
// report.coverage, report.fallbacks, report.violations
```

`createStrictKit` requires all implemented components at compile time and checks missing components at runtime. `createKit` and `extendKit` accept partial overrides. Public functions and event ports take a required object and an optional object. Value ports receive `{ value }`; checked ports receive `{ checked }`; action ports receive `{}`. React's `forwardRef(props, ref)` callback follows React's positional API.

## Provider ports and overlays

`KitProvider` accepts `kit`, `agent`, `overlayContainer`, `toast`, `cancelLabel`, `guard`, `needs`, and `children`. It creates an overlay element under `document.body` when none is supplied and removes that element on unmount. Dialog and confirmation facades portal there. `Overlay` also accepts an explicit `container`.

The agent port is `agent({ handle }, { role, label }) => KitAttrs`. The host owns validation and runtime wiring; ui-kit has no dependency on an agent runtime. Components forward metadata to the declared focus target. Select keeps an `HTMLSelectElement`, visible or synchronized in custom implementations.

Copies of this package share a context through `globalThis[Symbol.for('@jini-ai/ui-kit/react/context@1')]`. Development builds warn on package version skew. Sharing requires the host's React runtime to remain compatible.

## Safe, overridable confirmation

`ConfirmDialog` overrides receive `{ controller }`, never the raw `onConfirm`/`onCancel` callbacks. The framework-free controller rereads current policy on every action, blocks confirmation and every dismissal while pending or executing, and refuses agent confirmation when `agentMayConfirm` is false. The React facade chooses cancel-first focus, attaches consequence-aware action labels, and withholds the confirm agent handle for human-only actions. The host still owns the destructive operation and its authorization.

The default development guard inspects actual mounted DOM. A broken confirmation override or Button override falls back to the native confirmation frame and native actions. `guard="warn"` records/logs violations without replacement; `guard="off"` disables checks and fallback. The guard is a development diagnostic, not production authorization. `describeKit({ kit })` exposes recorded violations and fallback coverage.

## Toast service

```ts
import { createToastService } from '@jini-ai/ui-kit';
const toast = createToastService({}, { durationMs: 5000 });
const id = toast.push({ message: 'Saved', tone: 'success' });
toast.dismiss({ id });
// Mount <KitProvider toast={toast}><ToastRegion /></KitProvider> to display messages.
// Dispose a host-owned service when its lifetime ends:
toast.dispose({});
```

Each service owns its own queue. A provider creates and disposes a service when none is injected. It does not mount a ToastRegion automatically. The optional scheduler port provides `schedule({ delayMs, run })` and `cancel({ ticket })`; duration zero or below keeps a toast until dismissed.

## v1 coverage and deferred work

Implemented: Button, IconButton, TextField, TextArea, Select, Checkbox, Switch, Dialog, ConfirmDialog, Tabs, Menu, Toast, Tooltip, Notice, Spinner, Badge.

Planned in the spec only: Link, Icon, RadioGroup, Field, Card, Table, Popover, Combobox, Stack, Grid, ShellLayout, Sidebar, NavItem, PageHeader, Section, EmptyState, OverlayHost. These entries have no runtime implementation. `needs()` rejects them. Vue/Angular adapters, UI-library adapters, and a motif loader are deferred.

Conformance scenarios are data, with a React driver:

```ts
import { createKit } from '@jini-ai/ui-kit/react';
import { runKitConformance } from '@jini-ai/ui-kit/react/testing';
const results = await runKitConformance({ kit: createKit({}) });
// In a DOM test environment: inspect each passed/failed/skipped result.
```

The driver mounts with guard off so native fallback cannot conceal a faulty adapter. Browser-only cases are tagged and reported skipped by the default driver; jsdom checks do not establish browser top-layer, geometry, or real focus-trap behavior. No Playwright coverage is claimed here.

## Validation and development setup

```sh
pnpm --filter @jini-ai/ui-kit exec tsc --noEmit
pnpm --filter @jini-ai/ui-kit test
pnpm --filter @jini-ai/ui-kit build
pnpm --filter @jini-ai/ui-kit run test:headless
```

This README records APIs, not a successful test run. Consult the delivery report for executed commands and results. Package-local dependency links were used during initial workspace setup because `pgrep` was unavailable; no install was run and the lockfile was unchanged by this task.

## Consumer migration sequence

1. Replace admin's provisional kit and confirmation implementation with direct ui-kit imports, translating its existing agent/overlay wiring to provider ports. Remove superseded implementations without forwarding shims. Keep panel-kit behavior separate.
2. Move user-management screens to the facades and declare `needs()` requirements.
3. Move chat controls and composites to the facades; connect its host-owned agent and toast ports.
4. Move reusable UI features to the contract, retaining feature logic in their existing packages. Add library adapters separately when a host needs them.

These migrations are separate work; v1 changes no consumer package.

## Contracts and decision

See [API](docs/spec/api.spec.md), [behavior](docs/spec/behavior.spec.md), [errors](docs/spec/errors.spec.md), [state](docs/spec/state.spec.md), [UI](docs/spec/ui.spec.md), and [DR-001](docs/decisions/DR-001.md).
